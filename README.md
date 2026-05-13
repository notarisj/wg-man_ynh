# wg-man

A self-hosted WireGuard VPN manager designed for [YunoHost](https://yunohost.org). Provides a web UI to monitor connection status, switch between tunnel configs, edit config files, view logs, and schedule automated reconnect scripts — all behind your YunoHost SSO and an additional passkey gate.

<p align="center"><img src="screenshots/screenshot1.png" alt="Dashboard" width="85%" style="border-radius: 12px;" /></p>


## Stack

- **Frontend**: React 19 + TypeScript, Vite, Zustand, CodeMirror 6
- **Backend**: Node.js + Express, WebSocket (live log tail), express-session
- **Auth**: YunoHost SSOwat (proxy headers) + WebAuthn passkey (second factor)
- **Target platform**: Debian 12 + YunoHost 11.2+


## Features

- **Dashboard** — live connection status, handshake age, traffic counters, CPU/RAM metrics, uptime history bar
- **Configs** — list, create, edit, delete, and switch WireGuard `.conf` files; grid or list view
- **Logs** — real-time log tail over WebSocket, full-text search
- **History** — connection uptime timeline with selectable time windows
- **Settings** — passkey management (register / lock / reset), cron schedule for the monitor script, monitor script editor, app version info
- **Cron** — schedule the bundled `vpn-monitor.sh` via the API; no crontab editing needed


## Auth model

1. **SSOwat** — YunoHost's nginx reverse proxy injects `YNH_USER` / `YNH_EMAIL` headers. The backend verifies these against a shared `PROXY_SECRET` to reject direct-to-port requests.
2. **Passkey (WebAuthn)** — after SSOwat, users must register and verify a passkey before the app is usable. This is the second factor and survives sessions independently.

The entire application refuses to start in production without both `PROXY_SECRET` and `SESSION_SECRET` set.


## Development

```bash
# install deps
npm install
cd server && npm install && cd ..

# run frontend (Vite) + backend (tsx watch) concurrently
npm run dev
```

Frontend runs on `http://localhost:5173`, backend on `http://localhost:3001`. CORS is relaxed in dev; SSOwat header injection is skipped.


## Production deployment

### YunoHost (recommended)

Install via the YunoHost admin panel → **Applications → Install an app → Install custom app**, paste the package URL:

```
https://github.com/notarisj/wg-man_ynh
```

YunoHost handles building the app, creating the systemd service, configuring nginx, and wiring up SSOwat automatically.

### Manual deployment

See [deploy/README.md](deploy/README.md) for the full guide. Short version:

```bash
# 1. build
npm run build
cd server && npm run build && cd ..

# 2. environment — copy and edit
cp server/.env.example server/.env

# 3. systemd
cp deploy/wg-man-api.service /etc/systemd/system/
systemctl enable --now wg-man

# 4. nginx — install the conf snippet into YunoHost's nginx config
#    (handled automatically if installed as a YunoHost app)
```

### Required environment variables

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `3001` | API listen port |
| `NODE_ENV` | — | Set to `production` to enable security checks |
| `SESSION_SECRET` | — | **Required in prod.** Signs session cookies |
| `PROXY_SECRET` | — | **Required in prod.** Shared with nginx to prevent bypass |
| `WG_CONFIG_DIR` | `/etc/wireguard` | Directory scanned for tunnel configs |
| `WG_CONFIG_PATTERN` | `wg-*.conf` | Glob pattern — must start with a literal prefix |
| `WG_STATIC_INTERFACE` | `wg-vpn` | Interface name used by `wg-quick` |
| `MONITOR_SCRIPT` | `/usr/local/bin/vpn-monitor.sh` | Path to the reconnect monitor script |
| `LOG_FILE` | `/var/log/vpn-monitor.log` | Log file tailed by the Logs page |
| `STATE_FILE` | `/var/lib/vpn-monitor.current` | Tracks active tunnel name |
| `CHECK_IP` | `1.1.1.1` | IP pinged to verify connectivity |
| `MAX_HANDSHAKE_AGE` | `150` | Seconds before a handshake is considered stale |
| `HISTORY_FILE` | `/var/lib/wg-man/history.json` | Connection history storage |
| `WG_DATA_DIR` | `/var/lib/wg-man` | Passkey credential storage |


## Security notes

- No shell string interpolation — all `wg-quick` / `ping` calls use `execFile` with an argument array.
- Config pattern requires a non-empty literal prefix before any wildcard to prevent exposing unrelated configs.
- Monitor script ownership is validated before execution (must be owned by root, not group/world-writable).
- CSRF protection on all state-mutating API routes.
- Rate limiting: 30 req/min general, 5 req/min for mutations (bypassed in dev).
- Strict CSP via Helmet; no inline scripts.


## License

MIT
