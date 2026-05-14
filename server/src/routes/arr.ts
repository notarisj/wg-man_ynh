import { Router } from 'express';
import { ssowatAuth, requireAdmin, requirePasskeySession, csrfProtection } from '../middleware/auth';
import { loadPluginsConfig } from '../services/pluginConfig';

// Shared proxy factory for Radarr and Sonarr (identical API surface, different defaults)
export function makeArrRouter(plugin: 'radarr' | 'sonarr'): Router {
  const router = Router();
  router.use(ssowatAuth);
  router.use(requirePasskeySession);
  router.use(csrfProtection);

  async function arr(path: string, options: RequestInit = {}): Promise<Response> {
    const cfg = (await loadPluginsConfig())[plugin];
    if (!cfg.enabled) throw Object.assign(new Error(`${plugin} plugin is not enabled`), { code: 'NOT_ENABLED' });
    if (!cfg.apiKey)  throw Object.assign(new Error(`${plugin} API key not configured`), { code: 'NO_API_KEY' });

    const base = `${cfg.https ? 'https' : 'http'}://${cfg.host}:${cfg.port}`;
    return fetch(`${base}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key':    cfg.apiKey,
        ...(options.headers || {}),
      },
      signal: AbortSignal.timeout(10_000),
    });
  }

  function handleErr(res: Response, next: (e: any) => void) {
    next(Object.assign(new Error(`${plugin} returned ${res.status}`), { status: res.status }));
  }

  /** GET /queue — list download queue */
  router.get('/queue', requireAdmin, async (_req, res, next) => {
    try {
      const r = await arr('/api/v3/queue?pageSize=100&sortKey=timeleft&sortDirection=ascending');
      if (!r.ok) return handleErr(r, next);
      res.json(await r.json());
    } catch (e) { next(e); }
  });

  /** DELETE /queue/:id — remove from queue */
  router.delete('/queue/:id', requireAdmin, async (req, res, next) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }
    const removeFromClient = req.query.removeFromClient !== 'false';
    const blocklist        = req.query.blocklist === 'true';
    try {
      const r = await arr(
        `/api/v3/queue/${id}?removeFromClient=${removeFromClient}&blocklist=${blocklist}`,
        { method: 'DELETE' },
      );
      if (!r.ok) return handleErr(r, next);
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  /** POST /queue/:id/reject — blocklist current grab and trigger new search */
  router.post('/queue/:id/reject', requireAdmin, async (req, res, next) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }

    // The caller sends us the entity IDs needed for the search command
    const { movieId, episodeId, seriesId, seasonNumber } =
      req.body as { movieId?: number; episodeId?: number; seriesId?: number; seasonNumber?: number };

    try {
      // 1. Remove from queue + add to blocklist
      const delRes = await arr(
        `/api/v3/queue/${id}?removeFromClient=true&blocklist=true`,
        { method: 'DELETE' },
      );
      if (!delRes.ok) return handleErr(delRes, next);

      // 2. Trigger a new search for the same content
      let command: Record<string, unknown>;
      if (plugin === 'radarr' && movieId) {
        command = { name: 'MoviesSearch', movieIds: [movieId] };
      } else if (plugin === 'sonarr' && episodeId) {
        command = { name: 'EpisodeSearch', episodeIds: [episodeId] };
      } else if (plugin === 'sonarr' && seriesId && seasonNumber !== undefined) {
        command = { name: 'SeasonSearch', seriesId, seasonNumber };
      } else {
        res.json({ ok: true, searched: false, note: 'No entity id provided — skipped re-search' });
        return;
      }

      const cmdRes = await arr('/api/v3/command', {
        method: 'POST',
        body:   JSON.stringify(command),
      });
      res.json({ ok: true, searched: cmdRes.ok });
    } catch (e) { next(e); }
  });

  /** GET /releases — interactive search for a movie / episode */
  router.get('/releases', requireAdmin, async (req, res, next) => {
    try {
      const params = new URLSearchParams();
      if (req.query.movieId)      params.set('movieId',      String(req.query.movieId));
      if (req.query.episodeId)    params.set('episodeId',    String(req.query.episodeId));
      if (req.query.seriesId)     params.set('seriesId',     String(req.query.seriesId));
      if (req.query.seasonNumber) params.set('seasonNumber', String(req.query.seasonNumber));
      const r = await arr(`/api/v3/release?${params.toString()}`);
      if (!r.ok) return handleErr(r, next);
      res.json(await r.json());
    } catch (e) { next(e); }
  });

  /** POST /releases/grab — grab a specific release from interactive search */
  router.post('/releases/grab', requireAdmin, async (req, res, next) => {
    const { guid, indexerId } = req.body as { guid?: string; indexerId?: number };
    if (!guid) { res.status(400).json({ error: 'guid is required' }); return; }
    try {
      const r = await arr('/api/v3/release', {
        method: 'POST',
        body: JSON.stringify({ guid, indexerId }),
      });
      if (!r.ok) return handleErr(r, next);
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  // Error handler
  router.use((err: any, _req: any, res: any, _next: any) => {
    if (err.code === 'NOT_ENABLED') { res.status(503).json({ error: 'Plugin not enabled' }); return; }
    if (err.code === 'NO_API_KEY')  { res.status(503).json({ error: `${plugin} API key not configured` }); return; }
    if (err.name === 'AbortError' || err.name === 'TimeoutError') { res.status(504).json({ error: `${plugin} unreachable (timeout)` }); return; }
    if (err.status === 401) { res.status(401).json({ error: `${plugin} API key invalid` }); return; }
    console.error(`[${plugin} proxy]`, err.message);
    res.status(502).json({ error: err.message ?? `${plugin} proxy error` });
  });

  return router;
}
