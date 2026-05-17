#!/bin/bash
# =============================================================================
# wg-man rescue script — backup and restore critical config & data
# =============================================================================
#
# Designed for when YunoHost's built-in backup/restore fails during an upgrade.
# Run this on your YunoHost server as root.
#
# COMMANDS
#   backup  [DEST_DIR]    Create a rescue archive  (default dest: /root)
#   restore <ARCHIVE>     Restore from a rescue archive
#   verify  <ARCHIVE>     List and verify contents of an archive
#   cron-install [DIR]    Schedule a daily automatic backup (default: /root/wg-man-backups)
#   cron-remove           Remove the automatic backup cron job
#
# WHAT IS BACKED UP
#   /var/lib/wg-man/              data dir (passkeys, plugins, scripts, history)
#   /opt/wg-man/server/.env       secrets  (session keys, proxy secret, dex creds)
#   /etc/yunohost/apps/wg-man/settings.yml  install-time YunoHost settings
#   /usr/local/bin/vpn-monitor.sh           monitor script (if present)
#
# TYPICAL RECOVERY FLOW (after a failed upgrade that wiped the app)
#   1. yunohost app install <wg-man-repo-url>  -- fresh install, same domain/path
#   2. wg-man-rescue restore /root/wg-man-rescue-YYYYMMDD_HHMMSS.tar.gz
#   3. Done — passkeys, plugin config, scripts, and secrets are restored.
#
# =============================================================================

set -uo pipefail

# ── Config ────────────────────────────────────────────────────────────────────

APP="wg-man"
INSTALL_DIR="/opt/${APP}"
DATA_DIR="/var/lib/${APP}"
ENV_FILE="${INSTALL_DIR}/server/.env"
YNH_SETTINGS_DIR="/etc/yunohost/apps/${APP}"
YNH_SETTINGS="${YNH_SETTINGS_DIR}/settings.yml"
MONITOR_SCRIPT="/usr/local/bin/vpn-monitor.sh"
CRON_FILE="/etc/cron.d/wg-man-rescue"

# ── Colours ───────────────────────────────────────────────────────────────────

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

info()  { echo -e "${CYAN}[info]${NC}  $*"; }
ok()    { echo -e "${GREEN}[ok]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[warn]${NC}  $*"; }
err()   { echo -e "${RED}[error]${NC} $*" >&2; }
die()   { err "$*"; exit 1; }
header(){ echo -e "\n${BOLD}$*${NC}"; }

# ── Helpers ───────────────────────────────────────────────────────────────────

require_root() {
    [[ $EUID -eq 0 ]] || die "This script must be run as root."
}

confirm() {
    local prompt="${1:-Continue?}"
    echo -en "${YELLOW}${prompt} [y/N]${NC} "
    local answer
    read -r answer || true
    [[ "${answer,,}" == "y" ]]
}

service_running() {
    systemctl is-active --quiet "${APP}" 2>/dev/null
}

# ── BACKUP ────────────────────────────────────────────────────────────────────

