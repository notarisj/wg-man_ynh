import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import { createServer } from 'http';
import vpnRouter from './routes/vpn';
import { createWebSocketServer } from './websocket';

const PORT = parseInt(process.env.PORT || '3001', 10);
const IS_PROD = process.env.NODE_ENV === 'production';
const STATIC_DIR = path.resolve(__dirname, '../../dist'); // built frontend

const app = express();

// Security headers (relaxed for local API usage)
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  })
);

// CORS: in production only allow same-origin (nginx proxy), in dev allow all
if (!IS_PROD) {
  app.use(
    cors({
      origin: ['http://localhost:5173', 'http://localhost:3001'],
      credentials: true,
    })
  );
}

app.use(express.json());

// Health check (no auth required)
app.get('/healthz', (_req, res) => {
  res.json({ status: 'ok', ts: Date.now() });
});

// API routes
app.use('/api', vpnRouter);

// Serve built frontend in production
if (IS_PROD) {
  app.use(express.static(STATIC_DIR));
  // SPA fallback
  app.get('*', (_req, res) => {
    res.sendFile(path.join(STATIC_DIR, 'index.html'));
  });
}

// Create HTTP server and attach WebSocket
const httpServer = createServer(app);
createWebSocketServer(httpServer);

// Bind only to localhost — nginx will proxy from outside
httpServer.listen(PORT, '127.0.0.1', () => {
  console.log(`[wg-man] API server running on http://127.0.0.1:${PORT}`);
  console.log(`[wg-man] Mode: ${IS_PROD ? 'production' : 'development'}`);
  if (IS_PROD) {
    console.log(`[wg-man] Serving frontend from: ${STATIC_DIR}`);
  }
});

export default app;
