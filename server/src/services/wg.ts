import { execFile } from 'child_process';
import { readdir, readFile, writeFile, appendFile, chmod, stat, mkdir } from 'fs/promises';
import path from 'path';

// ── Environment config ──────────────────────────────────────

const CONFIG_DIR = process.env.WG_CONFIG_DIR || '/etc/wireguard';
const CONFIG_PATTERN = process.env.WG_CONFIG_PATTERN || 'nl-ams-wg-*.conf';
const STATIC_IFACE = process.env.WG_STATIC_INTERFACE || 'wg-vpn';
const MONITOR_SCRIPT = process.env.MONITOR_SCRIPT || '/usr/local/bin/vpn-monitor.sh';
const LOG_FILE = process.env.LOG_FILE || '/var/log/vpn-monitor.log';
const STATE_FILE = process.env.STATE_FILE || '/var/lib/vpn-monitor.current';
const CHECK_IP = process.env.CHECK_IP || '1.1.1.1';
const MAX_HANDSHAKE_AGE = parseInt(process.env.MAX_HANDSHAKE_AGE || '120', 10);

// ── Validation helpers (run once at import time) ────────────

const SAFE_PATH_RE = /^\/[a-zA-Z0-9/_.-]+$/;
const SAFE_IFACE_RE = /^[a-zA-Z0-9_-]+$/;
const SAFE_IP_RE = /^[0-9.:a-fA-F]+$/;

