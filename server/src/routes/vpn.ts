import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { ssowatAuth, requireAdmin, requirePasskey, requirePasskeySession, csrfProtection } from '../middleware/auth';
import {
  getStatus,
  listConfigs,
  switchConfig,
  disconnectVPN,
  runMonitor,
  tailLog,
  searchLog,
  readConfig,
  createConfig,
  updateConfig,
  deleteConfig,
  readScript,
  writeScript,
  validateScript,
  MONITOR_SCRIPT_PATH,
} from '../services/wg';
import { getCronStatus, setCron, disableCron } from '../services/cron';
import { getHistory } from '../services/vpnHistory';

const router = Router();

// ── Global middleware ────────────────────────────────────────

// Apply SSOwat auth to all routes
router.use(ssowatAuth);

// /me must be reachable before the passkey gate — AuthGuard uses it to
// confirm SSOwat identity. Everything else is gated by requirePasskeySession.
router.get('/me', (req, res) => { res.json({ user: req.user }); });

// Require active passkey app session — the entire app is gated behind passkey
router.use(requirePasskeySession);

// VULN-09: CSRF protection on state-mutating methods
router.use(csrfProtection);

// VULN-08: general API rate limit — 30 req/min per IP (skipped in dev)
const IS_DEV = process.env.NODE_ENV !== 'production';

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  skip: () => IS_DEV,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests' },
});
router.use(apiLimiter);

// VULN-08: stricter limit for mutations — 5 req/min per IP (skipped in dev)
const mutationLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  skip: () => IS_DEV,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests' },
});

// ── Read-only routes ─────────────────────────────────────────

/** GET /api/status — VPN connection status */
router.get('/status', async (_req, res) => {
  try {
    const status = await getStatus();
    res.json(status);
  } catch (err: any) {
    console.error('[api] Failed to get status:', err);
    res.status(500).json({ error: 'Failed to get status' });
  }
});

/** GET /api/configs — list all matching .conf files */
router.get('/configs', async (_req, res) => {
  try {
    const configs = await listConfigs();
    res.json(configs);
  } catch (err: any) {
    console.error('[api] Failed to list configs:', err);
    res.status(500).json({ error: 'Failed to list configs' });
  }
});

/** GET /api/logs?lines=100 — tail the vpn-monitor log */
router.get('/logs', async (req, res) => {
  const lines = Math.min(parseInt(String(req.query.lines || '100'), 10) || 100, 500);
  try {
    const logLines = await tailLog(lines);
    res.json(logLines);
  } catch (err: any) {
    console.error('[api] Failed to read logs:', err);
    res.status(500).json({ error: 'Failed to read logs' });
  }
});

/** GET /api/logs/search?q=term — grep the full log file */
router.get('/logs/search', async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 200);
  if (!q) return res.json([]);
  try {
    const results = await searchLog(q);
    res.json(results);
  } catch (err: any) {
    console.error('[api] Log search failed:', err);
    res.status(500).json({ error: 'Search failed' });
  }
});

/** GET /api/history?limit=500 — VPN connection history */
router.get('/history', async (req, res) => {
  const limit = Math.min(parseInt(String(req.query.limit || '500'), 10) || 500, 2000);
  try {
    res.json(await getHistory(limit));
  } catch (err: any) {
    console.error('[api] Failed to read history:', err);
    res.status(500).json({ error: 'Failed to read history' });
  }
});

// ── Mutating routes (VULN-06: admin-only + rate-limited) ────

/** POST /api/connect — run vpn-monitor.sh (failover/auto-connect) */
router.post('/connect', mutationLimiter, requireAdmin, async (_req, res) => {
  try {
    const result = await runMonitor();
    res.json(result);
  } catch (err: any) {
    console.error('[api] Failed to run monitor:', err);
    res.status(500).json({ error: 'Failed to run monitor' });
  }
});

/** POST /api/switch/:name — switch to a specific config */
router.post('/switch/:name', mutationLimiter, requireAdmin, async (req, res) => {
  const { name } = req.params;
  try {
    const result = await switchConfig(name);
    if (!result.success) {
      res.status(400).json(result);
      return;
    }
    res.json(result);
  } catch (err: any) {
    console.error('[api] Failed to switch config:', err);
    res.status(500).json({ error: 'Failed to switch config' });
  }
});

