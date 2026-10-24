import { execFile } from 'child_process';
import { createHash, randomBytes } from 'crypto';
import { access, mkdir, readdir, readFile, rm, stat, writeFile } from 'fs/promises';
import path from 'path';
import { inflateRawSync } from 'zlib';
import { getWgSettings, listConfigs } from './wg';
import { classify, fetchRelayList, type MullvadRelay, type RelayStatusEntry } from './relayStatus';

// Imports a new set of WireGuard configs (e.g. a Mullvad zip) and hands the
// migration to a root helper. wg-man parses, validates and renders the configs
// and stages them; the helper (outside wg-man's sandbox) backs up, installs,
// updates every file that depends on the old tunnel address / DNS / pattern,
// reconnects, verifies and rolls back on failure. See tools/wg-man-migrate.

const DATA_DIR    = process.env.DATA_DIR || '/var/lib/wg-man';
const STAGING_DIR = path.join(DATA_DIR, 'migrations');
const HELPER      = process.env.MIGRATE_HELPER || '/usr/local/sbin/wg-man-migrate';
const HELPER_CONF = '/etc/wg-man/migrate.json';
const STAGING_TTL_MS = 24 * 60 * 60 * 1000;

const ID_RE   = /^[0-9a-f]{16}$/;
const NAME_RE = /^[A-Za-z0-9_-]+$/;
const KEY_RE  = /^[A-Za-z0-9+/]{42,43}=?$/;

const MAX_ZIP_ENTRIES = 2000;
const MAX_CONF_BYTES  = 64 * 1024;
const MAX_CONFIGS     = 1000;

// ── Zip reading (stored + deflate entries only; no dependency) ──────────────

function readZip(buf: Buffer): { name: string; data: Buffer }[] {
  // End of central directory record: last 22..65557 bytes
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a zip file');
  const entries = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  if (entries > MAX_ZIP_ENTRIES) throw new Error(`Zip has too many entries (${entries})`);

  const out: { name: string; data: Buffer }[] = [];
  for (let n = 0; n < entries; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Corrupt zip directory');
    const flags   = buf.readUInt16LE(p + 8);
    const method  = buf.readUInt16LE(p + 10);
    const csize   = buf.readUInt32LE(p + 20);
    const usize   = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extra   = buf.readUInt16LE(p + 30);
    const comment = buf.readUInt16LE(p + 32);
    const local   = buf.readUInt32LE(p + 42);
    const name    = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    p += 46 + nameLen + extra + comment;

    const base = name.split('/').pop() ?? '';
    if (!base.toLowerCase().endsWith('.conf') || base.startsWith('.') || name.startsWith('__MACOSX/')) continue;
    if (flags & 1) throw new Error(`${base} is encrypted`);
    if (usize > MAX_CONF_BYTES) throw new Error(`${base} is too large`);
    if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) throw new Error('Corrupt zip entry');
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + csize);
    let data: Buffer;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) data = inflateRawSync(raw, { maxOutputLength: MAX_CONF_BYTES });
    else throw new Error(`${base}: unsupported compression`);
    out.push({ name: base, data });
  }
  return out;
}

// ── WireGuard config parsing / rendering ─────────────────────────────────────

type ParsedConf = {
  comments: string[];
  iface: Record<string, string>;
  peer: Record<string, string>;
};

// Directives regenerated from this server's template (or deliberately dropped:
// a DNS= line would make wg-quick rewrite the whole box's resolver).
const DROPPED = new Set(['PostUp', 'PostDown', 'PreUp', 'PreDown', 'Table', 'MTU', 'DNS',
                         'PersistentKeepalive', 'SaveConfig']);

function parseConf(text: string): ParsedConf & { dns: string } {
  const out: ParsedConf & { dns: string } = { comments: [], iface: {}, peer: {}, dns: '' };
  let section: 'iface' | 'peer' | null = null;
  let peers = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const sec = line.match(/^\[(\w+)\]$/);
    if (sec) {
      const s = sec[1].toLowerCase();
      section = s === 'interface' ? 'iface' : s === 'peer' ? 'peer' : null;
      if (section === 'peer' && ++peers > 1) throw new Error('more than one [Peer]');
      continue;
    }
    if (line.startsWith('#') || line.startsWith(';')) {
      if (section === 'iface' && /^#\s*Device:/i.test(line)) out.comments.push(line);
      continue;
    }
    const kv = line.match(/^([A-Za-z][A-Za-z0-9]*)\s*=\s*(.*?)\s*$/);
    if (!kv || !section) continue;
    const [, key, value] = kv;
    if (key === 'DNS' && section === 'iface') out.dns = value.split(',')[0].trim();
    if (DROPPED.has(key)) continue;
    if (!(key in out[section])) out[section][key] = value;
  }
  return out;
}

