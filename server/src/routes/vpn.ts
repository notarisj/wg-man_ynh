import { Router } from 'express';
import { ssowatAuth } from '../middleware/auth';
import {
  getStatus,
  listConfigs,
  switchConfig,
  disconnectVPN,
  runMonitor,
  tailLog,
} from '../services/wg';

const router = Router();

// Apply SSOwat auth to all routes
router.use(ssowatAuth);

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
    res.status(500).json({ error: 'Failed to get status', detail: err.message });
  }
});

/** GET /api/configs — list all nl-ams-wg-*.conf files */
router.get('/configs', async (_req, res) => {
  try {
    const configs = await listConfigs();
    res.json(configs);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to list configs', detail: err.message });
  }
});

/** POST /api/connect — run vpn-monitor.sh (failover/auto-connect) */
router.post('/connect', async (_req, res) => {
  try {
    const result = await runMonitor();
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to run monitor', detail: err.message });
  }
});

/** POST /api/switch/:name — switch to a specific config */
router.post('/switch/:name', async (req, res) => {
  const { name } = req.params;
  try {
    const result = await switchConfig(name);
    if (!result.success) {
      res.status(400).json(result);
      return;
    }
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to switch config', detail: err.message });
  }
});

/** POST /api/disconnect — bring down wg-vpn */
router.post('/disconnect', async (_req, res) => {
  try {
    const result = await disconnectVPN();
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to disconnect', detail: err.message });
  }
});

/** GET /api/logs?lines=100 — tail the vpn-monitor log */
router.get('/logs', async (req, res) => {
  const lines = Math.min(parseInt(String(req.query.lines || '100'), 10), 500);
  try {
    const logLines = await tailLog(lines);
    res.json(logLines);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to read logs', detail: err.message });
  }
});

export default router;