do_backup() {
    local dest_dir="${1:-/root}"
    local ts; ts=$(date +%Y%m%d_%H%M%S)
    local archive="${dest_dir}/${APP}-rescue-${ts}.tar.gz"
    tmp=$(mktemp -d)
    local src="${tmp}/backup"
    local had_any=false

    trap 'rm -rf "$tmp"' EXIT

    header "Creating rescue backup for ${APP}…"
    mkdir -p "${src}/data"

    # ── .env (all secrets) ──────────────────────────────────────────────────
    if [[ -f "$ENV_FILE" ]]; then
        cp "$ENV_FILE" "${src}/.env"
        ok "Saved .env  (${ENV_FILE})"
        had_any=true
    else
        warn ".env not found at ${ENV_FILE}"
    fi

    # ── YunoHost app settings ───────────────────────────────────────────────
    if [[ -f "$YNH_SETTINGS" ]]; then
        cp "$YNH_SETTINGS" "${src}/settings.yml"
        ok "Saved settings.yml  (${YNH_SETTINGS})"
        had_any=true
    else
        warn "YunoHost settings not found at ${YNH_SETTINGS}"
    fi

    # ── Data directory ──────────────────────────────────────────────────────
    if [[ -d "$DATA_DIR" ]]; then
        cp -a "${DATA_DIR}/." "${src}/data/"
        local sz; sz=$(du -sh "${src}/data" 2>/dev/null | cut -f1)
        ok "Saved data dir  (${DATA_DIR}  ·  ${sz})"
        had_any=true
    else
        warn "Data directory not found at ${DATA_DIR}"
    fi

    # ── VPN monitor script (only if user-customised) ────────────────────────
    if [[ -f "$MONITOR_SCRIPT" ]]; then
        cp "$MONITOR_SCRIPT" "${src}/vpn-monitor.sh"
        ok "Saved vpn-monitor.sh  (${MONITOR_SCRIPT})"
    fi

    "$had_any" || die "Nothing found to back up. Is ${APP} installed?"

    # ── Manifest ────────────────────────────────────────────────────────────
    cat > "${src}/MANIFEST" <<EOF
wg-man rescue backup
version:    2
created:    $(date -Iseconds)
hostname:   $(hostname -f 2>/dev/null || hostname)
app:        ${APP}
files:
  .env            -> ${ENV_FILE}
  settings.yml    -> ${YNH_SETTINGS}
  data/           -> ${DATA_DIR}/
  vpn-monitor.sh  -> ${MONITOR_SCRIPT}  (if present)

recovery:
  1. yunohost app install <wg-man-repo>   # fresh install — same domain/path
  2. wg-man-rescue restore <this-archive>
EOF

    mkdir -p "$dest_dir"
    tar -czf "$archive" -C "$tmp" backup/
    chmod 600 "$archive"

    echo ""
    ok "Archive: ${BOLD}${archive}${NC}"
    info "Size:    $(du -sh "$archive" | cut -f1)"
    info "Restore: $(basename "$0") restore ${archive}"
}

# ── VERIFY ────────────────────────────────────────────────────────────────────

do_verify() {
    local archive="$1"
    [[ -f "$archive" ]] || die "Archive not found: ${archive}"

    header "Verifying ${archive}…"

    tar -tzf "$archive" >/dev/null 2>&1 || die "Archive is corrupt or not a valid tar.gz"

    echo ""
    info "Contents:"
    tar -tzf "$archive" | sed 's/^/  /'

    if tar -tzf "$archive" 2>/dev/null | grep -q "backup/MANIFEST"; then
        echo ""
        info "Manifest:"
        tar -xzf "$archive" -O backup/MANIFEST 2>/dev/null | sed 's/^/  /'
    fi

    ok "Archive looks valid."
}

# ── RESTORE ───────────────────────────────────────────────────────────────────