function splitAddress(addr: string): { v4: string; v6: string } {
  let v4 = '', v6 = '';
  for (const part of addr.split(',')) {
    const ip = part.trim().split('/')[0];
    if (!ip) continue;
    if (ip.includes(':')) v6 ||= ip; else v4 ||= ip;
  }
  return { v4, v6 };
}

function validateConf(c: ParsedConf): string | null {
  if (!KEY_RE.test(c.iface.PrivateKey ?? '')) return 'missing or invalid PrivateKey';
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(splitAddress(c.iface.Address ?? '').v4)) return 'missing IPv4 Address';
  if (!KEY_RE.test(c.peer.PublicKey ?? '')) return 'missing or invalid peer PublicKey';
  if (!/^[\w.:[\]-]+:\d{1,5}$/.test(c.peer.Endpoint ?? '')) return 'missing or invalid Endpoint';
  if (!c.peer.AllowedIPs) return 'missing AllowedIPs';
  for (const v of [...Object.values(c.iface), ...Object.values(c.peer)]) {
    if (/[\r\n]/.test(v)) return 'invalid value';
  }
  return null;
}

type Template = { iface: [string, string][]; keepalive: string | null };

/** The non-identity lines of the config in use now, so new configs keep this server's routing hooks. */
async function currentTemplate(): Promise<{ tmpl: Template; source: string | null; active: string }> {
  const { configDir, staticIface, stateFile } = getWgSettings();
  let active = '';
  try { active = (await readFile(stateFile, 'utf8')).trim(); } catch { /* none */ }
  // The static interface file is a copy of what is running, so prefer it
  const candidates = [staticIface, ...(NAME_RE.test(active) ? [active] : [])];
  for (const name of candidates) {
    let text: string;
    try { text = await readFile(path.join(configDir, `${name}.conf`), 'utf8'); } catch { continue; }
    const iface: [string, string][] = [];
    let keepalive: string | null = null;
    let section = '';
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      const sec = line.match(/^\[(\w+)\]$/);
      if (sec) { section = sec[1].toLowerCase(); continue; }
      const kv = line.match(/^([A-Za-z][A-Za-z0-9]*)\s*=\s*(.*?)\s*$/);
      if (!kv) continue;
      if (section === 'interface' && ['MTU', 'Table', 'PreUp', 'PostUp', 'PreDown', 'PostDown'].includes(kv[1])) {
        iface.push([kv[1], kv[2]]);
      } else if (section === 'peer' && kv[1] === 'PersistentKeepalive') {
        keepalive = kv[2];
      }
    }
    return { tmpl: { iface, keepalive }, source: name, active };
  }
  return { tmpl: { iface: [], keepalive: '25' }, source: null, active };
}

function renderConf(c: ParsedConf, t: Template): string {
  const out = ['[Interface]', ...c.comments];
  for (const k of ['PrivateKey', 'Address', 'ListenPort']) if (c.iface[k]) out.push(`${k} = ${c.iface[k]}`);
  for (const [k, v] of t.iface) out.push(`${k} = ${v}`);
  out.push('', '[Peer]');
  for (const k of ['PublicKey', 'PresharedKey', 'AllowedIPs', 'Endpoint']) if (c.peer[k]) out.push(`${k} = ${c.peer[k]}`);
  if (t.keepalive) out.push(`PersistentKeepalive = ${t.keepalive}`);
  return out.join('\n') + '\n';
}

// ── Pattern ─────────────────────────────────────────────────────────────────

/** "nl-ams-wg-001", "nl-ams-wg-002" -> "nl-ams-wg-*.conf"; null when the names share no prefix. */
export function patternFor(names: string[]): string | null {
  if (!names.length) return null;
  let prefix = names[0];
  for (const n of names) while (!n.startsWith(prefix)) prefix = prefix.slice(0, -1);
  const cut = prefix.lastIndexOf('-');
  prefix = cut >= 0 ? prefix.slice(0, cut + 1) : prefix;
  if (!/^[A-Za-z0-9]/.test(prefix)) return null;
  return `${prefix}*.conf`;
}

