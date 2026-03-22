import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { ssowatAuth, requireAdmin, csrfProtection, APP_SESSION_TTL_MS } from '../middleware/auth';
import {
  getStatus,
  startRegistration,
  finishRegistration,
  startAuthentication,
  finishAuthentication,
  lockRegistration,
  clearPasskeys,
  getGeneration,
  getRpConfig,
  setRpConfig,
} from '../services/passkey';

const router = Router();

router.use(ssowatAuth);
router.use(csrfProtection);

// Rate limits — tighter than the general API limiter since these are
// security-sensitive endpoints. Skipped in dev.
const IS_DEV = process.env.NODE_ENV !== 'production';

const passkeyLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 40,
  skip: () => IS_DEV,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many requests' },
});

// Extra-strict limit on assertion/registration finish — actual crypto operations
const assertLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  skip: () => IS_DEV,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many requests' },
});

router.use(passkeyLimiter);

const CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const PASSKEY_WINDOW_MS = 5 * 60 * 1000;

/**
 * Resolve rpID and origin. Priority order:
 *   1. Value stored in passkeys.json (set once from UI, locked — most secure)
 *   2. PASSKEY_RP_ID / PASSKEY_RP_ORIGIN env vars
 *   3. Origin header sent by the browser (reliable on same-origin fetch())
 */
async function getRpContext(req: import('express').Request): Promise<{ rpID: string; origin: string }> {
  const stored = await getRpConfig();
  if (stored) return stored;
  const rawOrigin = req.get('origin') || `${req.protocol}://${req.hostname}`;
  const rpID = process.env.PASSKEY_RP_ID || (() => {
    try { return new URL(rawOrigin).hostname; } catch { return req.hostname; }
  })();
  const origin = process.env.PASSKEY_RP_ORIGIN || rawOrigin;
  return { rpID, origin };
}

/** POST /api/passkey/setup-domain — store rpID + origin once; change only via SSH */
router.post('/setup-domain', requireAdmin, async (req, res) => {
  const { rpID, origin } = req.body ?? {};
  if (!rpID || typeof rpID !== 'string' || !origin || typeof origin !== 'string') {
    res.status(400).json({ error: 'rpID and origin are required' });
    return;
  }
  try { new URL(origin); } catch {
    res.status(400).json({ error: 'Invalid origin — must be a full URL (e.g. https://example.com)' });
    return;
  }
  if (!/^[a-zA-Z0-9.-]+$/.test(rpID)) {
    res.status(400).json({ error: 'Invalid rpID — must be a plain hostname (e.g. example.com)' });
    return;
  }
  const result = await setRpConfig(rpID, origin);
  if (!result.ok) {
    res.status(409).json({ error: result.error, code: 'RP_LOCKED' });
    return;
  }
  res.json({ ok: true });
});

/** GET /api/passkey/session — check if current session has a valid passkey app session */
router.get('/session', async (req, res) => {
  try {
    const v = req.session?.passkeyVerified;
    const currentUser = req.user?.username;
    const verified = !!(
      v &&
      Date.now() - v.ts < APP_SESSION_TTL_MS &&
      currentUser && v.username === currentUser &&
      v.generation === getGeneration()
    );
    const status = await getStatus();
    res.json({
      verified,
      registered: status.registered,
      registrationLocked: status.registrationLocked,
      storeFile: status.storeFile,
    });
  } catch {
    res.status(500).json({ error: 'Failed to check session' });
  }
});

/** GET /api/passkey/status */
router.get('/status', async (_req, res) => {
  try {
    res.json(await getStatus());
  } catch {
    res.status(500).json({ error: 'Failed to read passkey status' });
  }
});

/** POST /api/passkey/register/start */
router.post('/register/start', requireAdmin, async (req, res) => {
  try {
    const ctx = await getRpContext(req);
    const result = await startRegistration(ctx);
    if (!result.ok) {
      res.status(403).json({ error: 'Passkey registration is locked by an administrator', code: 'REGISTRATION_LOCKED' });
      return;
    }
    req.session.passkeyChallenge = { value: result.challenge, expiresAt: Date.now() + CHALLENGE_TTL_MS, ...ctx };
    res.json(result.options);
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? 'Failed to start registration' });
  }
});

/** POST /api/passkey/register/finish */
router.post('/register/finish', assertLimiter, requireAdmin, async (req, res) => {
  const entry = req.session.passkeyChallenge;
  if (!entry || Date.now() > entry.expiresAt) {
    delete req.session.passkeyChallenge;
    res.status(400).json({ error: 'No active registration challenge or challenge expired' });
    return;
  }
  delete req.session.passkeyChallenge;

  const { name, ...attestation } = req.body;
  const result = await finishRegistration(attestation, entry.value, { rpID: entry.rpID, origin: entry.origin }, typeof name === 'string' ? name.trim().slice(0, 64) || undefined : undefined);
  if (!result.ok) { res.status(400).json({ error: result.error }); return; }
  res.json({ ok: true });
});

/** POST /api/passkey/assert/start */
router.post('/assert/start', requireAdmin, async (req, res) => {
  try {
    const status = await getStatus();
    if (!status.registered) { res.status(400).json({ error: 'No passkey registered' }); return; }
    const ctx = await getRpContext(req);
    const { options, challenge } = await startAuthentication(ctx);
    req.session.passkeyChallenge = { value: challenge, expiresAt: Date.now() + CHALLENGE_TTL_MS, ...ctx };
    res.json(options);
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? 'Failed to start authentication' });
  }
});

/** POST /api/passkey/assert/finish — verify and stamp session with generation + username */
router.post('/assert/finish', assertLimiter, requireAdmin, async (req, res) => {
  const entry = req.session.passkeyChallenge;
  if (!entry || Date.now() > entry.expiresAt) {
    delete req.session.passkeyChallenge;
    res.status(400).json({ error: 'No active authentication challenge or challenge expired' });
    return;
  }
  delete req.session.passkeyChallenge;

  const result = await finishAuthentication(req.body, entry.value, { rpID: entry.rpID, origin: entry.origin });
  if (!result.ok) { res.status(401).json({ error: result.error }); return; }

  req.session.passkeyVerified = {
    ts: Date.now(),
    username: req.user!.username,
    generation: getGeneration(),
  };
  res.json({ ok: true });
});

/** POST /api/passkey/lock-registration — requires fresh passkey session */
router.post('/lock-registration', requireAdmin, async (req, res) => {
  const v = req.session?.passkeyVerified;
  if (!v || Date.now() - v.ts > PASSKEY_WINDOW_MS || v.username !== req.user?.username || v.generation !== getGeneration()) {
    res.status(403).json({ error: 'Passkey verification required', code: 'PASSKEY_REQUIRED' });
    return;
  }
  try {
    await lockRegistration();
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Failed to lock registration' });
  }
});

/** DELETE /api/passkey/reset — requires fresh passkey session, invalidates all others */
router.delete('/reset', requireAdmin, async (req, res) => {
  const v = req.session?.passkeyVerified;
  if (!v || Date.now() - v.ts > PASSKEY_WINDOW_MS || v.username !== req.user?.username || v.generation !== getGeneration()) {
    res.status(403).json({ error: 'Passkey verification required', code: 'PASSKEY_REQUIRED' });
    return;
  }
  try {
    await clearPasskeys(); // increments _generation — invalidates all other sessions
    delete req.session.passkeyVerified;
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Failed to reset passkeys' });
  }
});

export default router;
