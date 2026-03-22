#!/bin/bash
# VPN Priority Failover Monitor - Static Interface Mode

set -u

# ---------------- CONFIGURATION ----------------
CONFIG_DIR="/etc/wireguard"
CONFIG_PATTERN="nl-ams-wg-*.conf"
STATIC_NAME="wg-vpn"
STATIC_CONF="$CONFIG_DIR/$STATIC_NAME.conf"

CHECK_IP="1.1.1.1"
STATE_FILE="/var/lib/vpn-monitor.current"
LOCK_FILE="/var/run/vpn-monitor.lock"
LOG_FILE="/var/log/vpn-monitor.log"

PING_COUNT=2
PING_TIMEOUT=5
# WireGuard renews its handshake every ~120s. Set threshold above that
# to avoid false alarms when the check fires mid-renewal.
MAX_HANDSHAKE_AGE=150
# ------------------------------------------------

log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') - $1" >> "$LOG_FILE"
}

# 1. Add the full PATH so Cron knows where wg-quick is
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

# 2. Wait for the physical internet to be ready (up to 30 seconds)
MAX_WAIT=30
while ! ping -c 1 -W 1 1.1.1.1 >/dev/null 2>&1 && [ $MAX_WAIT -gt 0 ]; do
    log "Waiting for internet connection... ($MAX_WAIT)"
    sleep 2
    ((MAX_WAIT--))
done

# 3. Clear table 1000 before doing anything else
# This fixes the "File exists" error that often happens after reboots
ip rule del table 1000 >/dev/null 2>&1
ip route flush table 1000 >/dev/null 2>&1

# Ensure script runs as root
if [[ $EUID -ne 0 ]]; then
   echo "This script must be run as root"
   exit 1
fi

exec 200>"$LOCK_FILE"
flock -n 200 || exit 0

cd "$CONFIG_DIR" || { log "ERROR: Cannot access $CONFIG_DIR"; exit 1; }

# Get all configs except the static one itself
CONFIGS=($(ls $CONFIG_PATTERN 2>/dev/null | grep -v "$STATIC_NAME" | sed 's/\.conf//' | sort))
COUNT=${#CONFIGS[@]}

if [ "$COUNT" -eq 0 ]; then
    log "ERROR: No configs matching $CONFIG_PATTERN found in $CONFIG_DIR"
    exit 1
fi

switch_to_config() {
    local target_name=$1
    log "ACTION: Attempting to use $target_name"

    # 1. Aggressive Cleanup of the Static Interface
    wg-quick down "$STATIC_NAME" >/dev/null 2>&1
    ip link delete "$STATIC_NAME" >/dev/null 2>&1

    # 2. Cleanup ANY other active nl-ams interfaces (like from manual tests)
    OTHER_IFS=$(wg show interfaces | grep "nl-ams" || true)
    for iface in $OTHER_IFS; do
        wg-quick down "$iface" >/dev/null 2>&1
    done

    # 3. Manually clear the specific IP rule if it's still lingering
    local CONF_IP=$(grep -oP 'Address\s*=\s*\K[0-9.]+' "$CONFIG_DIR/$target_name.conf" | head -1)
    if [ -n "$CONF_IP" ]; then
        ip -4 rule del from "$CONF_IP" table 1000 >/dev/null 2>&1
    fi

    # 4. Deploy and start
    cp "$CONFIG_DIR/$target_name.conf" "$STATIC_CONF"
    chmod 600 "$STATIC_CONF"

    if wg-quick up "$STATIC_NAME" >/dev/null 2>&1; then
        echo "$target_name" > "$STATE_FILE"
        log "SUCCESS: $target_name is now active as $STATIC_NAME"
        return 0
    else
        log "FAILED: $target_name could not start"
        return 1
    fi
}

# ---------- Status Check ----------
CURRENT_IFACE=$(wg show interfaces | grep "^$STATIC_NAME$" || echo "")
VPN_OK=false

if [ -n "$CURRENT_IFACE" ]; then
    if ping -c "$PING_COUNT" -W "$PING_TIMEOUT" -I "$STATIC_NAME" "$CHECK_IP" >/dev/null 2>&1; then
        HANDSHAKE=$(wg show "$STATIC_NAME" latest-handshakes | awk '{print $2}')
        NOW=$(date +%s)
        if [ -n "$HANDSHAKE" ] && [ "$HANDSHAKE" -ne 0 ] && [ $((NOW - HANDSHAKE)) -lt "$MAX_HANDSHAKE_AGE" ]; then
            VPN_OK=true
        fi
    fi
fi

if [ "$VPN_OK" = true ]; then
    exit 0
fi

# ---------- Rotation/Failover Logic ----------
log "TRIGGER: VPN is down or unhealthy. Starting priority search..."

for ((n=0; n<COUNT; n++)); do
    NEXT_TRY="${CONFIGS[$n]}"
    if switch_to_config "$NEXT_TRY"; then
        exit 0
    fi
done

log "CRITICAL: All available configs failed to initialize."
exit 1