function matches(pattern: string, file: string): boolean {
  const [pre, suf] = pattern.split('*');
  return file.startsWith(pre) && file.endsWith(suf) && file.length >= pre.length + suf.length;
}

// ── Staging ─────────────────────────────────────────────────────────────────

export type ImportedConfig = {
  name: string;
  location: string;
  endpoint: string;
  relay: RelayStatusEntry | null;
};

export type ImportSummary = {
  id: string;
  configs: ImportedConfig[];
  skipped: { name: string; reason: string }[];
  device: string | null;
  ip4: string;
  ip6: string;
  dns: string;
  port: string;
  sameDevice: boolean;
  current: { ip4: string; pattern: string; active: string | null; device: string | null; count: number };
  templateSource: string | null;
  relayError: string | null;
  errors: string[];
  warnings: string[];
};

type Staged = {
  summary: ImportSummary;
  configs: Record<string, string>;   // name -> rendered config (holds the private key)
  keyHash: string;
};

const keyHash = (k: string) => createHash('sha256').update(k).digest('hex');

function stagingPath(id: string, ...rest: string[]): string {
  if (!ID_RE.test(id)) throw new Error('Invalid import id');
  return path.join(STAGING_DIR, id, ...rest);
}

async function pruneStaging(): Promise<void> {
  let ids: string[] = [];
  try { ids = await readdir(STAGING_DIR); } catch { return; }
  for (const id of ids) {
    if (!ID_RE.test(id)) continue;
    try {
      const st = await stat(path.join(STAGING_DIR, id));
      if (Date.now() - st.mtimeMs > STAGING_TTL_MS && !(await isRunning(id))) {
        await rm(path.join(STAGING_DIR, id), { recursive: true, force: true });
      }
    } catch { /* ignore */ }
  }
}

