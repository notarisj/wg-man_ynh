import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage, Server } from 'http';
import { getStatus, tailLog } from './services/wg';
import { authenticateRaw } from './middleware/auth';

const PUSH_INTERVAL_MS = 5000;

export function createWebSocketServer(httpServer: Server): WebSocketServer {
  // API-03: cap incoming frame size to 1 KiB
  const wss = new WebSocketServer({ server: httpServer, path: '/ws', maxPayload: 1024 });

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    // VULN-02: authenticate WebSocket on upgrade
    const user = authenticateRaw(req);
    if (!user) {
      ws.close(4401, 'Unauthorized');
      return;
    }

    console.log(`[WS] Client connected: ${user.username} from ${req.socket.remoteAddress}`);

    // Send initial status + logs immediately
    sendStatus(ws);
    sendLogs(ws);

    // Poll and push every PUSH_INTERVAL_MS
    const interval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        sendStatus(ws);
        sendLogs(ws);
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
