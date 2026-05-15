import { Router } from 'express';
import { ssowatAuth, requireAdmin, requirePasskeySession, csrfProtection } from '../middleware/auth';
import { loadPluginsConfig } from '../services/pluginConfig';

const router = Router();
router.use(ssowatAuth);
router.use(requirePasskeySession);
router.use(csrfProtection);

// ── Session cache ────────────────────────────────────────────
let cachedSID: string | null = null;

async function getBaseUrl(): Promise<string> {
  const cfg = (await loadPluginsConfig()).qbittorrent;
  if (!cfg.enabled) throw Object.assign(new Error('qBittorrent plugin is not enabled'), { code: 'NOT_ENABLED' });
  return `${cfg.https ? 'https' : 'http'}://${cfg.host}:${cfg.port}`;
}

async function login(): Promise<string> {
  const cfg = (await loadPluginsConfig()).qbittorrent;
  const base = `${cfg.https ? 'https' : 'http'}://${cfg.host}:${cfg.port}`;
  const res = await fetch(`${base}/api/v2/auth/login`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({ username: cfg.username || '', password: cfg.password || '' }).toString(),
    signal:  AbortSignal.timeout(8000),
  });
  const cookie = res.headers.get('set-cookie') || '';
  const m = cookie.match(/SID=([^;]+)/);
  if (!m) throw new Error('qBittorrent login failed — check credentials');
  return m[1];
}

async function qbit(path: string, options: RequestInit = {}): Promise<Response> {
  const base = await getBaseUrl();
  if (!cachedSID) cachedSID = await login();

  const doReq = (sid: string) => fetch(`${base}${path}`, {
    ...options,
    headers: { ...(options.headers || {}), Cookie: `SID=${sid}` },
    signal: AbortSignal.timeout(10_000),
  });

  let res = await doReq(cachedSID);
  if (res.status === 403) {
    cachedSID = await login();
    res = await doReq(cachedSID);
  }
  return res;
}

function handleErr(res: Response, next: (e: any) => void, code = 'QBIT_ERR') {
  next(Object.assign(new Error(`qBittorrent returned ${res.status}`), { code }));
}

// ── Routes ───────────────────────────────────────────────────

/** GET /api/plugins/qbittorrent/transfer — global speed/stats */
router.get('/transfer', requireAdmin, async (_req, res, next) => {
  try {
    const r = await qbit('/api/v2/transfer/info');
    if (!r.ok) return handleErr(r, next);
    res.json(await r.json());
  } catch (e) { next(e); }
});

/** GET /api/plugins/qbittorrent/torrents — list all torrents */
router.get('/torrents', requireAdmin, async (_req, res, next) => {
  try {
    const r = await qbit('/api/v2/torrents/info?sort=added_on&reverse=true');
    if (!r.ok) return handleErr(r, next);
    res.json(await r.json());
  } catch (e) { next(e); }
});

/** POST /api/plugins/qbittorrent/torrents/pause — pause by hash list */
router.post('/torrents/pause', requireAdmin, async (req, res, next) => {
  const hashes: string[] = req.body?.hashes ?? [];
  if (!hashes.length) { res.status(400).json({ error: 'hashes required' }); return; }
  try {
    const r = await qbit('/api/v2/torrents/pause', {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    new URLSearchParams({ hashes: hashes.join('|') }).toString(),
    });
    if (!r.ok) return handleErr(r, next);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/** POST /api/plugins/qbittorrent/torrents/resume — resume by hash list */
router.post('/torrents/resume', requireAdmin, async (req, res, next) => {
  const hashes: string[] = req.body?.hashes ?? [];
  if (!hashes.length) { res.status(400).json({ error: 'hashes required' }); return; }
  try {
    const r = await qbit('/api/v2/torrents/resume', {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    new URLSearchParams({ hashes: hashes.join('|') }).toString(),
    });
    if (!r.ok) return handleErr(r, next);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/** POST /api/plugins/qbittorrent/torrents/forceresume — force-start by hash list */
router.post('/torrents/forceresume', requireAdmin, async (req, res, next) => {
  const hashes: string[] = req.body?.hashes ?? [];
  if (!hashes.length) { res.status(400).json({ error: 'hashes required' }); return; }
  try {
    const r = await qbit('/api/v2/torrents/setForceStart', {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    new URLSearchParams({ hashes: hashes.join('|'), value: 'true' }).toString(),
    });
    if (!r.ok) return handleErr(r, next);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/** DELETE /api/plugins/qbittorrent/torrents — delete by hash list */
router.delete('/torrents', requireAdmin, async (req, res, next) => {
  const hashes: string[] = req.body?.hashes ?? [];
  const deleteFiles: boolean = req.body?.deleteFiles === true;
  if (!hashes.length) { res.status(400).json({ error: 'hashes required' }); return; }
  try {
    const r = await qbit('/api/v2/torrents/delete', {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    new URLSearchParams({ hashes: hashes.join('|'), deleteFiles: String(deleteFiles) }).toString(),
    });
    if (!r.ok) return handleErr(r, next);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ── Error handler ────────────────────────────────────────────
router.use((err: any, _req: any, res: any, _next: any) => {
  if (err.code === 'NOT_ENABLED') { res.status(503).json({ error: 'Plugin not enabled' }); return; }
  if (err.name === 'AbortError' || err.name === 'TimeoutError') { res.status(504).json({ error: 'qBittorrent unreachable (timeout)' }); return; }
  console.error('[qbittorrent proxy]', err.message);
  res.status(502).json({ error: err.message ?? 'qBittorrent proxy error' });
});

export default router;
