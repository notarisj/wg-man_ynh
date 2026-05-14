import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { ssowatAuth, requireAdmin, requirePasskey, requirePasskeySession, csrfProtection } from '../middleware/auth';
import {
  listScripts,
  createScript,
  getScript,
  updateScript,
  deleteScript,
  validateScript,
  runScript,
  readScriptLog,
  isValidId,
} from '../services/userScripts';
import {
  getScriptCronStatus,
  setScriptCron,
  disableScriptCron,
} from '../services/userCron';

const router = Router();

router.use(ssowatAuth);
router.use(requirePasskeySession);
router.use(csrfProtection);

const IS_DEV = process.env.NODE_ENV !== 'production';

const apiLimiter = rateLimit({
  windowMs: 60 * 1000, max: 30,
  skip: () => IS_DEV, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many requests' },
});
router.use(apiLimiter);

const mutationLimiter = rateLimit({
  windowMs: 60 * 1000, max: 5,
  skip: () => IS_DEV, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many requests' },
});

/** GET /api/scripts — list all user scripts with their cron status */
router.get('/', async (_req, res) => {
  try {
    const scripts = await listScripts();
    const withCron = await Promise.all(
      scripts.map(async (s) => ({
        ...s,
        cron: await getScriptCronStatus(s.id),
      })),
    );
    res.json(withCron);
  } catch (err: any) {
    console.error('[scripts] Failed to list scripts:', err);
    res.status(500).json({ error: 'Failed to list scripts' });
  }
});

/** POST /api/scripts — create a new user script (passkey-gated) */
router.post('/', mutationLimiter, requireAdmin, requirePasskey, async (req, res) => {
  const { name, content, logFile } = req.body as { name?: unknown; content?: unknown; logFile?: unknown };
  if (typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'name is required' }); return;
  }
  if (typeof content !== 'string') {
    res.status(400).json({ error: 'content is required' }); return;
  }
  const lf = typeof logFile === 'string' ? logFile.trim() : undefined;
  try {
    const script = await createScript(name.trim(), content, lf);
    res.json({ ok: true, script });
  } catch (err: any) {
    res.status(400).json({ error: err.message ?? 'Failed to create script' });
  }
});

/** GET /api/scripts/:id — get a single script with its content and cron status */
router.get('/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) { res.status(400).json({ error: 'Invalid script id' }); return; }
  try {
    const { script, content } = await getScript(id);
    const cron = await getScriptCronStatus(id);
    res.json({ script, content, cron });
  } catch (err: any) {
    if (err.code === 'ENOENT') { res.status(404).json({ error: 'Script not found' }); return; }
    res.status(500).json({ error: 'Failed to read script' });
  }
});

/** POST /api/scripts/validate — validate bash syntax without saving (no id needed) */
router.post('/validate', requireAdmin, async (req, res) => {
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

/** POST /api/scripts/:id/validate — validate bash syntax without saving */
router.post('/:id/validate', requireAdmin, async (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) { res.status(400).json({ error: 'Invalid script id' }); return; }
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

/** PUT /api/scripts/:id — update script name and/or content (passkey-gated) */
router.put('/:id', mutationLimiter, requireAdmin, requirePasskey, async (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) { res.status(400).json({ error: 'Invalid script id' }); return; }
  const { name, content, logFile } = req.body as { name?: unknown; content?: unknown; logFile?: unknown };
  if (name !== undefined && typeof name !== 'string') {
    res.status(400).json({ error: 'name must be a string' }); return;
  }
  if (content !== undefined && typeof content !== 'string') {
    res.status(400).json({ error: 'content must be a string' }); return;
  }
  try {
    await updateScript(id, {
      name:    typeof name    === 'string' ? name.trim()    : undefined,
      content: typeof content === 'string' ? content        : undefined,
      logFile: typeof logFile === 'string' ? logFile.trim() : undefined,
    });
    res.json({ ok: true });
  } catch (err: any) {
    if (err.code === 'ENOENT') { res.status(404).json({ error: 'Script not found' }); return; }
    res.status(400).json({ error: err.message ?? 'Failed to update script' });
  }
});

/** DELETE /api/scripts/:id — delete a script and its cron job (passkey-gated) */
router.delete('/:id', mutationLimiter, requireAdmin, requirePasskey, async (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) { res.status(400).json({ error: 'Invalid script id' }); return; }
  try {
    await disableScriptCron(id);
    await deleteScript(id);
    res.json({ ok: true });
  } catch (err: any) {
    if (err.code === 'ENOENT') { res.status(404).json({ error: 'Script not found' }); return; }
    res.status(500).json({ error: 'Failed to delete script' });
  }
});

/** POST /api/scripts/:id/cron — enable or update cron schedule (passkey-gated) */
router.post('/:id/cron', mutationLimiter, requireAdmin, requirePasskey, async (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) { res.status(400).json({ error: 'Invalid script id' }); return; }
  const { schedule, delay } = req.body as { schedule?: unknown; delay?: unknown };
  if (typeof schedule !== 'string' || !schedule.trim()) {
    res.status(400).json({ error: 'schedule is required' }); return;
  }
  const safeDelay = typeof delay === 'number' && Number.isFinite(delay) && delay >= 0
    ? Math.floor(delay) : 0;
  try {
    const { script } = await getScript(id);
    await setScriptCron(id, schedule.trim(), safeDelay, script.logFile);
    res.json({ ok: true });
  } catch (err: any) {
    if (err.code === 'ENOENT') { res.status(404).json({ error: 'Script not found' }); return; }
    res.status(400).json({ error: err.message ?? 'Failed to set cron' });
  }
});

/** DELETE /api/scripts/:id/cron — disable cron job for a script */
router.delete('/:id/cron', mutationLimiter, requireAdmin, async (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) { res.status(400).json({ error: 'Invalid script id' }); return; }
  try {
    await disableScriptCron(id);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to disable cron' });
  }
});

/** GET /api/scripts/:id/log — read the tail of the script's configured log file */
router.get('/:id/log', requireAdmin, async (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) { res.status(400).json({ error: 'Invalid script id' }); return; }
  try {
    const result = await readScriptLog(id);
    res.json(result);
  } catch (err: any) {
    if (err.code === 'ENOENT') { res.status(404).json({ error: err.message }); return; }
    res.status(500).json({ error: 'Failed to read log' });
  }
});

/** POST /api/scripts/:id/run — run a script manually */
router.post('/:id/run', mutationLimiter, requireAdmin, requirePasskey, async (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) { res.status(400).json({ error: 'Invalid script id' }); return; }
  try {
    const result = await runScript(id);
    res.json(result);
  } catch (err: any) {
    if (err.code === 'ENOENT') { res.status(404).json({ error: 'Script not found' }); return; }
    res.status(500).json({ error: err.message ?? 'Script execution failed' });
  }
});

export default router;
