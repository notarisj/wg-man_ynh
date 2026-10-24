import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage, Server } from 'http';
import { getStatus, tailLog } from './services/wg';
import { getSystemMetrics } from './services/system';
import type { RequestHandler } from 'express';
import { authenticateRaw, APP_SESSION_TTL_MS } from './middleware/auth';
import { getGeneration } from './services/passkey';

const PUSH_INTERVAL_MS = 5000;
// SEC-07: cap concurrent WebSocket connections to prevent resource exhaustion.
// Each connection spawns a setInterval that runs wg + ping every 5 s.
const MAX_WS_CLIENTS = parseInt(process.env.MAX_WS_CLIENTS || '10', 10);

export function createWebSocketServer(httpServer: Server, sessionMiddleware: RequestHandler): WebSocketServer {
  // API-03: cap incoming frame size to 1 KiB
  const wss = new WebSocketServer({ server: httpServer, path: '/ws', maxPayload: 1024 });

  wss.on('connection', async (ws: WebSocket, req: IncomingMessage) => {
    // SEC-07: reject connections beyond the limit before authentication so the
    // auth check itself is not a resource sink.
    if (wss.clients.size > MAX_WS_CLIENTS) {
      ws.close(1013 /* Try Again Later */, 'Too many connections');
      return;
    }

    // VULN-02: authenticate WebSocket on upgrade
    const user = authenticateRaw(req);
    if (!user) {
      ws.close(4401, 'Unauthorized');
      return;
    }

    // Require the same passkey app session as the HTTP API (not just SSOwat)
    // and a same-origin upgrade (blocks cross-site WebSocket hijacking).
    const origin = req.headers.origin;
    let originOk = false;
    try { originOk = !!origin && new URL(origin).host === req.headers.host; } catch { /* bad Origin */ }
    if (!originOk) {
      ws.close(4403, 'Forbidden origin');
      return;
    }
    const passkeyOk = await new Promise<boolean>((resolve) => {
      sessionMiddleware(req as any, {} as any, () => {
        const v = (req as any).session?.passkeyVerified;
        resolve(!!v && Date.now() - v.ts <= APP_SESSION_TTL_MS &&
                v.username === user.username && v.generation === getGeneration());
      });
    });
    if (!passkeyOk) {
      ws.close(4403, 'Passkey session required');
      return;
    }

    console.log(`[WS] Client connected: ${user.username} from ${req.socket.remoteAddress}`);

    // Send initial status + logs + system metrics immediately
    sendStatus(ws);
    sendLogs(ws);
    sendSystem(ws);

    // Poll and push every PUSH_INTERVAL_MS
    const interval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        sendStatus(ws);
        sendLogs(ws);
        sendSystem(ws);
      }
    }, PUSH_INTERVAL_MS);

    ws.on('close', () => {
      clearInterval(interval);
      console.log('[WS] Client disconnected');
    });

    ws.on('error', (err) => {
      clearInterval(interval);
      console.error('[WS] Socket error:', err.message);
    });

    // Support ping/pong keepalive from client
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }));
        }
      } catch {
        // ignore malformed messages
      }
    });
  });

  return wss;
}

async function sendStatus(ws: WebSocket): Promise<void> {
  try {
    const status = await getStatus();
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'status', payload: status, ts: Date.now() }));
    }
  } catch {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'error', payload: { message: 'Status check failed' }, ts: Date.now() }));
    }
  }
}

async function sendLogs(ws: WebSocket): Promise<void> {
  try {
    const logs = await tailLog(10);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'logs', payload: logs, ts: Date.now() }));
    }
  } catch { /* ignore */ }
}

async function sendSystem(ws: WebSocket): Promise<void> {
  try {
    const metrics = await getSystemMetrics();
    if (metrics && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'system', payload: metrics, ts: Date.now() }));
    }
  } catch { /* ignore */ }
}