do_restore() {
    local archive="$1"
    [[ -f "$archive" ]] || die "Archive not found: ${archive}"

    tmp=$(mktemp -d)
    local src="${tmp}/backup"
    trap 'rm -rf "$tmp"' EXIT

    header "Preparing restore from ${archive}…"

    tar -tzf "$archive" >/dev/null 2>&1 || die "Archive is corrupt or not a valid tar.gz"
    tar -xzf "$archive" -C "$tmp"
    [[ -d "$src" ]] || die "Archive does not contain the expected backup/ directory."

    # Show manifest if present
    if [[ -f "${src}/MANIFEST" ]]; then
        echo ""
        sed 's/^/  /' "${src}/MANIFEST"
        echo ""
    fi

    # Show what will be restored
    header "Will restore:"
    [[ -f "${src}/.env" ]]           && info ".env           → ${ENV_FILE}"
    [[ -f "${src}/settings.yml" ]]   && info "settings.yml   → ${YNH_SETTINGS}"
    [[ -d "${src}/data" ]]           && info "data/          → ${DATA_DIR}/"
    [[ -f "${src}/vpn-monitor.sh" ]] && info "vpn-monitor.sh → ${MONITOR_SCRIPT}"
    echo ""

    confirm "Overwrite live files?" || { info "Aborted."; exit 0; }
    echo ""

    # ── Capture live proxy_secret before overwriting settings ────────────────
    # AUTH-01: the nginx config is generated at install time and embeds
    # proxy_secret as the X-WG-Secret header value.  Restoring an old .env
    # with a different PROXY_SECRET breaks auth because nginx keeps sending the
    # fresh-install secret.  Save it now and re-inject it after the restore.
    local live_proxy_secret=""
    if [[ -f "$YNH_SETTINGS" ]]; then
        live_proxy_secret=$(awk '/^proxy_secret:/{print $2}' "$YNH_SETTINGS" | tr -d '"' | tr -d "'" | xargs 2>/dev/null || true)
    fi

    # ── Stop service ────────────────────────────────────────────────────────
    if service_running; then
        info "Stopping ${APP}…"
        systemctl stop "${APP}" && ok "Service stopped"
    fi

    local restored=0
    local skipped=0

    # ── Restore .env ────────────────────────────────────────────────────────
    if [[ -f "${src}/.env" ]]; then
        if [[ -d "${INSTALL_DIR}/server" ]]; then
            cp "${src}/.env" "$ENV_FILE"
            chmod 640 "$ENV_FILE"
            chown root:root "$ENV_FILE"
            ok "Restored .env → ${ENV_FILE}"
            (( restored++ )) || true
        else
            warn "Install dir ${INSTALL_DIR}/server not found — .env not restored"
            warn "Reinstall the app first, then run restore again"
            (( skipped++ )) || true
        fi
    fi

    # ── Restore YunoHost settings ────────────────────────────────────────────
    if [[ -f "${src}/settings.yml" ]]; then
        if [[ -d "$YNH_SETTINGS_DIR" ]]; then
            cp "${src}/settings.yml" "$YNH_SETTINGS"
            ok "Restored settings.yml → ${YNH_SETTINGS}"
            (( restored++ )) || true
        else
            warn "YunoHost app dir ${YNH_SETTINGS_DIR} not found — settings not restored"
            warn "Reinstall the app first, then run restore again"
            (( skipped++ )) || true
        fi
    fi

    # ── Sync proxy_secret so nginx ↔ .env stay consistent ───────────────────
    # After a fresh install + restore, nginx still uses the new proxy_secret.
    # Re-inject it into .env (and settings.yml) so the app can authenticate.
    if [[ -n "$live_proxy_secret" ]]; then
        if [[ -f "$ENV_FILE" ]]; then
            sed -i "s/^PROXY_SECRET=.*/PROXY_SECRET=${live_proxy_secret}/" "$ENV_FILE"
            ok "Synced PROXY_SECRET in .env to match current nginx config"
        fi
        if [[ -f "$YNH_SETTINGS" ]]; then
            sed -i "s/^proxy_secret:.*/proxy_secret: ${live_proxy_secret}/" "$YNH_SETTINGS"
        fi
    fi

    # ── Restore data directory ───────────────────────────────────────────────
    if [[ -d "${src}/data" ]]; then
        mkdir -p "$DATA_DIR"
        cp -a "${src}/data/." "$DATA_DIR/"
        chown -R root:root "$DATA_DIR"
        chmod 750 "$DATA_DIR"
        ok "Restored data/ → ${DATA_DIR}"
        (( restored++ )) || true
    fi

    # ── Restore VPN monitor script ───────────────────────────────────────────
    if [[ -f "${src}/vpn-monitor.sh" ]]; then
        cp "${src}/vpn-monitor.sh" "$MONITOR_SCRIPT"
        chown root:root "$MONITOR_SCRIPT"
        chmod 755 "$MONITOR_SCRIPT"
        chmod o-w "$MONITOR_SCRIPT"
        ok "Restored vpn-monitor.sh → ${MONITOR_SCRIPT}"
        (( restored++ )) || true
    fi

    echo ""
    info "Restored: ${restored}  |  Skipped: ${skipped}"

    # ── Start service ────────────────────────────────────────────────────────
    if [[ -d "$INSTALL_DIR" ]]; then
        info "Starting ${APP}…"
        if systemctl start "${APP}"; then
            ok "${APP} started successfully"
        else
            warn "Failed to start ${APP} — check: journalctl -u ${APP} -n 50"
        fi
    else
        echo ""
        warn "Install directory ${INSTALL_DIR} not found — app may need reinstalling."
        echo ""
        info "Suggested recovery steps:"
        echo "  1.  yunohost app install /path/to/wg-man"
        echo "  2.  $(basename "$0") restore ${archive}"
    fi

    ok "Restore complete."
}

