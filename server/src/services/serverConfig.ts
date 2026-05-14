import { readFile, writeFile } from 'fs/promises';
import { execFile } from 'child_process';
import path from 'path';

const IS_PROD = process.env.NODE_ENV === 'production';
const DATA_DIR = process.env.DATA_DIR || '/var/lib/wg-man';
const CONFIG_FILE = path.join(DATA_DIR, 'server-config.json');

export interface ServerConfig {
  configDir:        string;
  configPattern:    string;
  staticInterface:  string;
  checkIp:          string;
  maxHandshakeAge:  number;
  stateFile:        string;
  logFile:          string;
  monitorScript:    string;
}

export function readServerConfig(): ServerConfig {
  return {
    configDir:       process.env.WG_CONFIG_DIR       || '/etc/wireguard',
    configPattern:   process.env.WG_CONFIG_PATTERN   || 'wg-*.conf',
    staticInterface: process.env.WG_STATIC_INTERFACE || 'wg-vpn',
    checkIp:         process.env.CHECK_IP            || '1.1.1.1',
    maxHandshakeAge: parseInt(process.env.MAX_HANDSHAKE_AGE || '150', 10),
    stateFile:       process.env.STATE_FILE          || '/var/lib/vpn-monitor.current',
    logFile:         process.env.LOG_FILE            || '/var/log/vpn-monitor.log',
    monitorScript:   process.env.MONITOR_SCRIPT      || '/usr/local/bin/vpn-monitor.sh',
  };
}

const SAFE_PATH_RE    = /^\/[a-zA-Z0-9/_.-]+$/;
const SAFE_IFACE_RE   = /^[a-zA-Z0-9_-]+$/;
const SAFE_IP_RE      = /^[0-9.:a-fA-F]+$/;
const SAFE_PATTERN_RE = /^[a-zA-Z0-9][a-zA-Z0-9*_.-]*$/;

export interface ConfigUpdate {
  configDir?:       string;
  configPattern?:   string;
  staticInterface?: string;
  checkIp?:         string;
  maxHandshakeAge?: number;
}

export function validateConfigUpdate(u: ConfigUpdate): string | null {
  if (u.configDir !== undefined) {
    if (!SAFE_PATH_RE.test(u.configDir)) return 'configDir must be an absolute path with safe characters';
  }
  if (u.configPattern !== undefined) {
    if (!SAFE_PATTERN_RE.test(u.configPattern))
      return 'configPattern must start with an alphanumeric character (e.g. wg-*.conf)';
    const wildcardIdx = u.configPattern.indexOf('*');
    const prefix = wildcardIdx >= 0 ? u.configPattern.slice(0, wildcardIdx) : u.configPattern;
    if (prefix.length === 0) return 'configPattern must have a non-empty prefix before the wildcard';
  }
  if (u.staticInterface !== undefined) {
    if (!SAFE_IFACE_RE.test(u.staticInterface))
      return 'staticInterface must contain only alphanumerics, underscores, and hyphens';
  }
  if (u.checkIp !== undefined) {
    if (!SAFE_IP_RE.test(u.checkIp)) return 'checkIp must be a valid IPv4 or IPv6 address';
  }
  if (u.maxHandshakeAge !== undefined) {
    if (!Number.isInteger(u.maxHandshakeAge) || u.maxHandshakeAge < 30 || u.maxHandshakeAge > 600)
      return 'maxHandshakeAge must be an integer between 30 and 600';
  }
  return null;
}

export async function updateServerConfig(updates: ConfigUpdate): Promise<void> {
  let existing: Record<string, unknown> = {};
  try {
    const raw = await readFile(CONFIG_FILE, 'utf8');
    existing = JSON.parse(raw);
  } catch {
    // file doesn't exist yet — start fresh
  }

  const merged = { ...existing, ...updates };
  await writeFile(CONFIG_FILE, JSON.stringify(merged, null, 2), { mode: 0o640 });

  if (IS_PROD) {
    setTimeout(() => {
      execFile('systemctl', ['restart', 'wg-man'], () => {});
    }, 500);
  }
}