/** POST /api/disconnect — bring down wg-vpn */
router.post('/disconnect', mutationLimiter, requireAdmin, async (_req, res) => {
  try {
    const result = await disconnectVPN();
    res.json(result);
  } catch (err: any) {
    console.error('[api] Failed to disconnect:', err);
    res.status(500).json({ error: 'Failed to disconnect' });
  }
});

// ── Cron management ──────────────────────────────────────────

/** GET /api/cron — read current cron job status */
router.get('/cron', async (_req, res) => {
  try {
    const status = await getCronStatus();
    res.json(status);
  } catch (err: any) {
    console.error('[api] Failed to read cron status:', err);
    res.status(500).json({ error: 'Failed to read cron status' });
  }
});

/** POST /api/cron — enable or update the cron schedule */
router.post('/cron', mutationLimiter, requireAdmin, async (req, res) => {
  const { schedule } = req.body as { schedule?: unknown };
  if (typeof schedule !== 'string' || !schedule.trim()) {
    res.status(400).json({ error: 'schedule is required' });
    return;
  }
  try {
    await setCron(schedule.trim());
    res.json({ ok: true });
  } catch (err: any) {
    console.error('[api] Failed to set cron:', err);
    res.status(400).json({ error: err.message ?? 'Failed to set cron' });
  }
});

/** DELETE /api/cron — disable (remove) the cron job */
router.delete('/cron', mutationLimiter, requireAdmin, async (_req, res) => {
  try {
    await disableCron();
    res.json({ ok: true });
  } catch (err: any) {
    console.error('[api] Failed to disable cron:', err);
    res.status(500).json({ error: 'Failed to disable cron' });
  }
});

// ── Monitor script ────────────────────────────────────────────

/** GET /api/script — read monitor script content */
router.get('/script', async (_req, res) => {
  try {
    const content = await readScript();
    res.json({ content, path: MONITOR_SCRIPT_PATH });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to read script' });
  }
});

/** POST /api/script/validate — check bash syntax without saving */
router.post('/script/validate', async (req, res) => {
  const { content } = req.body as { content?: unknown };
  if (typeof content !== 'string' || !content.trim()) {
    res.status(400).json({ error: 'content is required' }); return;
  }
  try {
    const result = await validateScript(content);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? 'Validation failed' });
  }
});

/** PUT /api/script — overwrite monitor script (passkey-gated) */
router.put('/script', mutationLimiter, requireAdmin, requirePasskey, async (req, res) => {
  const { content } = req.body as { content?: unknown };
  if (typeof content !== 'string' || !content.trim()) {
    res.status(400).json({ error: 'content is required' }); return;
  }
  try {
    await writeScript(content);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? 'Failed to save script' });
  }
});

// ── Config CRUD (passkey-gated) ───────────────────────────────

/** GET /api/configs/:name/content — read raw config file content */
router.get('/configs/:name/content', requireAdmin, async (req, res) => {
  try {
    const content = await readConfig(req.params.name);
    res.json({ content });
  } catch (err: any) {
    res.status(404).json({ error: 'Config not found' });
  }
});

/** POST /api/configs — create a new config file */
router.post('/configs', mutationLimiter, requireAdmin, requirePasskey, async (req, res) => {
  const { name, content } = req.body as { name?: unknown; content?: unknown };
  if (typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'name is required' }); return;
  }
  if (typeof content !== 'string' || !content.trim()) {
    res.status(400).json({ error: 'content is required' }); return;
  }
  const result = await createConfig(name.trim(), content);
  if (!result.success) { res.status(400).json({ error: result.message }); return; }
  res.json({ ok: true, message: result.message });
});

/** PUT /api/configs/:name — overwrite an existing config file */
router.put('/configs/:name', mutationLimiter, requireAdmin, requirePasskey, async (req, res) => {
  const { content } = req.body as { content?: unknown };
  if (typeof content !== 'string' || !content.trim()) {
    res.status(400).json({ error: 'content is required' }); return;
  }
  const result = await updateConfig(req.params.name, content);
  if (!result.success) { res.status(400).json({ error: result.message }); return; }
  res.json({ ok: true, message: result.message });
});

/** DELETE /api/configs/:name — delete a config file */
router.delete('/configs/:name', mutationLimiter, requireAdmin, requirePasskey, async (req, res) => {
  const result = await deleteConfig(req.params.name);
  if (!result.success) { res.status(400).json({ error: result.message }); return; }
  res.json({ ok: true, message: result.message });
});

export default router;
