import { Request, Response, NextFunction } from 'express';
import { IncomingMessage } from 'http';

declare global {
  namespace Express {
    interface Request {
      user?: { username: string; email?: string };
    }
  }
}

const IS_DEV = process.env.NODE_ENV !== 'production';
const PROXY_SECRET = process.env.PROXY_SECRET || '';
const ADMIN_USERS = (process.env.ADMIN_USERS || 'admin').split(',').map((u) => u.trim()).filter(Boolean);

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
 * Verify the shared proxy secret that nginx forwards.
 * In dev mode or when PROXY_SECRET is unset the check is skipped.
 */
function verifyProxySecret(headers: Record<string, string | string[] | undefined>): boolean {
  if (IS_DEV || !PROXY_SECRET) return true;
  const sent = headers['x-wg-secret'];
  return sent === PROXY_SECRET;
}

/**
 * Authenticate a raw IncomingMessage (used for WebSocket upgrade).
 * Returns the user object or null when authentication fails.
 */
export function authenticateRaw(req: IncomingMessage): { username: string; email?: string } | null {
  const headers = req.headers as Record<string, string | string[] | undefined>;
  if (!verifyProxySecret(headers)) return null;
  if (IS_DEV) return { username: 'dev-user', email: 'dev@localhost' };
  return extractYnhUser(headers);
}

/**
 * SSOwat header auth middleware.
 *
 * Production: nginx (via YunoHost SSOwat) injects YNH_USER/YNH_EMAIL headers
 * and the shared PROXY_SECRET after successful portal authentication.
 *
 * When PROXY_SECRET is configured and verified, any request that reaches the
 * backend is trusted to have come from nginx (which already authenticated the
 * user via SSOwat). If YNH_USER is missing in this case we fall back to
 * 'admin' — this covers SSOwat versions that authenticate but don't inject
 * user headers. The secret check is what prevents local SSRF abuse.
 *
 * When PROXY_SECRET is NOT configured, YNH_USER is strictly required.
 *
 * Development: falls back to a mock user for local frontend work.
 */
export function ssowatAuth(req: Request, res: Response, next: NextFunction): void {
  const headers = req.headers as Record<string, string | string[] | undefined>;

  // AUTH-01: verify shared proxy secret
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

  // If the proxy secret is configured and matched, the request provably came
  // from nginx, which means SSOwat already authenticated the user. Fall back
  // to 'admin' to handle SSOwat versions that don't inject YNH_USER headers.
  // Without a configured secret, reject — we have no way to trust the origin.
  if (PROXY_SECRET) {
    console.warn('[auth] YNH_USER header absent but proxy secret matched — using admin fallback');
    req.user = { username: 'admin' };
    next();
    return;
  }

  // No proxy secret configured and no YNH_USER header — reject.
  console.warn(`[auth] Rejected request — no YNH_USER header, no proxy secret from ${req.socket.remoteAddress}`);
  res.status(401).json({ error: 'Authentication required' });
}

/**
 * VULN-06: RBAC middleware — restrict mutating endpoints to admin users.
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user || !ADMIN_USERS.includes(req.user.username)) {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }
  next();
}

/**
 * VULN-09: CSRF protection — require X-Requested-With header on mutations.
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