function validateEnv(): void {
  if (!SAFE_PATH_RE.test(CONFIG_DIR)) throw new Error(`Unsafe WG_CONFIG_DIR: ${CONFIG_DIR}`);
  if (!SAFE_IFACE_RE.test(STATIC_IFACE)) throw new Error(`Unsafe WG_STATIC_INTERFACE: ${STATIC_IFACE}`);
  if (!SAFE_PATH_RE.test(MONITOR_SCRIPT)) throw new Error(`Unsafe MONITOR_SCRIPT: ${MONITOR_SCRIPT}`);
  if (!SAFE_PATH_RE.test(LOG_FILE)) throw new Error(`Unsafe LOG_FILE: ${LOG_FILE}`);
  if (!SAFE_PATH_RE.test(STATE_FILE)) throw new Error(`Unsafe STATE_FILE: ${STATE_FILE}`);
  if (!SAFE_IP_RE.test(CHECK_IP)) throw new Error(`Unsafe CHECK_IP: ${CHECK_IP}`);
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

// ── SYS-02: validate monitor script ownership ──────────────

async function validateMonitorScript(): Promise<void> {
  try {
    const s = await stat(MONITOR_SCRIPT);
    if (s.uid !== 0) {
      console.warn(`[wg] WARNING: MONITOR_SCRIPT ${MONITOR_SCRIPT} is not owned by root (uid=${s.uid})`);
    }
    // Check it is not world-writable
    // eslint-disable-next-line no-bitwise
    if (s.mode & 0o002) {
      throw new Error(`MONITOR_SCRIPT ${MONITOR_SCRIPT} is world-writable — refusing to execute`);
    }
  } catch (err: any) {
    if (err.code === 'ENOENT') return; // will fail gracefully when invoked
    throw err;
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

  // Check if wg-vpn interface exists
  const { stdout: ifaceOut } = await runCmd('wg', ['show', 'interfaces']);
  const ifaces = ifaceOut.trim().split(/\s+/);
  if (!ifaces.includes(STATIC_IFACE)) {
    return base;
  }

  base.interface = STATIC_IFACE;

  // Derive currentConfig from the actual running config file content.
  // The monitor script may switch configs without updating our state file,
  // so comparing STATIC_IFACE.conf byte-for-byte against named configs is
  // the only reliable source of truth.
  try {
    const staticConfPath = path.join(CONFIG_DIR, `${STATIC_IFACE}.conf`);
    const staticContent = await readFile(staticConfPath, 'utf-8');

    const files = await readdir(CONFIG_DIR);
    const prefix = CONFIG_PATTERN.replace('*', '').replace('.conf', '');
    const candidates = files.filter(
      (f) => f.startsWith(prefix) && f.endsWith('.conf') && f !== `${STATIC_IFACE}.conf`
    );

    let matched: string | null = null;
    for (const filename of candidates) {
      try {
        const content = await readFile(path.join(CONFIG_DIR, filename), 'utf-8');
        if (content === staticContent) {
          matched = filename.replace('.conf', '');
          break;
        }
      } catch {
        // skip unreadable configs
      }
    }

    if (matched) {
      base.currentConfig = matched;
      // Keep state file in sync so listConfigs() reflects reality
      await mkdir(path.dirname(STATE_FILE), { recursive: true });
      await writeFile(STATE_FILE, matched, 'utf-8').catch(() => {});
    } else {
      // Fall back to state file if no content match (e.g. config was modified)
      const stateContent = await readFile(STATE_FILE, 'utf-8').catch(() => '');
      base.currentConfig = stateContent.trim() || null;
    }
  } catch {
    base.currentConfig = null;
  }

  // Parse wg show dump for stats
  const { stdout: dumpOut } = await runCmd('wg', ['show', STATIC_IFACE, 'dump']);
  const lines = dumpOut.trim().split('\n');

  if (lines.length >= 1) {
    const ifaceLine = lines[0].split('\t');
    // private_key, public_key, listen_port, fwmark
    if (ifaceLine.length >= 3) {
      base.publicKey = ifaceLine[1] || null;
      base.listenPort = parseInt(ifaceLine[2], 10) || null;
    }
  }

  if (lines.length >= 2) {
    const peerLine = lines[1].split('\t');
    // public_key, preshared_key, endpoint, allowed_ips, latest_handshake, rx_bytes, tx_bytes, persistent_keepalive
    if (peerLine.length >= 7) {
      base.endpoint = peerLine[2] || null;
      base.allowedIps = peerLine[3] || null;
      const hs = parseInt(peerLine[4], 10);
      if (!isNaN(hs) && hs > 0) {
        base.lastHandshake = hs;
        base.handshakeAge = Math.floor(Date.now() / 1000) - hs;
      }
      base.rxBytes = parseInt(peerLine[5], 10) || null;
      base.txBytes = parseInt(peerLine[6], 10) || null;
    }
  }

  // Ping check (execFile — no shell)
  const { stdout: pingOut } = await runCmd('ping', ['-c', '1', '-W', '3', '-I', STATIC_IFACE, CHECK_IP]);
  base.pingOk = pingOut.includes('1 received') || pingOut.includes('1 packets received');

  // Determine connected: handshake recent + ping OK
  if (
    base.handshakeAge !== null &&
    base.handshakeAge < MAX_HANDSHAKE_AGE &&
    base.pingOk
  ) {
    base.connected = true;
  } else if (base.lastHandshake !== null && base.handshakeAge !== null && base.handshakeAge < MAX_HANDSHAKE_AGE) {
    base.connected = true;
  }

  return base;
}

/**
 * WG-01: extract only safe metadata from a config file.
 * PrivateKey content is never returned or stored beyond the regex scan.
 */
function parseConfigMeta(content: string): {
  address: string | null;
  endpoint: string | null;
  comment: string | null;
  missingDns: boolean;
} {
  const addrMatch = content.match(/^Address\s*=\s*(.+)$/m);
  const epMatch = content.match(/^Endpoint\s*=\s*(.+)$/m);
  const commentMatch = content.match(/^#\s*Device:\s*(.+)$/m);
  const dnsMatch = content.match(/^DNS\s*=/m);
  return {
    address: addrMatch ? addrMatch[1].trim().split(',')[0] : null,
    endpoint: epMatch ? epMatch[1].trim() : null,
    comment: commentMatch ? commentMatch[1].trim() : null,
    missingDns: !dnsMatch,
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

  // Filter to matching pattern but not the static interface itself
  const prefix = CONFIG_PATTERN.replace('*', '').replace('.conf', '');
  const configs = files.filter(
    (f) => f.startsWith(prefix) && f.endsWith('.conf') && f !== `${STATIC_IFACE}.conf`
  );

  const results: WgConfig[] = [];
  for (const filename of configs.sort()) {
    const name = filename.replace('.conf', '');
    const filePath = path.join(CONFIG_DIR, filename);

    let meta: ReturnType<typeof parseConfigMeta> = {
      address: null, endpoint: null, comment: null, missingDns: true,
    };

    try {
      const content = await readFile(filePath, 'utf-8');
      meta = parseConfigMeta(content);
    } catch {
      // can't read config
    }

    results.push({
      name,
      filename,
      isActive: name === activeConfig,
      address: meta.address,
      endpoint: meta.endpoint,
      comment: meta.comment,
      missingDns: meta.missingDns,
    });
  }

  return results;
}

export async function switchConfig(configName: string): Promise<{ success: boolean; message: string }> {
  // Validate config name: only allow safe characters (prevents path traversal and injection)
  if (!/^[a-zA-Z0-9_-]+$/.test(configName)) {
    return { success: false, message: 'Invalid config name' };
  }

  const confPath = path.join(CONFIG_DIR, `${configName}.conf`);
  const staticConf = path.join(CONFIG_DIR, `${STATIC_IFACE}.conf`);

  // Verify the config file exists
  try {
    await stat(confPath);
  } catch {
    return { success: false, message: 'Config not found' };
  }

  // Bring down existing interface
  await runCmd('wg-quick', ['down', STATIC_IFACE]);
  await runCmd('ip', ['link', 'delete', STATIC_IFACE]);

  // Clear lingering IP rules
  try {
    const confContent = await readFile(confPath, 'utf-8');
    const addrMatch = confContent.match(/^Address\s*=\s*([0-9.]+)/m);
    if (addrMatch) {
      await runCmd('ip', ['-4', 'rule', 'del', 'from', addrMatch[1], 'table', '1000']);
    }
  } catch {
    // non-critical
  }

  // VULN-05: write config using fs instead of shell.
  // Strip DNS= lines: wg-quick passes them to resolvconf whose dnsmasq hook
  // fails on YunoHost. A server manages its own DNS and the VPN shouldn't
  // override it. Named config files retain their DNS= lines for metadata display.
  const rawConf = await readFile(confPath, 'utf-8');
  const strippedConf = rawConf
    .split('\n')
    .filter((line) => !/^\s*DNS\s*=/i.test(line))
    .join('\n');
  await writeFile(staticConf, strippedConf, 'utf-8');
  await chmod(staticConf, 0o600);

  // Bring up
  const { ok: upOk, stderr: upErr } = await runCmd('wg-quick', ['up', STATIC_IFACE]);
  if (!upOk) {
    const msg = `wg-quick up failed: ${upErr.trim() || 'unknown error'}`;
    await appendLog(`ERROR: Failed to switch to ${configName} — ${upErr.trim().split('\n').pop() ?? 'unknown error'}`);
    return { success: false, message: msg };
  }

  // VULN-05: write state file using fs instead of shell echo
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
  // SYS-02: validate monitor script before execution
  await validateMonitorScript();
  const { stdout, stderr } = await runCmd('bash', [MONITOR_SCRIPT]);
  return {
    success: !stderr.includes('CRITICAL'),
    output: (stdout + stderr).trim(),
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
