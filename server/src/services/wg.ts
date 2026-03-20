import { execFile } from 'child_process';
import { readdir, readFile, writeFile, appendFile, chmod, stat, mkdir } from 'fs/promises';
import path from 'path';

// ── Environment config ──────────────────────────────────────

const CONFIG_DIR     = process.env.WG_CONFIG_DIR       || '/etc/wireguard';
const CONFIG_PATTERN = process.env.WG_CONFIG_PATTERN   || 'wg-*.conf';
const STATIC_IFACE   = process.env.WG_STATIC_INTERFACE || 'wg-vpn';
const MONITOR_SCRIPT = process.env.MONITOR_SCRIPT      || '/usr/local/bin/vpn-monitor.sh';
const LOG_FILE       = process.env.LOG_FILE            || '/var/log/vpn-monitor.log';
const STATE_FILE     = process.env.STATE_FILE          || '/var/lib/vpn-monitor.current';
const CHECK_IP       = process.env.CHECK_IP            || '1.1.1.1';
const MAX_HANDSHAKE_AGE = parseInt(process.env.MAX_HANDSHAKE_AGE || '120', 10);

// ── Validation helpers (run once at import time) ────────────

const SAFE_PATH_RE  = /^\/[a-zA-Z0-9/_.-]+$/;
const SAFE_IFACE_RE = /^[a-zA-Z0-9_-]+$/;
const SAFE_IP_RE    = /^[0-9.:a-fA-F]+$/;

function validateEnv(): void {
  if (!SAFE_PATH_RE.test(CONFIG_DIR))     throw new Error(`Unsafe WG_CONFIG_DIR: ${CONFIG_DIR}`);
  if (!SAFE_IFACE_RE.test(STATIC_IFACE)) throw new Error(`Unsafe WG_STATIC_INTERFACE: ${STATIC_IFACE}`);
  if (!SAFE_PATH_RE.test(MONITOR_SCRIPT)) throw new Error(`Unsafe MONITOR_SCRIPT: ${MONITOR_SCRIPT}`);
  if (!SAFE_PATH_RE.test(LOG_FILE))       throw new Error(`Unsafe LOG_FILE: ${LOG_FILE}`);
  if (!SAFE_PATH_RE.test(STATE_FILE))     throw new Error(`Unsafe STATE_FILE: ${STATE_FILE}`);
  if (!SAFE_IP_RE.test(CHECK_IP))         throw new Error(`Unsafe CHECK_IP: ${CHECK_IP}`);

  // SEC-11: require a non-empty literal prefix before any wildcard so the
  // pattern can't match every .conf file in CONFIG_DIR (e.g. "*.conf" would
  // expose wg0.conf and any other config not managed by this app).
  const wildcardIdx = CONFIG_PATTERN.indexOf('*');
  const prefix = wildcardIdx >= 0 ? CONFIG_PATTERN.slice(0, wildcardIdx) : CONFIG_PATTERN;
  if (prefix.length === 0) {
    throw new Error(
      `WG_CONFIG_PATTERN must begin with at least one literal character before the wildcard ` +
      `(got "${CONFIG_PATTERN}"). Use a pattern like "wg-*.conf" or "vpn-*.conf".`,
    );
  }
}
validateEnv();

// ── Safe command execution (no shell) ───────────────────────

function runCmd(bin: string, args: string[]): Promise<{ stdout: string; stderr: string; ok: boolean }> {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout: 30_000 }, (err, stdout, stderr) => {
      resolve({ stdout: stdout ?? '', stderr: stderr ?? '', ok: !err });
    });
  });
}

async function appendLog(line: string): Promise<void> {
  const ts = new Date().toISOString().replace('T', ' ').substring(0, 19);
  await appendFile(LOG_FILE, `${ts} - ${line}\n`, 'utf-8').catch(() => {});
}

// ── SEC-12: DNS-line normalisation for config comparison ────

/**
 * Strip DNS= lines from a WireGuard config string.
 * switchConfig writes DNS-stripped content to STATIC_IFACE.conf, so
 * comparing raw file contents would never match. Normalise both sides.
 */