# ── CRON ──────────────────────────────────────────────────────────────────────

do_cron_install() {
    local backup_dir="${1:-/root/wg-man-backups}"
    local script_path; script_path=$(realpath "$0")

    mkdir -p "$backup_dir"

    cat > "$CRON_FILE" <<EOF
# wg-man daily rescue backup — installed by wg-man-rescue.sh
# Keeps 14 days of backups; runs at 03:17 every day.
17 3 * * * root ${script_path} backup ${backup_dir} >> /var/log/wg-man-rescue.log 2>&1
# Prune archives older than 14 days
20 3 * * * root find ${backup_dir} -name '${APP}-rescue-*.tar.gz' -mtime +14 -delete >> /var/log/wg-man-rescue.log 2>&1
EOF

    chmod 644 "$CRON_FILE"
    ok "Cron job installed: ${CRON_FILE}"
    info "Daily backup → ${backup_dir}  (03:17, kept 14 days)"
    info "Log file     → /var/log/wg-man-rescue.log"
}

do_cron_remove() {
    if [[ -f "$CRON_FILE" ]]; then
        rm "$CRON_FILE"
        ok "Cron job removed: ${CRON_FILE}"
    else
        info "No cron job found at ${CRON_FILE}"
    fi
}

# ── MAIN ──────────────────────────────────────────────────────────────────────

require_root

case "${1:-}" in
    backup)
        do_backup "${2:-/root}"
        ;;
    restore)
        [[ -n "${2:-}" ]] || die "Usage: $(basename "$0") restore <archive>"
        do_restore "$2"
        ;;
    verify)
        [[ -n "${2:-}" ]] || die "Usage: $(basename "$0") verify <archive>"
        do_verify "$2"
        ;;
    cron-install)
        do_cron_install "${2:-/root/wg-man-backups}"
        ;;
    cron-remove)
        do_cron_remove
        ;;
    *)
        echo -e "${BOLD}wg-man rescue backup/restore${NC}"
        echo ""
        echo "Usage: $(basename "$0") <command> [args]"
        echo ""
        echo "Commands:"
        printf "  %-30s %s\n" "backup  [DEST_DIR]"     "Create a rescue archive  (default: /root)"
        printf "  %-30s %s\n" "restore <ARCHIVE>"       "Restore from a rescue archive"
        printf "  %-30s %s\n" "verify  <ARCHIVE>"       "Inspect and verify an archive"
        printf "  %-30s %s\n" "cron-install [DEST_DIR]" "Schedule daily automatic backups"
        printf "  %-30s %s\n" "cron-remove"             "Remove the automatic backup cron job"
        echo ""
        echo "Quick start:"
        echo "  # Back up now"
        echo "  $(basename "$0") backup"
        echo ""
        echo "  # Schedule daily backups to /root/wg-man-backups"
        echo "  $(basename "$0") cron-install"
        echo ""
        echo "  # After a failed upgrade — reinstall, then restore"
        echo "  yunohost app install <wg-man-repo>"
        echo "  $(basename "$0") restore /root/wg-man-rescue-20260101_030000.tar.gz"
        exit 1
        ;;
esac
