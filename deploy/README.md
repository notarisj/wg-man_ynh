# WG Manager — Deployment Guide

## Overview

The app consists of two parts:
1. **Frontend** — Vite/React SPA (`dist/` after build)
2. **Backend** — Node.js/Express API server (`server/`)

Both are served from the same origin in production (Express serves the built frontend).  
Auth is handled by **YunoHost SSOwat** — no separate login needed.

---

## Requirements

- Debian 12 + YunoHost installed
- Node.js 18+ (`sudo apt install nodejs npm`)
- Root access (for wg-quick and reading /etc/wireguard/)

---

## Step 1 — Deploy app files to server

On your dev machine (Windows):
```bash
# Build frontend first
npm run build

# Copy everything to server
scp -r . notaris@your-server:/opt/wg-man
```

Or clone/pull the repo directly on the server:
```bash
git clone https://your-repo-url /opt/wg-man
```

---

## Step 2 — Install dependencies on the server

```bash
cd /opt/wg-man

# Frontend build (if not already built)
npm install
npm run build

# Backend deps
cd server
npm install
npm run build
```

---

## Step 3 — Create the .env file

```bash
cp /opt/wg-man/server/.env.example /opt/wg-man/server/.env
# Edit paths if needed (defaults should work for this setup)
nano /opt/wg-man/server/.env
```

---

## Step 4 — Install the systemd service

```bash
cp /opt/wg-man/deploy/wg-man-api.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable wg-man
systemctl start wg-man
systemctl status wg-man
```

Check logs:
```bash
journalctl -u wg-man -f
```

---

## Step 5 — Register with YunoHost (SSOwat)

In the YunoHost admin panel:

1. Go to **Apps → Install**
2. Search for **"Redirect"** and install it
3. Configure:
   - **Label**: WG Manager
   - **URL**: your-domain/wg-manager (or whatever path)
   - **Redirect type**: Proxy (reverse proxy)
   - **Redirect URL**: `http://127.0.0.1:3001`
4. Set **Access permissions** → allowed: `admins` group

SSOwat will automatically:
- Protect the URL (redirect to portal if not logged in)
- Inject `YNH_USER` and `YNH_EMAIL` headers into proxied requests
- Show the app in the YunoHost portal for admins

---

## Step 6 — Verify

```bash
# Test API health (from server itself)
curl http://127.0.0.1:3001/healthz

# Test status endpoint (simulating SSOwat header)
curl -H "YNH_USER: testuser" http://127.0.0.1:3001/api/status
```

Then open the app via your YunoHost portal — you should see the Dashboard with live VPN status.

---

## Updating

```bash
cd /opt/wg-man
git pull
npm run build       # rebuild frontend
cd server
npm run build       # rebuild backend
systemctl restart wg-man
```

---

## Troubleshooting

| Issue | Fix |
|---|---|
| 403 Forbidden | Not logged into YunoHost portal, or app permissions not set |
| API unreachable | Check `systemctl status wg-man` and ports |
| wg-quick permission denied | Ensure systemd service runs as `User=root` |
| Headers missing (dev mode) | Set `NODE_ENV=development` — dev user mock kicks in |