function stripDnsLines(content: string): string {
  return content
    .split('\n')
    .filter((line) => !/^\s*DNS\s*=/i.test(line))
    .join('\n');
}

// ── SYS-02: validate monitor script ownership ──────────────

/**
 * SEC-04: validate monitor script ownership and permissions before execution.
 * Throws on non-root ownership (not just a warning) and on group- or
 * world-writable mode so that a compromised non-root account cannot escalate
 * privileges by modifying the script.
 */
async function validateMonitorScript(): Promise<void> {
  let s: Awaited<ReturnType<typeof stat>>;
  try {
    s = await stat(MONITOR_SCRIPT);
  } catch (err: any) {
    if (err.code === 'ENOENT') return; // script absent — will fail gracefully at invocation
    throw err;
  }

  // SEC-04: non-root ownership is now a hard block, not just a warning.
  if (s.uid !== 0) {
    throw new Error(
      `MONITOR_SCRIPT ${MONITOR_SCRIPT} is owned by uid=${s.uid} (not root) — ` +
      `refusing to execute. Run: chown root:root ${MONITOR_SCRIPT}`,
    );
  }

  // SEC-04: reject group-writable (0o020) OR world-writable (0o002) scripts.
  // eslint-disable-next-line no-bitwise
  if (s.mode & 0o022) {
    throw new Error(
      `MONITOR_SCRIPT ${MONITOR_SCRIPT} is group- or world-writable (mode=${(s.mode & 0o777).toString(8)}) — ` +
      `refusing to execute. Run: chmod 755 ${MONITOR_SCRIPT}`,
    );
  }
}

// ── Types ───────────────────────────────────────────────────

export interface WgStatus {
  connected: boolean;
  interface: string | null;
  currentConfig: string | null;
  endpoint: string | null;
  publicKey: string | null;
  lastHandshake: number | null;
  handshakeAge: number | null;
  pingOk: boolean;
  allowedIps: string | null;
  listenPort: number | null;
  rxBytes: number | null;
  txBytes: number | null;
}

export interface WgConfig {
  name: string;
  filename: string;
  isActive: boolean;
  address: string | null;
  endpoint: string | null;
  comment: string | null;
  /** WG-03: true when the config file has no DNS directive */
  missingDns: boolean;
  /** WG-B: true when AllowedIPs routes all IPv4 (0.0.0.0/0) but not IPv6 (::/0) */
  ipv6LeakRisk: boolean;
}

// ── Service functions ───────────────────────────────────────

