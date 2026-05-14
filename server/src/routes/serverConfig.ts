import { Router } from 'express';
import { ssowatAuth, requireAdmin, requirePasskey, requirePasskeySession, csrfProtection } from '../middleware/auth';
import { readServerConfig, updateServerConfig, validateConfigUpdate } from '../services/serverConfig';
import type { ConfigUpdate } from '../services/serverConfig';

const router = Router();

router.use(ssowatAuth);
router.use(requirePasskeySession);
router.use(csrfProtection);

/** GET /api/server-config — read current WG env values */
router.get('/', requireAdmin, (_req, res) => {
  res.json(readServerConfig());
});

/** PUT /api/server-config — update WG env values and restart service (passkey-gated) */
router.put('/', requireAdmin, requirePasskey, async (req, res) => {
  const { configDir, configPattern, staticInterface, checkIp, maxHandshakeAge } =
    req.body as Record<string, unknown>;

  const update: ConfigUpdate = {};
  if (configDir       !== undefined) update.configDir       = String(configDir);
  if (configPattern   !== undefined) update.configPattern   = String(configPattern);
  if (staticInterface !== undefined) update.staticInterface = String(staticInterface);
  if (checkIp         !== undefined) update.checkIp         = String(checkIp);
  if (maxHandshakeAge !== undefined) update.maxHandshakeAge = Number(maxHandshakeAge);

  const err = validateConfigUpdate(update);
  if (err) { res.status(400).json({ error: err }); return; }

  try {
    await updateServerConfig(update);
    res.json({ ok: true, restarting: process.env.NODE_ENV === 'production' });
  } catch (e: any) {
    res.status(500).json({ error: e.message ?? 'Failed to update config' });
  }
});

export default router;
