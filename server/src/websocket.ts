import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage, Server } from 'http';
import { getStatus } from './services/wg';

const PUSH_INTERVAL_MS = 5000;

export function createWebSocketServer(httpServer: Server): WebSocketServer {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    // In production, the YNH_USER header is already verified by nginx
    // before traffic reaches this server — no additional auth needed on WS
    console.log(`[WS] Client connected from ${req.socket.remoteAddress}`);

    // Send initial status immediately
    sendStatus(ws);

    // Poll and push every PUSH_INTERVAL_MS
    const interval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        sendStatus(ws);
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
  } catch (err: any) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'error', payload: { message: err.message }, ts: Date.now() }));
    }
  }
}
