import express, { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { ssowatAuth, requireAdmin, requirePasskey, requirePasskeySession, csrfProtection } from '../middleware/auth';
import {
  createImport,
  planImport,
  startImport,
  importStatus,
  latestImport,
  helperAvailable,
} from '../services/migrate';

const router = Router();

// Importing configs rewrites the VPN setup as root: admins with an active
// passkey session only, and a fresh passkey assertion to start a migration.
router.use(ssowatAuth);
router.use(requirePasskeySession);
router.use(csrfProtection);
router.use(requireAdmin);

const IS_DEV = process.env.NODE_ENV !== 'production';
const limiter = (max: number) => rateLimit({
  windowMs: 60 * 1000,
  max,
  skip: () => IS_DEV,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests' },
});

/** GET /api/migrate/current — whether migration works here, and the last run */
router.get('/current', limiter(60), async (_req, res) => {
  try {
    res.json({ available: await helperAvailable(), latest: await latestImport() });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? 'Failed to read migration state' });
  }
});

/** POST /api/migrate/upload — a Mullvad zip (raw body) or { files: [{ name, content }] } */
router.post(
  '/upload',
  limiter(10),
  express.raw({ type: ['application/zip', 'application/x-zip-compressed', 'application/octet-stream'], limit: '5mb' }),
  async (req, res) => {
    try {
      let summary;
      if (Buffer.isBuffer(req.body)) {
        summary = await createImport({ zip: req.body });
      } else if (Array.isArray(req.body?.files)) {
        summary = await createImport({ files: req.body.files });
      } else {
        res.status(400).json({ error: 'Upload a .zip or .conf files' });
        return;
      }
      res.json(summary);
    } catch (err: any) {
      res.status(400).json({ error: err.message ?? 'Could not read the upload' });
    }
  },
);

/** POST /api/migrate/:id/plan — dry run for the selected configs */
router.post('/:id/plan', limiter(20), async (req, res) => {
  const { configs, archiveOld } = req.body as { configs?: unknown; archiveOld?: unknown };
  if (!Array.isArray(configs) || !configs.every((c) => typeof c === 'string')) {
    res.status(400).json({ error: 'configs must be a list of names' });
    return;
  }
  try {
    res.json(await planImport(req.params.id, configs as string[], archiveOld !== false));
  } catch (err: any) {
    res.status(400).json({ error: err.message ?? 'Planning failed' });
  }
});

/** POST /api/migrate/:id/apply — start the migration (passkey-gated) */
router.post('/:id/apply', limiter(3), requirePasskey, async (req, res) => {
  try {
    await startImport(req.params.id);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message ?? 'Could not start the migration' });
  }
});

/** GET /api/migrate/:id/status — progress of a running or finished migration */
router.get('/:id/status', limiter(120), async (req, res) => {
  try {
    res.json(await importStatus(req.params.id));
  } catch (err: any) {
    res.status(400).json({ error: err.message ?? 'Unknown migration' });
  }
});

export default router;
