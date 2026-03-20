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

// SEC-06: refuse to start in production without a proxy secret — an unset
// secret disables the proxy auth check entirely, allowing any local process
// to call the API as an unauthenticated admin.
if (IS_PROD && !process.env.PROXY_SECRET) {
  console.error(
    '[wg-man] FATAL: PROXY_SECRET is not set. ' +
    'All requests would bypass proxy authentication. Refusing to start.',
  );
  process.exit(1);
}

const SESSION_SECRET = process.env.SESSION_SECRET || '';
if (IS_PROD && !SESSION_SECRET) {
  console.error(
    '[wg-man] FATAL: SESSION_SECRET is not set. ' +
    'Sessions cannot be signed securely. Refusing to start.',
  );
  process.exit(1);
}

const app = express();

// Trust the loopback nginx proxy so that express-rate-limit and req.ip
// correctly reflect the real client IP from X-Forwarded-For.
app.set('trust proxy', 'loopback');

// SEC-08: restrictive Content Security Policy for the SPA.
// - script-src 'self': no inline scripts, no CDN scripts
// - style-src allows unsafe-inline (React inline styles) and Google Fonts stylesheet
// - font-src allows Google Fonts font files
// - connect-src allows same-origin XHR/fetch and WebSocket (wss: in prod, ws: in dev)
// - frame-ancestors 'none': no embedding in iframes (clickjacking protection)
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc:      ["'self'"],
        scriptSrc:       ["'self'"],
        styleSrc:        ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc:         ["'self'", 'https://fonts.gstatic.com'],
        imgSrc:          ["'self'", 'data:'],
        connectSrc:      ["'self'", 'wss:', 'ws:'],
        objectSrc:       ["'none'"],
        frameAncestors:  ["'none'"],
        baseUri:         ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  }),
);

// CORS: in production only allow same-origin (nginx proxy), in dev allow all
if (!IS_PROD) {
  app.use(
    cors({
      origin: ['http://localhost:5173', 'http://localhost:3001'],
      credentials: true,
    }),
  );
}

app.use(express.json());

// SEC-09: session hardening — 4-hour max age with sliding renewal,
// SEC-10: sameSite 'strict' to prevent cross-site cookie submission.
app.use(session({
  secret: SESSION_SECRET || 'dev-only-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  rolling: true,            // SEC-09: reset maxAge on every response (sliding session)
  cookie: {
    httpOnly: true,
    secure: IS_PROD,        // require HTTPS in production
    sameSite: 'strict',     // SEC-10: upgraded from 'lax' — no cross-site cookie submission
    maxAge: 4 * 60 * 60 * 1000, // SEC-09: 4 hours (down from 7 days)
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
