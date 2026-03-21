import { readFile, writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { getStatus } from './wg';

const HISTORY_FILE = process.env.HISTORY_FILE || '/var/lib/wg-man/history.json';
const MAX_EVENTS = 2000;

export type VpnHistoryEvent = {
  ts: number;                                          // unix ms — when this state began
  type: 'connected' | 'disconnected' | 'switched';
  config: string | null;
  endpoint: string | null;
};

// ── Persistence ────────────────────────────────────────────────

let _cache: VpnHistoryEvent[] | null = null;

async function loadEvents(): Promise<VpnHistoryEvent[]> {
  if (_cache !== null) return _cache;
  try {
    const raw = await readFile(HISTORY_FILE, 'utf-8');
    _cache = JSON.parse(raw);
  } catch {
    _cache = [];
  }
  return _cache!;
}

async function persistEvents(events: VpnHistoryEvent[]): Promise<void> {
  try {
    await mkdir(path.dirname(HISTORY_FILE), { recursive: true });
    await writeFile(HISTORY_FILE, JSON.stringify(events), 'utf-8');
  } catch { /* ignore — disk errors shouldn't crash the server */ }
}

export async function recordEvent(event: VpnHistoryEvent): Promise<void> {
  const events = await loadEvents();
  events.push(event);
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
  await persistEvents(events);
}

export async function getHistory(limit = 500): Promise<VpnHistoryEvent[]> {
  const events = await loadEvents();
  return events.slice(-limit).reverse(); // newest first
}

// ── State tracker ──────────────────────────────────────────────

type TrackerState = { connected: boolean; config: string | null; endpoint: string | null };
let _tracker: TrackerState | null = null;

async function initTracker(): Promise<void> {
  const events = await loadEvents();
  if (events.length === 0) return;
  const last = events[events.length - 1]; // newest entry (stored oldest-first)
  _tracker = {
    connected: last.type !== 'disconnected',
    config: last.config,
    endpoint: last.endpoint,
  };
}

async function check(): Promise<void> {
  try {
    const status = await getStatus();
    const now = Date.now();
    const { connected, currentConfig: config, endpoint } = status;

    if (_tracker === null) {
      // First run with no prior history: record the current state so the
      // history page immediately reflects an ongoing connection rather than
      // appearing empty until the VPN next disconnects and reconnects.
      if (connected) {
        await recordEvent({ ts: now, type: 'connected', config, endpoint });
      }
      _tracker = { connected, config, endpoint };
      return;
    }

    const prev = _tracker;

    if (!prev.connected && connected) {
      await recordEvent({ ts: now, type: 'connected', config, endpoint });
      _tracker = { connected: true, config, endpoint };
    } else if (prev.connected && !connected) {
      await recordEvent({ ts: now, type: 'disconnected', config: null, endpoint: null });
      _tracker = { connected: false, config: null, endpoint: null };
    } else if (prev.connected && connected && prev.config !== config) {
      await recordEvent({ ts: now, type: 'switched', config, endpoint });
      _tracker = { connected: true, config, endpoint };
    }
  } catch { /* ignore */ }
}

export async function startHistoryTracker(): Promise<void> {
  await initTracker();
  await check(); // prime on startup
  setInterval(check, 10_000);
}