export async function getStatus(): Promise<WgStatus> {
  const base: WgStatus = {
    connected: false,
    interface: null,
    currentConfig: null,
    endpoint: null,
    publicKey: null,
    lastHandshake: null,
    handshakeAge: null,
    pingOk: false,
    allowedIps: null,
    listenPort: null,
    rxBytes: null,
    txBytes: null,
  };

  // Check if the static interface is up
  const { stdout: ifaceOut } = await runCmd('wg', ['show', 'interfaces']);
  const ifaces = ifaceOut.trim().split(/\s+/);
  if (!ifaces.includes(STATIC_IFACE)) {
    return base;
  }

  base.interface = STATIC_IFACE;

  // Derive currentConfig by comparing the active config file content with
  // named candidate configs. SEC-12: normalise both sides by stripping DNS=
  // lines (switchConfig writes a DNS-stripped version to STATIC_IFACE.conf).
  try {
    const staticConfPath = path.join(CONFIG_DIR, `${STATIC_IFACE}.conf`);
    const staticContent = await readFile(staticConfPath, 'utf-8');
    const normalizedStatic = stripDnsLines(staticContent);

    const files = await readdir(CONFIG_DIR);
    const wildcardIdx = CONFIG_PATTERN.indexOf('*');
    const prefix = wildcardIdx >= 0 ? CONFIG_PATTERN.slice(0, wildcardIdx) : CONFIG_PATTERN;
    const suffix = wildcardIdx >= 0 ? CONFIG_PATTERN.slice(wildcardIdx + 1) : '';
    const candidates = files.filter(
      (f) => f.startsWith(prefix) && f.endsWith(suffix || '.conf') && f !== `${STATIC_IFACE}.conf`,
    );

    let matched: string | null = null;
    for (const filename of candidates) {
      try {
        const content = await readFile(path.join(CONFIG_DIR, filename), 'utf-8');
        if (stripDnsLines(content) === normalizedStatic) {
          matched = filename.replace('.conf', '');
          break;
        }
      } catch {
        // skip unreadable configs
      }
    }

    if (matched) {
      base.currentConfig = matched;
      await mkdir(path.dirname(STATE_FILE), { recursive: true });
      await writeFile(STATE_FILE, matched, 'utf-8').catch(() => {});
    } else {
      const stateContent = await readFile(STATE_FILE, 'utf-8').catch(() => '');
      base.currentConfig = stateContent.trim() || null;
    }
  } catch {
    base.currentConfig = null;
  }

  // SEC-15: use targeted wg commands to retrieve interface and peer stats
  // without exposing the private key. "wg show <iface> dump" includes the
  // private key on the first line; these targeted commands do not.
  // All commands run concurrently to minimise latency.
  const [
    { stdout: pubKeyOut },
    { stdout: listenPortOut },
    { stdout: endpointOut },
    { stdout: handshakeOut },
    { stdout: transferOut },
    { stdout: allowedOut },
  ] = await Promise.all([
    runCmd('wg', ['show', STATIC_IFACE, 'public-key']),
    runCmd('wg', ['show', STATIC_IFACE, 'listen-port']),
    runCmd('wg', ['show', STATIC_IFACE, 'endpoints']),
    runCmd('wg', ['show', STATIC_IFACE, 'latest-handshakes']),
    runCmd('wg', ['show', STATIC_IFACE, 'transfer']),
    runCmd('wg', ['show', STATIC_IFACE, 'allowed-ips']),
  ]);

  // Interface-level info
  base.publicKey   = pubKeyOut.trim() || null;
  base.listenPort  = parseInt(listenPortOut.trim(), 10) || null;

  // Per-peer info — each line is "<pubkey>\t<value>" (one line per peer).
  // We expect a single peer per active config; use the first line.
  const firstEndpointLine  = endpointOut.trim().split('\n')[0] ?? '';
  const firstHandshakeLine = handshakeOut.trim().split('\n')[0] ?? '';
  const firstTransferLine  = transferOut.trim().split('\n')[0] ?? '';
  const firstAllowedLine   = allowedOut.trim().split('\n')[0] ?? '';

  base.endpoint   = firstEndpointLine.split('\t')[1]?.trim()  || null;
  base.allowedIps = firstAllowedLine.split('\t')[1]?.trim()   || null;

  const rxRaw = firstTransferLine.split('\t')[1]?.trim();
  const txRaw = firstTransferLine.split('\t')[2]?.trim();
  base.rxBytes = rxRaw ? (parseInt(rxRaw, 10) || null) : null;
  base.txBytes = txRaw ? (parseInt(txRaw, 10) || null) : null;

  const hsRaw = firstHandshakeLine.split('\t')[1]?.trim();
  const hs = hsRaw ? parseInt(hsRaw, 10) : NaN;
  if (!isNaN(hs) && hs > 0) {
    base.lastHandshake = hs;
    base.handshakeAge  = Math.floor(Date.now() / 1000) - hs;
  }

  // Ping check (execFile — no shell)
  const { stdout: pingOut } = await runCmd('ping', ['-c', '1', '-W', '3', '-I', STATIC_IFACE, CHECK_IP]);
  base.pingOk = pingOut.includes('1 received') || pingOut.includes('1 packets received');

  // Determine connected: recent handshake (and optionally ping OK)
  if (base.handshakeAge !== null && base.handshakeAge < MAX_HANDSHAKE_AGE) {
    base.connected = true;
  }

  return base;
}

