import { Router, Request, Response } from 'express';
import { Issuer, generators } from 'openid-client';
import type { Client } from 'openid-client';

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

function isDexConfigured(): boolean {
  return !!(DEX_ISSUER && DEX_CLIENT_ID && DEX_CLIENT_SECRET && APP_PUBLIC_URL);
}

function appBasePath(): string {
  if (!APP_PUBLIC_URL) return '/';
  try {
    return new URL(APP_PUBLIC_URL).pathname.replace(/\/?$/, '/');
  } catch {
    return '/';
  }
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
    req.session.user = {
      username: String(userinfo.preferred_username || userinfo.sub),
      email:    userinfo.email ? String(userinfo.email) : undefined,
    };
    delete req.session.oidcState;
    delete req.session.oidcNonce;
    console.log(`[auth/oidc] Login successful: ${req.session.user.username}`);
    res.redirect(base);
  } catch (err: any) {
    console.error('[auth/oidc] Callback failed:', err);
    res.redirect(`${appBasePath()}?auth_error=callback_failed`);
  }
});

/** GET /api/auth/logout — destroys the app session and redirects to YunoHost SSOwat logout */
router.get('/logout', (req: Request, res: Response) => {
  const origin = `${req.protocol}://${req.hostname}`;
  req.session.destroy(() => {
    res.redirect(`${origin}/yunohost/sso/?action=logout`);
  });
});

export default router;
