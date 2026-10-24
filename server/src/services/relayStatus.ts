import { readFile, writeFile, rename } from 'fs/promises';
import { listConfigs, readConfig } from './wg';

// Checks each config's server against Mullvad's public relay list, so the UI
// can flag servers Mullvad has taken offline or removed. A real handshake test
// would need a second tunnel with the same key, which disturbs the live one.

const RELAY_LIST_URL = 'https://api.mullvad.net/www/relays/wireguard/';
const DATA_DIR       = process.env.DATA_DIR || '/var/lib/wg-man';
const CACHE_FILE     = `${DATA_DIR}/relay-status.json`;
const MAX_AGE_MS     = 6 * 60 * 60 * 1000;  // auto-recheck after 6 h
const MIN_RECHECK_MS = 10 * 1000;           // ignore recheck spam

export type RelayState = 'online' | 'offline' | 'removed' | 'outdated' | 'unknown';

export type RelayStatusEntry = {
  status: RelayState;
  /** Human-readable reason shown as a tooltip */
  detail: string;
};

export type RelayStatusReport = {
  checkedAt: number | null;
  error: string | null;
  configs: Record<string, RelayStatusEntry>;
};

export type MullvadRelay = {
  hostname: string;
  active: boolean;
  ipv4_addr_in: string;
  ipv6_addr_in?: string;
  pubkey: string;
};

// Mullvad hostnames look like "nl-ams-wg-001"
const MULLVAD_NAME_RE = /^[a-z]{2}-[a-z]{3}-wg-[a-z0-9-]+$/;

let cache: RelayStatusReport | null = null;
let inFlight: Promise<RelayStatusReport> | null = null;

async function loadCache(): Promise<RelayStatusReport | null> {
  if (cache) return cache;
  try {
    cache = JSON.parse(await readFile(CACHE_FILE, 'utf-8'));
  } catch {
    // no cache yet
  }
  return cache;
}

async function saveCache(report: RelayStatusReport): Promise<void> {
  cache = report;
  const tmp = `${CACHE_FILE}.tmp`;
  await writeFile(tmp, JSON.stringify(report), 'utf-8');
  await rename(tmp, CACHE_FILE);
}

export function classify(name: string, content: string, relays: MullvadRelay[]): RelayStatusEntry {
  const pubkey   = content.match(/^PublicKey\s*=\s*(\S+)/m)?.[1] ?? null;
  const endpoint = content.match(/^Endpoint\s*=\s*(\S+)/m)?.[1] ?? '';
  const host     = endpoint.replace(/^\[/, '').replace(/\]?:\d+$/, '');

  const relay = relays.find((r) => pubkey && r.pubkey === pubkey)
             ?? relays.find((r) => r.hostname === name);

  if (!relay) {
    return MULLVAD_NAME_RE.test(name)
      ? { status: 'removed', detail: 'Mullvad no longer lists this server' }
      : { status: 'unknown', detail: 'Not a Mullvad server, cannot check' };
  }
  if (!relay.active) {
    return { status: 'offline', detail: `Mullvad reports ${relay.hostname} as offline` };
  }
  if (relay.pubkey !== pubkey || (host && host !== relay.ipv4_addr_in && host !== relay.ipv6_addr_in)) {
    return { status: 'outdated', detail: `${relay.hostname} changed its key or IP — re-download this config` };
  }
  return { status: 'online', detail: `${relay.hostname} is online` };
}

/** Download Mullvad's public WireGuard relay list. */
export async function fetchRelayList(): Promise<MullvadRelay[]> {
  const res = await fetch(RELAY_LIST_URL, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const relays = await res.json() as MullvadRelay[];
  if (!Array.isArray(relays)) throw new Error('unexpected response');
  return relays;
}

async function check(): Promise<RelayStatusReport> {
  const configs = await listConfigs();
  let relays: MullvadRelay[];
  try {
    relays = await fetchRelayList();
  } catch (err: any) {
    // Keep the last known statuses but surface the failure
    const prev = await loadCache();
    return { checkedAt: prev?.checkedAt ?? null, configs: prev?.configs ?? {},
             error: `Could not reach Mullvad: ${err.message ?? err}` };
  }

  const result: Record<string, RelayStatusEntry> = {};
  for (const cfg of configs) {
    try {
      result[cfg.name] = classify(cfg.name, await readConfig(cfg.name), relays);
    } catch {
      result[cfg.name] = { status: 'unknown', detail: 'Could not read config' };
    }
  }
  const report = { checkedAt: Date.now(), error: null, configs: result };
  await saveCache(report);
  return report;
}

/** Return relay statuses, rechecking when forced or when the cache is stale. */
export async function getRelayStatus(force = false): Promise<RelayStatusReport> {
  const cached = await loadCache();
  const age = cached?.checkedAt ? Date.now() - cached.checkedAt : Infinity;
  // A config added since the last check also triggers a recheck
  const hasAll = !!cached && (await listConfigs()).every((c) => c.name in cached.configs);
  if (cached && hasAll && age < (force ? MIN_RECHECK_MS : MAX_AGE_MS)) return cached;
  if (!inFlight) inFlight = check().finally(() => { inFlight = null; });
  return inFlight;
}
