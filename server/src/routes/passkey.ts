import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { ssowatAuth, requireAdmin, csrfProtection } from '../middleware/auth';
import {
  getStatus,
  startRegistration,
  finishRegistration,
  startAuthentication,
  finishAuthentication,
  lockRegistration,
  clearPasskeys,
  getGeneration,
} from '../services/passkey';

const router = Router();

router.use(ssowatAuth);
router.use(csrfProtection);

// Rate limits — tighter than the general API limiter since these are
// security-sensitive endpoints. Skipped in dev.
const passkeyLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: process.env.NODE_ENV === 'development' ? 0 : 20,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many requests' },
});

// Extra-strict limit on assertion/registration finish — actual crypto operations
const assertLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: process.env.NODE_ENV === 'development' ? 0 : 5,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many requests' },
});

router.use(passkeyLimiter);

const CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const PASSKEY_WINDOW_MS = 5 * 60 * 1000;

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
    const result = await startRegistration();
    if (!result.ok) {
      res.status(403).json({ error: 'Passkey registration is locked by an administrator', code: 'REGISTRATION_LOCKED' });
      return;
    }
    req.session.passkeyChallenge = { value: result.challenge, expiresAt: Date.now() + CHALLENGE_TTL_MS };
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

  const result = await finishRegistration(req.body, entry.value);
  if (!result.ok) { res.status(400).json({ error: result.error }); return; }
  res.json({ ok: true });
});

/** POST /api/passkey/assert/start */
router.post('/assert/start', requireAdmin, async (req, res) => {
  try {
    const status = await getStatus();
    if (!status.registered) { res.status(400).json({ error: 'No passkey registered' }); return; }
    const { options, challenge } = await startAuthentication();
    req.session.passkeyChallenge = { value: challenge, expiresAt: Date.now() + CHALLENGE_TTL_MS };
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

  const result = await finishAuthentication(req.body, entry.value);
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