/**
 * WG-01: extract only safe metadata from a config file.
 * PrivateKey content is never returned or stored beyond the regex scan.
 * WG-B: detect IPv6 leak risk (routes all IPv4 but not all IPv6).
 */
function parseConfigMeta(content: string): {
  address: string | null;
  endpoint: string | null;
  comment: string | null;
  missingDns: boolean;
  ipv6LeakRisk: boolean;
} {
  const addrMatch    = content.match(/^Address\s*=\s*(.+)$/m);
  const epMatch      = content.match(/^Endpoint\s*=\s*(.+)$/m);
  const commentMatch = content.match(/^#\s*Device:\s*(.+)$/m);
  const dnsMatch     = content.match(/^DNS\s*=/m);

  // WG-B: check AllowedIPs in the [Peer] section for a full-tunnel IPv4 route
  // without the corresponding IPv6 route — this leaks IPv6 traffic outside the VPN.
  const allowedIpsMatch = content.match(/^AllowedIPs\s*=\s*(.+)$/m);
  const allowedIps      = allowedIpsMatch ? allowedIpsMatch[1].trim() : '';
  const ipv6LeakRisk    = allowedIps.includes('0.0.0.0/0') && !allowedIps.includes('::/0');

  return {
    address:      addrMatch    ? addrMatch[1].trim().split(',')[0]  : null,
    endpoint:     epMatch      ? epMatch[1].trim()                  : null,
    comment:      commentMatch ? commentMatch[1].trim()             : null,
    missingDns:   !dnsMatch,
    ipv6LeakRisk,
  };
}

export async function listConfigs(): Promise<WgConfig[]> {
  let files: string[];
  try {
    files = await readdir(CONFIG_DIR);
  } catch {
    return [];
  }

  // Read current active config
  let activeConfig: string | null = null;
  try {
    const stateContent = await readFile(STATE_FILE, 'utf-8');
    activeConfig = stateContent.trim();
  } catch {
    // no state file yet
  }

  // Filter to matching pattern, excluding the static interface file.
  // SEC-11: CONFIG_PATTERN is validated at startup to have a non-empty prefix.
  const wildcardIdx = CONFIG_PATTERN.indexOf('*');
  const prefix = wildcardIdx >= 0 ? CONFIG_PATTERN.slice(0, wildcardIdx) : CONFIG_PATTERN;
  const suffix = wildcardIdx >= 0 ? CONFIG_PATTERN.slice(wildcardIdx + 1) : '';
  const configs = files.filter(
    (f) => f.startsWith(prefix) && f.endsWith(suffix || '.conf') && f !== `${STATIC_IFACE}.conf`,
  );

  const results: WgConfig[] = [];
  for (const filename of configs.sort()) {
    const name     = filename.replace('.conf', '');
    const filePath = path.join(CONFIG_DIR, filename);

    let meta: ReturnType<typeof parseConfigMeta> = {
      address: null, endpoint: null, comment: null, missingDns: true, ipv6LeakRisk: false,
    };

    try {
      const content = await readFile(filePath, 'utf-8');
      meta = parseConfigMeta(content);
    } catch {
      // can't read config — leave defaults
    }

    results.push({
      name,
      filename,
      isActive:     name === activeConfig,
      address:      meta.address,
      endpoint:     meta.endpoint,
      comment:      meta.comment,
      missingDns:   meta.missingDns,
      ipv6LeakRisk: meta.ipv6LeakRisk,
    });
  }

  return results;
}

export async function switchConfig(configName: string): Promise<{ success: boolean; message: string }> {
  // Validate config name: only allow safe characters (prevents path traversal and injection)
  if (!/^[a-zA-Z0-9_-]+$/.test(configName)) {
    return { success: false, message: 'Invalid config name' };
  }

  const confPath   = path.join(CONFIG_DIR, `${configName}.conf`);
  const staticConf = path.join(CONFIG_DIR, `${STATIC_IFACE}.conf`);

  // Verify the config file exists
  try {
    await stat(confPath);
  } catch {
    return { success: false, message: 'Config not found' };
  }

  // Bring down existing interface — log but continue on failure (interface may
  // already be down). WG-C: check exit status instead of silently ignoring.
  const { ok: downOk, stderr: downErr } = await runCmd('wg-quick', ['down', STATIC_IFACE]);
  if (!downOk && downErr && !downErr.includes('is not a WireGuard interface') && !downErr.includes('No such device')) {
    console.warn(`[wg] wg-quick down warning: ${downErr.trim()}`);
  }
  await runCmd('ip', ['link', 'delete', STATIC_IFACE]);

  // WG-D: clear IP rules for ALL addresses in the config (IPv4 and IPv6).
  // The original code only cleaned up the first IPv4 address; multiple-address
  // configs or IPv6 addresses would leave stale rules that accumulate over time.
  try {
    const confContent = await readFile(confPath, 'utf-8');
    const addrMatch = confContent.match(/^Address\s*=\s*(.+)$/m);
    if (addrMatch) {
      const addresses = addrMatch[1].split(',').map((a) => a.trim()).filter(Boolean);
      for (const addr of addresses) {
        const ip = addr.split('/')[0];
        if (ip.includes(':')) {
          // IPv6
          await runCmd('ip', ['-6', 'rule', 'del', 'from', ip, 'table', '1000']);
        } else {
          // IPv4
          await runCmd('ip', ['-4', 'rule', 'del', 'from', ip, 'table', '1000']);
        }
      }
    }
  } catch {
    // non-critical — stale rules are cleaned up by wg-quick on next bring-up
  }

  // Write config using fs instead of shell.
  // Strip DNS= lines: wg-quick passes them to resolvconf whose dnsmasq hook
  // fails on YunoHost. A server manages its own DNS; the VPN shouldn't override it.
  // Named config files retain their DNS= lines for metadata display.
  const rawConf = await readFile(confPath, 'utf-8');
  const strippedConf = rawConf
    .split('\n')
    .filter((line) => !/^\s*DNS\s*=/i.test(line))
    .join('\n');
  await writeFile(staticConf, strippedConf, 'utf-8');
  await chmod(staticConf, 0o600);

  // Bring up the interface
  const { ok: upOk, stderr: upErr } = await runCmd('wg-quick', ['up', STATIC_IFACE]);
  if (!upOk) {
    const msg = `wg-quick up failed: ${upErr.trim() || 'unknown error'}`;
    await appendLog(`ERROR: Failed to switch to ${configName} — ${upErr.trim().split('\n').pop() ?? 'unknown error'}`);
    return { success: false, message: msg };
  }

  // Record the active config name
  await mkdir(path.dirname(STATE_FILE), { recursive: true });
  await writeFile(STATE_FILE, configName, 'utf-8');
  await appendLog(`MANUAL-SWITCH: ${configName} is now active as ${STATIC_IFACE}`);

  return { success: true, message: `Switched to ${configName}` };
}

export async function disconnectVPN(): Promise<{ success: boolean; message: string }> {
  const { stderr } = await runCmd('wg-quick', ['down', STATIC_IFACE]);
  await runCmd('ip', ['link', 'delete', STATIC_IFACE]);
  if (stderr && stderr.includes('Error') && !stderr.includes('Cannot find device')) {
    return { success: false, message: 'Disconnect failed' };
  }
  return { success: true, message: 'VPN disconnected' };
}

export async function runMonitor(): Promise<{ success: boolean; output: string }> {
  // SYS-02 / SEC-04: validate monitor script before execution (throws on unsafe)
  await validateMonitorScript();
  const { stdout, stderr } = await runCmd('bash', [MONITOR_SCRIPT]);
  return {
    success: !stderr.includes('CRITICAL'),
    output:  (stdout + stderr).trim(),
  };
}

export async function tailLog(lines = 100): Promise<string[]> {
  const { stdout } = await runCmd('tail', ['-n', String(lines), LOG_FILE]);
  if (!stdout.trim()) return [];
  return stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .reverse(); // newest first
}
