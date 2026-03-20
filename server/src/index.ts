import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import { createServer } from 'http';
import authRouter from './routes/auth';
import vpnRouter from './routes/vpn';
import { createWebSocketServer } from './websocket';

const PORT = parseInt(process.env.PORT || '3001', 10);
const IS_PROD = process.env.NODE_ENV === 'production';
const STATIC_DIR = path.resolve(__dirname, '../../dist'); // built frontend

const app = express();

// Trust the loopback nginx proxy so that express-rate-limit and req.ip
// correctly reflect the real client IP from X-Forwarded-For.
app.set('trust proxy', 'loopback');

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

// Session middleware — used by the Dex OIDC auth flow
const SESSION_SECRET = process.env.SESSION_SECRET || '';
if (IS_PROD && !SESSION_SECRET) {
  console.warn('[wg-man] WARNING: SESSION_SECRET is not set — sessions will not persist across restarts');
}
app.use(session({
  secret: SESSION_SECRET || 'dev-only-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: IS_PROD,   // require HTTPS in production
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  },
}));

// Health check (no auth required)
app.get('/healthz', (_req, res) => {
  res.json({ status: 'ok', ts: Date.now() });
});

// Auth routes (OIDC + logout) — mounted before vpnRouter so they bypass ssowatAuth
app.use('/api/auth', authRouter);

// API routes (protected by ssowatAuth inside vpnRouter)
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
