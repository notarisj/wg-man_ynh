import { Router, Request, Response } from 'express';
import { Issuer, generators } from 'openid-client';
import type { Client } from 'openid-client';
import { execFile } from 'child_process';
import { promisify } from 'util';

// ── Session type augmentation ───────────────────────────────
declare module 'express-session' {
  interface SessionData {
    user?: { username: string; email?: string };
    oidcState?: string;
    oidcNonce?: string;
  }
}

const router = Router();

const DEX_ISSUER        = process.env.DEX_ISSUER        || '';
const DEX_CLIENT_ID     = process.env.DEX_CLIENT_ID     || '';
const DEX_CLIENT_SECRET = process.env.DEX_CLIENT_SECRET || '';
const APP_PUBLIC_URL    = process.env.APP_PUBLIC_URL    || '';

// SEC-01: groups that are allowed to authenticate via Dex OIDC.
// Must match the YunoHost permission group set at install time (default: admins).
const ALLOWED_GROUPS = (process.env.ALLOWED_GROUPS || 'admins')
  .split(',')
  .map((g) => g.trim())
  .filter(Boolean);

const execFileAsync = promisify(execFile);

/**
 * SEC-01: verify the authenticated OIDC user is a member of an allowed
 * YunoHost group. Calls `yunohost user info` which is available on any
 * YunoHost install. Returns false on any error (deny-by-default).
 */
async function isUserInAllowedGroup(username: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync(
      'yunohost',
      ['user', 'info', username, '--output-as', 'json'],
      { timeout: 10_000 },
    );
    const info = JSON.parse(stdout) as { groups?: unknown };
    const userGroups: string[] = Array.isArray(info.groups) ? (info.groups as string[]) : [];
    return ALLOWED_GROUPS.some((g) => userGroups.includes(g));
  } catch (err: any) {
    console.error(`[auth/oidc] Group membership check failed for "${username}":`, err?.message ?? err);
    return false;
  }
}

function isDexConfigured(): boolean {
  return !!(DEX_ISSUER && DEX_CLIENT_ID && DEX_CLIENT_SECRET && APP_PUBLIC_URL);
}

/**
 * SEC-05: derive the app base path from the server-side APP_PUBLIC_URL
 * instead of from request headers (prevents Host-header injection).
 */
function appBasePath(): string {
  if (!APP_PUBLIC_URL) return '/';
  try {
    return new URL(APP_PUBLIC_URL).pathname.replace(/\/?$/, '/');
  } catch {
    return '/';
  }
}

/**
 * SEC-05: derive the trusted origin for redirects from the server-side
 * APP_PUBLIC_URL, never from request headers.
 */
function trustedOrigin(): string {
  if (APP_PUBLIC_URL) {
    try {
      const u = new URL(APP_PUBLIC_URL);
      return u.origin;
    } catch {
      // fall through
    }
  }
  // Last-resort fallback — should not be reached when APP_PUBLIC_URL is set
  // (which it always is in a YunoHost install).
  return '';
}

// Lazy-loaded and cached OIDC client (discovered at first use)
let _oidcClient: Client | null = null;
async function getOidcClient(): Promise<Client> {
  if (_oidcClient) return _oidcClient;
  const issuer = await Issuer.discover(DEX_ISSUER);
  _oidcClient = new issuer.Client({
    client_id: DEX_CLIENT_ID,
    client_secret: DEX_CLIENT_SECRET,
    redirect_uris: [`${APP_PUBLIC_URL}/api/auth/callback`],
    response_types: ['code'],
  });
  return _oidcClient;
}

// ── Routes ──────────────────────────────────────────────────

/** GET /api/auth/config — tells the frontend whether Dex login is available */
router.get('/config', (_req, res) => {
  res.json({ dexEnabled: isDexConfigured() });
});

/** GET /api/auth/login — starts Dex OIDC authorization code flow */
router.get('/login', async (req: Request, res: Response) => {
  if (!isDexConfigured()) {
    res.status(503).json({ error: 'Dex OIDC is not configured on this server' });
    return;
  }
  try {
    const client = await getOidcClient();
    const state = generators.state();
    const nonce = generators.nonce();
    req.session.oidcState = state;
    req.session.oidcNonce = nonce;
    const url = client.authorizationUrl({ scope: 'openid profile email', state, nonce });
    res.redirect(url);
  } catch (err: any) {
    console.error('[auth/oidc] Failed to start OIDC flow:', err);
    res.status(500).json({ error: 'Failed to initiate OIDC login' });
  }
});

/** GET /api/auth/callback — Dex redirects here after the user authenticates */
router.get('/callback', async (req: Request, res: Response) => {
  const base = appBasePath();
  if (!isDexConfigured()) {
    res.redirect(`${base}?auth_error=not_configured`);
    return;
  }
  try {
    const client = await getOidcClient();
    const params = client.callbackParams(req);
    const tokenSet = await client.callback(
      `${APP_PUBLIC_URL}/api/auth/callback`,
      params,
      { state: req.session.oidcState, nonce: req.session.oidcNonce },
    );
    const userinfo = await client.userinfo(tokenSet.access_token!);
    const username = String(userinfo.preferred_username || userinfo.sub);

    // SEC-01: enforce YunoHost group membership before granting a session.
    // This prevents LDAP users who are not in the admins group from gaining
    // access via Dex even though SSOwat would normally block them.
    const allowed = await isUserInAllowedGroup(username);
    if (!allowed) {
      console.warn(`[auth/oidc] Access denied for "${username}" — not in allowed groups: ${ALLOWED_GROUPS.join(', ')}`);
      res.redirect(`${base}?auth_error=forbidden`);
      return;
    }

    req.session.user = {
      username,
      email: userinfo.email ? String(userinfo.email) : undefined,
    };
    delete req.session.oidcState;
    delete req.session.oidcNonce;
    console.log(`[auth/oidc] Login successful: ${username}`);
    res.redirect(base);
  } catch (err: any) {
    console.error('[auth/oidc] Callback failed:', err);
    res.redirect(`${appBasePath()}?auth_error=callback_failed`);
  }
});

/**
 * GET /api/auth/logout — destroys the app session and redirects to YunoHost
 * SSOwat logout. SEC-05: the redirect target is derived from the server-side
 * APP_PUBLIC_URL, not from the Host / X-Forwarded-Host request header.
 */
router.get('/logout', (req: Request, res: Response) => {
  // SEC-05: use the configured server origin, never req.hostname
  const origin = trustedOrigin();
  req.session.destroy(() => {
    res.redirect(`${origin}/yunohost/sso/?action=logout`);
  });
});

export default router;
