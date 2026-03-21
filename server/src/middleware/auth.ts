import { Request, Response, NextFunction } from 'express';
import { IncomingMessage } from 'http';
import { timingSafeEqual } from 'crypto';
import { getGeneration } from '../services/passkey';

// ── Session type augmentation ────────────────────────────────
declare module 'express-session' {
  interface SessionData {
    user?: { username: string; email?: string };
    /** Challenge stored with an expiry to prevent indefinite replay. */
    passkeyChallenge?: { value: string; expiresAt: number; rpID: string; origin: string };
    /** Verification token — bound to username and generation to survive resets. */
    passkeyVerified?: { ts: number; username: string; generation: number };
  }
}

declare global {
  namespace Express {
    interface Request {
      user?: { username: string; email?: string };
    }
  }
}

const IS_DEV = process.env.NODE_ENV !== 'production';
const PROXY_SECRET = process.env.PROXY_SECRET || '';

/**
 * Extract YNH_USER / YNH_EMAIL from headers (works for both Express and raw
 * IncomingMessage so the same logic can protect HTTP and WebSocket paths).
 */
export function extractYnhUser(headers: Record<string, string | string[] | undefined>): {
  username: string;
  email?: string;
} | null {
  const ynh_user =
    headers['ynh_user'] ||
    headers['ynh-user'] ||
    headers['x-ynh-user'] ||    // ngx.req.set_header path via $http_ynh_user at proxy time
    headers['remote-user'] ||
    headers['auth-user'] ||
    headers['x-remote-user'] ||
    headers['x-forwarded-user'];

  if (!ynh_user) return null;

  const ynh_email =
    headers['ynh_email'] ||
    headers['ynh-email'] ||
    headers['x-forwarded-email'];

  return {
    username: String(Array.isArray(ynh_user) ? ynh_user[0] : ynh_user),
    email: ynh_email ? String(Array.isArray(ynh_email) ? ynh_email[0] : ynh_email) : undefined,
  };
}

/**
 * SEC-02: timing-safe proxy secret comparison to prevent enumeration attacks.
 * In dev mode or when PROXY_SECRET is unset the check is skipped.
 */
export function verifyProxySecret(headers: Record<string, string | string[] | undefined>): boolean {
  if (IS_DEV || !PROXY_SECRET) return true;
  const sent = headers['x-wg-secret'];
  if (!sent || typeof sent !== 'string') return false;
  // Reject immediately on length mismatch to avoid buffer allocation issues,
  // but do so after confirming sent is a string (no timing leak from type check).
  if (sent.length !== PROXY_SECRET.length) return false;
  try {
    return timingSafeEqual(Buffer.from(sent), Buffer.from(PROXY_SECRET));
  } catch {
    return false;
  }
}

/**
 * Authenticate a raw IncomingMessage (used for WebSocket upgrade).
 * Returns the user object or null when authentication fails.
 */
export function authenticateRaw(req: IncomingMessage): { username: string; email?: string } | null {
  const headers = req.headers as Record<string, string | string[] | undefined>;
  if (!verifyProxySecret(headers)) {
    console.warn('[auth/ws] Rejected WebSocket — invalid proxy secret');
    return null;
  }
  if (IS_DEV) return { username: 'dev-user', email: 'dev@localhost' };
  const user = extractYnhUser(headers);
  if (user) return user;
  // SEC-03: no admin fallback — a verified proxy secret proves the request came
  // from nginx, but does NOT prove the user is authenticated. Reject and log so
  // the operator can diagnose the SSOwat misconfiguration.
  console.error(
    '[auth/ws] SECURITY: Proxy secret matched but YNH_USER absent on WS upgrade — rejecting. ' +
    'Verify SSOwat is active for this location and the app permission is granted to the user.',
  );
  return null;
}

/**
 * SSOwat header auth middleware.
 *
 * Production: nginx (via YunoHost SSOwat) injects YNH_USER/YNH_EMAIL headers
 * and the shared PROXY_SECRET after successful portal authentication.
 *
 * Development: falls back to a mock user for local frontend work.
 */
export function ssowatAuth(req: Request, res: Response, next: NextFunction): void {
  const headers = req.headers as Record<string, string | string[] | undefined>;

  // Session auth: user authenticated via Dex OIDC (req.session set by auth routes)
  if (req.session?.user) {
    req.user = req.session.user;
    next();
    return;
  }

  // AUTH-01: verify shared proxy secret (SEC-02: timing-safe comparison)
  const secretValid = verifyProxySecret(headers);
  if (!secretValid) {
    console.warn(`[auth] Rejected request — invalid proxy secret from ${req.socket.remoteAddress}`);
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const user = extractYnhUser(headers);

  if (user) {
    console.log(`[auth] Authenticated via SSOwat header: ${user.username}`);
    req.user = user;
    next();
    return;
  }

  if (IS_DEV) {
    req.user = { username: 'dev-user', email: 'dev@localhost' };
    next();
    return;
  }

  // SEC-03: no admin fallback. The proxy secret proves origin (nginx) but not
  // user identity. A missing YNH_USER header means SSOwat did not inject user
  // info — treat this as unauthenticated and log a diagnostic message.
  console.error(
    '[auth] SECURITY: Proxy secret matched but YNH_USER header is absent — rejecting. ' +
    'Check SSOwat configuration and ensure the app permission is granted to the user.',
  );
  res.status(401).json({
    error: 'Authentication headers missing — check SSOwat configuration',
  });
}

/**
 * RBAC middleware — restrict mutating endpoints to authenticated users.
 * Access control is enforced at the YunoHost level (admins group), so any
 * request that passes ssowatAuth() is already group-authorised.
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }
  next();
}

/** 5-minute window for a verified passkey session (mutation gate). */
const PASSKEY_WINDOW_MS = 5 * 60 * 1000;

/** 8-hour window for a passkey-verified app session (app-level gate). */
export const APP_SESSION_TTL_MS = 8 * 60 * 60 * 1000;

/**
 * Require an active passkey app session (verified within 8 hours).
 * Applied globally to all API routes — the app is unusable without a passkey.
 */
export function requirePasskeySession(req: Request, res: Response, next: NextFunction): void {
  const v = req.session?.passkeyVerified;
  const currentUser = req.user?.username;
  if (
    !v ||
    Date.now() - v.ts > APP_SESSION_TTL_MS ||
    !currentUser || v.username !== currentUser ||
    v.generation !== getGeneration()
  ) {
    res.status(403).json({ error: 'Passkey session required', code: 'PASSKEY_SESSION_REQUIRED' });
    return;
  }
  next();
}

/**
 * Require a recent passkey assertion (within 5 minutes).
 * Used to gate config create/edit/delete operations.
 */
export function requirePasskey(req: Request, res: Response, next: NextFunction): void {
  const v = req.session?.passkeyVerified;
  const currentUser = req.user?.username;
  if (
    !v ||
    Date.now() - v.ts > PASSKEY_WINDOW_MS ||
    !currentUser || v.username !== currentUser ||
    v.generation !== getGeneration()
  ) {
    res.status(403).json({ error: 'Passkey verification required', code: 'PASSKEY_REQUIRED' });
    return;
  }
  next();
}

/**
 * CSRF protection — require X-Requested-With header on mutations.
 */
export function csrfProtection(req: Request, res: Response, next: NextFunction): void {
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
    if (req.headers['x-requested-with'] !== 'XMLHttpRequest') {
      res.status(403).json({ error: 'CSRF check failed' });
      return;
    }
  }
  next();
}
