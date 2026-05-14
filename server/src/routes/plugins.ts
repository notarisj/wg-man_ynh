import { Router } from 'express';
import { ssowatAuth, requireAdmin, requirePasskey, requirePasskeySession, csrfProtection } from '../middleware/auth';
import { loadPluginsConfig, savePluginsConfig, sanitizeConfig } from '../services/pluginConfig';
import type { PluginConfig } from '../services/pluginConfig';

const router = Router();

router.use(ssowatAuth);
router.use(requirePasskeySession);
router.use(csrfProtection);

const PLUGIN_IDS = ['qbittorrent', 'radarr', 'sonarr'] as const;
type PluginId = typeof PLUGIN_IDS[number];

/** GET /api/plugins/config — return sanitized plugin config (no secrets) */
router.get('/config', requireAdmin, async (_req, res) => {
  try {
    const config = await loadPluginsConfig();
    res.json(sanitizeConfig(config));
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to load plugin config' });
  }
});

/** PUT /api/plugins/config/:id — save config for a specific plugin */
router.put('/config/:id', requireAdmin, requirePasskey, async (req, res) => {
  const id = req.params.id as PluginId;
  if (!PLUGIN_IDS.includes(id)) { res.status(400).json({ error: 'Unknown plugin' }); return; }

  const { enabled, host, port, https: useHttps, username, password, apiKey } =
    req.body as Record<string, unknown>;

  const config = await loadPluginsConfig();
  const existing: PluginConfig = config[id];

  const updated: PluginConfig = {
    enabled:  typeof enabled  === 'boolean' ? enabled  : existing.enabled,
    host:     typeof host     === 'string'  ? host.trim()     : existing.host,
    port:     typeof port     === 'number'  ? Math.floor(port) : existing.port,
    https:    typeof useHttps === 'boolean' ? useHttps : existing.https,
    username: typeof username === 'string' && username ? username : existing.username,
    // empty string means "clear"; undefined means "keep"
    password: typeof password === 'string' ? (password || undefined) : existing.password,
    apiKey:   typeof apiKey   === 'string' ? (apiKey   || undefined) : existing.apiKey,
  };

  config[id] = updated;
  try {
    await savePluginsConfig(config);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to save plugin config' });
  }
});

export default router;