/** Parse an upload (zip bytes, or individual .conf files) and stage it. */
export async function createImport(
  input: { zip: Buffer } | { files: { name: string; content: string }[] },
): Promise<ImportSummary> {
  await pruneStaging();
  const files = 'zip' in input
    ? readZip(input.zip).map((e) => ({ name: e.name, content: e.data.toString('utf8') }))
    : input.files;
  if (!files.length) throw new Error('No .conf files found');
  if (files.length > MAX_CONFIGS) throw new Error(`Too many configs (${files.length})`);

  const { staticIface, configPattern, configDir } = getWgSettings();
  const { tmpl, source, active } = await currentTemplate();
  const parsed: { name: string; conf: ReturnType<typeof parseConf> }[] = [];
  const skipped: { name: string; reason: string }[] = [];
  const seen = new Set<string>();

  for (const f of files) {
    const name = String(f.name).replace(/\.conf$/i, '');
    if (!NAME_RE.test(name) || name.length > 64) { skipped.push({ name: f.name, reason: 'unsupported file name' }); continue; }
    if (name === staticIface) { skipped.push({ name: f.name, reason: `reserved name (${staticIface})` }); continue; }
    if (seen.has(name)) { skipped.push({ name: f.name, reason: 'duplicate' }); continue; }
    if (typeof f.content !== 'string' || f.content.length > MAX_CONF_BYTES) { skipped.push({ name: f.name, reason: 'too large' }); continue; }
    try {
      const conf = parseConf(f.content);
      const problem = validateConf(conf);
      if (problem) { skipped.push({ name: f.name, reason: problem }); continue; }
      parsed.push({ name, conf });
      seen.add(name);
    } catch (err: any) {
      skipped.push({ name: f.name, reason: err.message });
    }
  }
  parsed.sort((a, b) => a.name.localeCompare(b.name));

  const errors: string[] = [];
  const warnings: string[] = [];
  if (!parsed.length) errors.push('None of the files is a usable WireGuard config');

  const v4s  = new Set(parsed.map((p) => splitAddress(p.conf.iface.Address).v4));
  const v6s  = new Set(parsed.map((p) => splitAddress(p.conf.iface.Address).v6));
  const dnss = new Set(parsed.map((p) => p.conf.dns).filter(Boolean));
  const ports = new Set(parsed.map((p) => p.conf.peer.Endpoint.split(':').pop() ?? ''));
  const keys = new Set(parsed.map((p) => keyHash(p.conf.iface.PrivateKey)));
  if (v4s.size > 1 || keys.size > 1) errors.push('The configs come from more than one device (different keys or addresses). Download them in one go from one account.');
  if (ports.size > 1) errors.push(`The configs use different ports (${[...ports].join(', ')})`);
  if (dnss.size > 1) warnings.push(`The configs list different DNS servers (${[...dnss].join(', ')}); using ${[...dnss][0]}`);

  // What the server runs now
  let currentConf: ReturnType<typeof parseConf> | null = null;
  if (source) {
    try { currentConf = parseConf(await readFile(path.join(configDir, `${source}.conf`), 'utf8')); } catch { /* none */ }
  }
  const current = {
    ip4: currentConf ? splitAddress(currentConf.iface.Address ?? '').v4 : '',
    pattern: configPattern,
    active: active || source,
    device: currentConf?.comments[0]?.replace(/^#\s*Device:\s*/i, '') ?? null,
    count: (await listConfigs()).length,
  };
  const newKey = [...keys][0] ?? '';
  const sameDevice = !!currentConf?.iface.PrivateKey && keyHash(currentConf.iface.PrivateKey) === newKey;
  if (sameDevice) warnings.push('These configs use the same Mullvad device as now — only the server list changes.');
  if (!source) warnings.push('No active config found to copy routing settings (Table / PostUp) from; configs are installed as downloaded.');

  let relays: MullvadRelay[] = [];
  let relayError: string | null = null;
  try { relays = await fetchRelayList(); } catch (err: any) { relayError = `Could not check servers with Mullvad: ${err.message}`; }

  const rendered: Record<string, string> = {};
  const configs: ImportedConfig[] = parsed.map(({ name, conf }) => {
    rendered[name] = renderConf(conf, tmpl);
    return {
      name,
      location: name.split('-').slice(0, 2).join('-'),
      endpoint: conf.peer.Endpoint,
      relay: relays.length ? classify(name, rendered[name], relays) : null,
    };
  });
  if (patternFor(configs.map((c) => c.name)) === null && configs.length) {
    warnings.push('The files have no common name prefix. Pick one location in the next step.');
  }

  const id = randomBytes(8).toString('hex');
  const summary: ImportSummary = {
    id, configs, skipped,
    device: parsed[0]?.conf.comments[0]?.replace(/^#\s*Device:\s*/i, '') ?? null,
    ip4: [...v4s][0] ?? '', ip6: [...v6s][0] ?? '', dns: [...dnss][0] ?? '', port: [...ports][0] ?? '',
    sameDevice, current, templateSource: source, relayError, errors, warnings,
  };

  if (!errors.length) {
    await mkdir(stagingPath(id), { recursive: true, mode: 0o700 });
    const staged: Staged = { summary, configs: rendered, keyHash: newKey };
    await writeFile(stagingPath(id, 'import.json'), JSON.stringify(staged), { mode: 0o600 });
  }
  return summary;
}

async function loadStaged(id: string): Promise<Staged> {
  try {
    return JSON.parse(await readFile(stagingPath(id, 'import.json'), 'utf8')) as Staged;
  } catch {
    throw new Error('This import has expired — upload the configs again');
  }
}

// ── Helper invocation ───────────────────────────────────────────────────────

function run(cmd: string, args: string[], timeoutMs: number): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ code: err ? ((err as any).code ?? 1) : 0, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

const unitName = (id: string) => `wg-man-migrate-${id}`;

async function isRunning(id: string): Promise<boolean> {
  const { stdout } = await run('systemctl', ['is-active', unitName(id)], 10000);
  return ['active', 'activating'].includes(stdout.trim());
}

export async function helperAvailable(): Promise<{ ok: boolean; reason: string | null }> {
  try { await access(HELPER); } catch { return { ok: false, reason: `Migration helper not installed (${HELPER})` }; }
  try { await access(HELPER_CONF); } catch { return { ok: false, reason: `Migration is not configured (${HELPER_CONF})` }; }
  return { ok: true, reason: null };
}

/** Write the request for the chosen configs and ask the helper for a dry-run plan. */
export async function planImport(id: string, selected: string[], archiveOld: boolean): Promise<any> {
  const staged = await loadStaged(id);
  const names = [...new Set(selected)].filter((n) => n in staged.configs).sort();
  if (!names.length) throw new Error('Select at least one config');
  const pattern = patternFor(names);
  if (!pattern) throw new Error('The selected configs share no name prefix — pick configs from one location');
  const { staticIface, configPattern } = getWgSettings();
  if (matches(pattern, `${staticIface}.conf`)) throw new Error(`The pattern ${pattern} would include ${staticIface}.conf`);

  // Connect to servers Mullvad lists as online first
  const rank = (s?: string) => (s === 'online' ? 0 : s === 'unknown' || !s ? 1 : 2);
  const relayOf = new Map(staged.summary.configs.map((c) => [c.name, c.relay?.status]));
  const tryOrder = [...names].sort((a, b) => rank(relayOf.get(a)) - rank(relayOf.get(b)) || a.localeCompare(b));

  const dir = stagingPath(id, 'configs');
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true, mode: 0o700 });
  for (const n of names) await writeFile(path.join(dir, `${n}.conf`), staged.configs[n], { mode: 0o600 });
  await writeFile(stagingPath(id, 'request.json'), JSON.stringify({
    configs: names, tryOrder, newPattern: pattern, newDns: staged.summary.dns,
    currentPattern: configPattern, archiveOld,
  }), { mode: 0o600 });

  const avail = await helperAvailable();
  if (!avail.ok) throw new Error(avail.reason ?? 'Migration helper unavailable');
  const res = await run('systemd-run', ['--wait', '--pipe', '--quiet', '--collect',
    `--unit=wg-man-migrate-plan-${id}-${Date.now()}`, '/usr/bin/python3', '-I', HELPER, 'plan', id], 120000);
  let out: any;
  try { out = JSON.parse(res.stdout.trim().split('\n').pop() ?? ''); } catch {
    throw new Error(`Planning failed: ${(res.stderr || res.stdout).trim().slice(-300) || `exit ${res.code}`}`);
  }
  if (out.error) throw new Error(out.error);
  return { ...out, tryOrder };
}

