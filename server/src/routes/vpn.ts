import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { ssowatAuth, requireAdmin, csrfProtection } from '../middleware/auth';
import {
  getStatus,
  listConfigs,
  switchConfig,
  disconnectVPN,
  runMonitor,
  tailLog,
  searchLog,
} from '../services/wg';
import { getCronStatus, setCron, disableCron } from '../services/cron';

const router = Router();

// ── Global middleware ────────────────────────────────────────

// Apply SSOwat auth to all routes
router.use(ssowatAuth);

// VULN-09: CSRF protection on state-mutating methods
router.use(csrfProtection);

// VULN-08: general API rate limit — 30 req/min per IP (skipped in dev)
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: process.env.NODE_ENV === 'development' ? 0 : 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests' },
});
router.use(apiLimiter);

// VULN-08: stricter limit for mutations — 5 req/min per IP (skipped in dev)
const mutationLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: process.env.NODE_ENV === 'development' ? 0 : 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests' },
});

// ── Read-only routes ─────────────────────────────────────────

/** GET /api/me — echo back the authenticated user */
router.get('/me', (req, res) => {
  res.json({ user: req.user });
});

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

export default router;
