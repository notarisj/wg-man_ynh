import { readFile, writeFile, mkdir, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { randomUUID } from 'crypto';
import { tmpdir } from 'os';
import path from 'path';

const execFileAsync = promisify(execFile);

const DATA_DIR    = process.env.DATA_DIR    || '/var/lib/wg-man';
const SCRIPTS_DIR = process.env.SCRIPTS_DIR || path.join(DATA_DIR, 'scripts');
const META_FILE   = path.join(DATA_DIR, 'user-scripts.json');

// Script names: printable ASCII, no path separators or shell metacharacters
const SAFE_NAME_RE = /^[A-Za-z0-9 _\-\.]{1,64}$/;

// UUIDs only as IDs — prevents path traversal
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface UserScript {
  id:        string;
  name:      string;
  createdAt: number;
  updatedAt: number;
}

interface ScriptStore {
  scripts: UserScript[];
}

async function ensureDirs(): Promise<void> {
  await mkdir(DATA_DIR,    { recursive: true });
  await mkdir(SCRIPTS_DIR, { recursive: true });
}

async function readStore(): Promise<ScriptStore> {
  try {
    const raw = await readFile(META_FILE, 'utf8');
    return JSON.parse(raw) as ScriptStore;
  } catch (err: any) {
    if (err.code === 'ENOENT') return { scripts: [] };
    throw err;
  }
}

async function writeStore(store: ScriptStore): Promise<void> {
  await ensureDirs();
  await writeFile(META_FILE, JSON.stringify(store, null, 2), { mode: 0o600 });
}

function scriptPath(id: string): string {
  return path.join(SCRIPTS_DIR, `${id}.sh`);
}

export function isValidId(id: string): boolean {
  return UUID_RE.test(id);
}

export async function listScripts(): Promise<UserScript[]> {
  const store = await readStore();
  return store.scripts;
}

export async function createScript(name: string, content: string): Promise<UserScript> {
  if (!SAFE_NAME_RE.test(name)) {
    throw new Error('Invalid script name — use letters, numbers, spaces, hyphens, underscores, periods (max 64 chars)');
  }
  await ensureDirs();
  const store = await readStore();
  const id  = randomUUID();
  const now = Date.now();
  const script: UserScript = { id, name, createdAt: now, updatedAt: now };
  await writeFile(scriptPath(id), content, { mode: 0o750 });
  store.scripts.push(script);
  await writeStore(store);
  return script;
}

export async function getScript(id: string): Promise<{ script: UserScript; content: string }> {
  if (!isValidId(id)) throw Object.assign(new Error('Invalid script id'), { code: 'EINVAL' });
  const store = await readStore();
  const script = store.scripts.find((s) => s.id === id);
  if (!script) throw Object.assign(new Error('Script not found'), { code: 'ENOENT' });
  const content = await readFile(scriptPath(id), 'utf8');
  return { script, content };
}

export async function updateScript(
  id: string,
  opts: { name?: string; content?: string },
): Promise<void> {
  if (!isValidId(id)) throw Object.assign(new Error('Invalid script id'), { code: 'EINVAL' });
  if (opts.name !== undefined && !SAFE_NAME_RE.test(opts.name)) {
    throw new Error('Invalid script name');
  }
  const store = await readStore();
  const script = store.scripts.find((s) => s.id === id);
  if (!script) throw Object.assign(new Error('Script not found'), { code: 'ENOENT' });
  if (opts.content !== undefined) {
    await writeFile(scriptPath(id), opts.content, { mode: 0o750 });
  }
  if (opts.name !== undefined) script.name = opts.name;
  script.updatedAt = Date.now();
  await writeStore(store);
}

export async function deleteScript(id: string): Promise<void> {
  if (!isValidId(id)) throw Object.assign(new Error('Invalid script id'), { code: 'EINVAL' });
  const store = await readStore();
  const idx = store.scripts.findIndex((s) => s.id === id);
  if (idx === -1) throw Object.assign(new Error('Script not found'), { code: 'ENOENT' });
  store.scripts.splice(idx, 1);
  await writeStore(store);
  try { await unlink(scriptPath(id)); } catch { /* already gone */ }
}

export async function validateScript(content: string): Promise<{ ok: boolean; error?: string }> {
  const tmp = path.join(tmpdir(), `wg-man-validate-${Date.now()}.sh`);
  try {
    await writeFile(tmp, content, { mode: 0o600 });
    await execFileAsync('bash', ['-n', tmp]);
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.stderr ?? err.message };
  } finally {
    unlink(tmp).catch(() => {});
  }
}

export async function runScript(id: string): Promise<{ output: string }> {
  if (!isValidId(id)) throw Object.assign(new Error('Invalid script id'), { code: 'EINVAL' });
  if (!existsSync(scriptPath(id))) {
    throw Object.assign(new Error('Script not found'), { code: 'ENOENT' });
  }
  const { stdout, stderr } = await execFileAsync('bash', [scriptPath(id)], {
    timeout: 30_000,
    env: { PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin' },
  });
  return { output: (stdout + stderr).slice(0, 8192) };
}