/** Start the migration as its own systemd unit, so it survives wg-man restarting. */
export async function startImport(id: string): Promise<void> {
  try { await access(stagingPath(id, 'request.json')); } catch { throw new Error('Review the changes first'); }
  if (await isRunning(id)) throw new Error('This migration is already running');
  await rm(stagingPath(id, 'progress.json'), { force: true });
  const res = await run('systemd-run', ['--quiet', '--collect', `--unit=${unitName(id)}`,
    '--description=wg-man config migration', '/usr/bin/python3', '-I', HELPER, 'apply', id], 30000);
  if (res.code !== 0) throw new Error(`Could not start the migration: ${res.stderr.trim().slice(-300)}`);
}

export async function importStatus(id: string): Promise<any> {
  let progress: any = null;
  try { progress = JSON.parse(await readFile(stagingPath(id, 'progress.json'), 'utf8')); } catch { /* not started yet */ }
  const running = await isRunning(id);
  if (progress && ['running', 'rolling_back'].includes(progress.state) && !running) {
    progress.state = 'failed';
    progress.log = [...(progress.log ?? []), 'The migration process stopped unexpectedly — check journalctl -u ' + unitName(id)];
  }
  return { id, running, progress };
}

/** Most recent migration that has started, so the UI can reattach after a reload. */
export async function latestImport(): Promise<{ id: string; state: string; finishedAt: number | null } | null> {
  let ids: string[] = [];
  try { ids = await readdir(STAGING_DIR); } catch { return null; }
  let best: { id: string; state: string; finishedAt: number | null; startedAt: number } | null = null;
  for (const id of ids.filter((i) => ID_RE.test(i))) {
    try {
      const p = JSON.parse(await readFile(stagingPath(id, 'progress.json'), 'utf8'));
      if (!best || p.startedAt > best.startedAt) best = { id, state: p.state, finishedAt: p.finishedAt, startedAt: p.startedAt };
    } catch { /* not started */ }
  }
  return best && { id: best.id, state: best.state, finishedAt: best.finishedAt };
}
