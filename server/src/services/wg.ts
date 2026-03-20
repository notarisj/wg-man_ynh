import { exec } from 'child_process';
import { promisify } from 'util';
import { readdir, readFile } from 'fs/promises';
import path from 'path';

const execAsync = promisify(exec);

const CONFIG_DIR = process.env.WG_CONFIG_DIR || '/etc/wireguard';
const CONFIG_PATTERN = process.env.WG_CONFIG_PATTERN || 'nl-ams-wg-*.conf';
const STATIC_IFACE = process.env.WG_STATIC_INTERFACE || 'wg-vpn';
const MONITOR_SCRIPT = process.env.MONITOR_SCRIPT || '/home/notaris/scripts/vpn-monitor.sh';
const LOG_FILE = process.env.LOG_FILE || '/var/log/vpn-monitor.log';
const STATE_FILE = process.env.STATE_FILE || '/var/lib/vpn-monitor.current';
const CHECK_IP = process.env.CHECK_IP || '1.1.1.1';
const MAX_HANDSHAKE_AGE = parseInt(process.env.MAX_HANDSHAKE_AGE || '120', 10);

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
}

async function runCmd(cmd: string): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execAsync(cmd, { timeout: 10000 });
  } catch (err: any) {
    return { stdout: err.stdout || '', stderr: err.stderr || '' };
  }
}

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
  const { stdout: ifaceOut } = await runCmd(`wg show interfaces`);
  const ifaces = ifaceOut.trim().split(/\s+/);
  if (!ifaces.includes(STATIC_IFACE)) {
    return base;
  }

  base.interface = STATIC_IFACE;

  // Read current config name from state file
  try {
    const stateContent = await readFile(STATE_FILE, 'utf-8');
    base.currentConfig = stateContent.trim();
  } catch {
    base.currentConfig = null;
  }

  // Parse wg show dump for stats
  const { stdout: dumpOut } = await runCmd(`wg show ${STATIC_IFACE} dump`);
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

  // Ping check
  const { stdout: pingOut } = await runCmd(
    `ping -c 1 -W 3 -I ${STATIC_IFACE} ${CHECK_IP}`
  );
  base.pingOk = pingOut.includes('1 received') || pingOut.includes('1 packets received');

  // Determine connected: handshake recent + ping OK
  if (
    base.handshakeAge !== null &&
    base.handshakeAge < MAX_HANDSHAKE_AGE &&
    base.pingOk
  ) {
    base.connected = true;
  } else if (base.lastHandshake !== null && base.handshakeAge !== null && base.handshakeAge < MAX_HANDSHAKE_AGE) {
    // Handshake is fresh even if ping failed (e.g. firewall)
    base.connected = true;
  }

  return base;
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

  // Filter to matching pattern (nl-ams-wg-*.conf) but not wg-vpn itself
  const prefix = CONFIG_PATTERN.replace('*', '').replace('.conf', '');
  const configs = files.filter(
    (f) => f.startsWith(prefix) && f.endsWith('.conf') && f !== `${STATIC_IFACE}.conf`
  );

  const results: WgConfig[] = [];
  for (const filename of configs.sort()) {
    const name = filename.replace('.conf', '');
    const filePath = path.join(CONFIG_DIR, filename);

    let address: string | null = null;
    let endpoint: string | null = null;
    let comment: string | null = null;

    try {
      const content = await readFile(filePath, 'utf-8');
      const addrMatch = content.match(/^Address\s*=\s*(.+)$/m);
      const epMatch = content.match(/^Endpoint\s*=\s*(.+)$/m);
      const commentMatch = content.match(/^#\s*Device:\s*(.+)$/m);
      address = addrMatch ? addrMatch[1].trim().split(',')[0] : null;
      endpoint = epMatch ? epMatch[1].trim() : null;
      comment = commentMatch ? commentMatch[1].trim() : null;
    } catch {
      // can't read config
    }

    results.push({
      name,
      filename,
      isActive: name === activeConfig,
      address,
      endpoint,
      comment,
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

  // Verify the config file exists before proceeding
  try {
    await readFile(confPath, 'utf-8');
  } catch {
    return { success: false, message: 'Config not found' };
  }

  // Bring down existing interface
  await runCmd(`wg-quick down ${STATIC_IFACE}`);
  await runCmd(`ip link delete ${STATIC_IFACE}`);

  // Clear lingering IP rules
  const confContent = await readFile(confPath, 'utf-8').catch(() => '');
  const addrMatch = confContent.match(/^Address\s*=\s*([0-9.]+)/m);
  if (addrMatch) {
    await runCmd(`ip -4 rule del from ${addrMatch[1]} table 1000`);
  }

  // Copy config
  const { stdout: cpOut, stderr: cpErr } = await runCmd(`cp "${confPath}" "${staticConf}" && chmod 600 "${staticConf}"`);

  // Bring up
  const { stderr: upErr } = await runCmd(`wg-quick up ${STATIC_IFACE}`);
  if (upErr && upErr.includes('Error')) {
    return { success: false, message: `wg-quick up failed: ${upErr}` };
  }

  // Write state
  await runCmd(`echo "${configName}" > "${STATE_FILE}"`);

  return { success: true, message: `Switched to ${configName}` };
}

export async function disconnectVPN(): Promise<{ success: boolean; message: string }> {
  const { stderr } = await runCmd(`wg-quick down ${STATIC_IFACE}`);
  await runCmd(`ip link delete ${STATIC_IFACE}`);
  if (stderr && stderr.includes('Error') && !stderr.includes('Cannot find device')) {
    return { success: false, message: stderr };
  }
  return { success: true, message: 'VPN disconnected' };
}

export async function runMonitor(): Promise<{ success: boolean; output: string }> {
  const { stdout, stderr } = await runCmd(`bash "${MONITOR_SCRIPT}"`);
  return {
    success: !stderr.includes('CRITICAL'),
    output: (stdout + stderr).trim(),
  };
}

export async function tailLog(lines = 100): Promise<string[]> {
  const { stdout } = await runCmd(`tail -n ${lines} "${LOG_FILE}"`);
  if (!stdout.trim()) return [];
  return stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .reverse(); // newest first
}
