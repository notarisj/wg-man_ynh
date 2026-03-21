import { create } from 'zustand';
import { api, VpnWebSocket } from '../lib/api';
import type { VpnStatus, WgConfig, SystemMetrics } from '../lib/api';

const SYSTEM_HISTORY_MAX = 40;

type User = { username: string; email?: string };

// Module-level interval so it survives store re-renders
let liveIntervalId: ReturnType<typeof setInterval> | null = null;
const LIVE_INTERVAL_MS = 5000;

// ── Dev mock logs ─────────────────────────────────────────────
const DEV_MOCK_LOGS: string[] = import.meta.env.DEV ? (() => {
  const configs = ['wg0', 'mullvad-se', 'office-vpn', 'home-tunnel'];
  const messages = [
    (cfg: string) => `[INFO] vpn-monitor started, watching config: ${cfg}.conf`,
    (cfg: string) => `[ACTION] Attempting to activate ${cfg}`,
    (cfg: string) => `[SUCCESS] ${cfg} is now active — handshake confirmed`,
    (_: string) => `[INFO] Ping 1.1.1.1 — OK (32ms)`,
    (_: string) => `[INFO] Ping 1.1.1.1 — OK (28ms)`,
    (_: string) => `[INFO] Ping 1.1.1.1 — FAILED, retrying...`,
    (cfg: string) => `[ERROR] wg show ${cfg} returned non-zero exit code`,
    (cfg: string) => `[TRIGGER] Handshake age exceeded threshold for ${cfg}`,
    (_: string) => `[INFO] Traffic ↑ 1.4 MB ↓ 8.2 MB`,
    (_: string) => `[CRITICAL] No healthy config found after 3 attempts — giving up`,
    (cfg: string) => `[ACTION] Switching from ${cfg} to fallback config`,
    (_: string) => `[INFO] Scheduler tick — checking tunnel health`,
    (_: string) => `[INFO] WireGuard interface wg0 up`,
    (_: string) => `[ERROR] Failed to bring up interface: permission denied`,
    (_: string) => `[SUCCESS] Auto-connect completed successfully`,
  ];
  const base = new Date('2026-03-21T02:00:00');
  return Array.from({ length: 150 }, (_, i) => {
    const ts = new Date(base.getTime() + i * 23000).toISOString().replace('T', ' ').slice(0, 19);
    const cfg = configs[i % configs.length];
    const msg = messages[i % messages.length](cfg);
    return `${ts}  ${msg}`;
  });
})() : [];

interface VpnStore {
  // State
  status: VpnStatus | null;
  configs: WgConfig[];
  logs: string[];
  user: User | null;
  isConnecting: boolean;
  isDisconnecting: boolean;
  isSwitching: string | null; // config name being switched to
  isLoadingStatus: boolean;
  isLoadingConfigs: boolean;
  isLoadingLogs: boolean;
  lastUpdated: number | null;
  error: string | null;
  wsInstance: VpnWebSocket | null;
  liveMode: boolean;
  systemMetrics: SystemMetrics | null;
  systemHistory: SystemMetrics[];

  // Actions
  fetchMe: () => Promise<void>;
  fetchStatus: () => Promise<void>;
  fetchConfigs: () => Promise<void>;
  fetchLogs: (lines?: number) => Promise<void>;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  switchConfig: (name: string) => Promise<boolean>;
  startWebSocket: () => void;
  stopWebSocket: () => void;
  clearError: () => void;
  setLiveMode: (enabled: boolean) => void;
}

export const useVpnStore = create<VpnStore>((set, get) => ({
  status: null,
  configs: [],
  logs: [],
  user: null,
  isConnecting: false,
  isDisconnecting: false,
  isSwitching: null,
  isLoadingStatus: false,
  isLoadingConfigs: false,
  isLoadingLogs: false,
  lastUpdated: null,
  error: null,
  wsInstance: null,
  liveMode: false,
  systemMetrics: null,
  systemHistory: [],

  fetchMe: async () => {
    const res = await api.me();
    if (res.ok) set({ user: res.data.user });
  },

  fetchStatus: async () => {
    set({ isLoadingStatus: true });
    const res = await api.status();
    if (res.ok) {
      set({ status: res.data, lastUpdated: Date.now(), isLoadingStatus: false, error: null });
    } else {
      set({ isLoadingStatus: false, error: res.error });
    }
  },

  fetchConfigs: async () => {
    set({ isLoadingConfigs: true });
    const res = await api.configs();
    if (res.ok) {
      set({ configs: res.data, isLoadingConfigs: false });
    } else {
      set({ isLoadingConfigs: false, error: res.error });
    }
  },

  fetchLogs: async (lines = 100) => {
    if (import.meta.env.DEV) {
      set({ logs: DEV_MOCK_LOGS.slice(-lines), isLoadingLogs: false });
      return;
    }
    set({ isLoadingLogs: true });
    const res = await api.logs(lines);
    if (res.ok) {
      set({ logs: res.data, isLoadingLogs: false });
    } else {
      set({ isLoadingLogs: false, error: res.error });
    }
  },

  connect: async () => {
    set({ isConnecting: true, error: null });
    const res = await api.connect();
    set({ isConnecting: false });
    if (!res.ok) {
      set({ error: res.error });
    } else {
      // WS push will deliver updated status + logs within PUSH_INTERVAL_MS
    }
  },

  disconnect: async () => {
    set({ isDisconnecting: true, error: null });
    const res = await api.disconnect();
    set({ isDisconnecting: false });
    if (!res.ok) {
      set({ error: res.error });
    }
    // WS push will deliver updated status + logs within PUSH_INTERVAL_MS
  },

  switchConfig: async (name: string) => {
    set({ isSwitching: name, error: null });
    const res = await api.switchConfig(name);
    set({ isSwitching: null });
    if (!res.ok) {
      set({ error: res.error });
      return false;
    } else {
      get().fetchConfigs();
      // WS push will deliver updated status + logs within PUSH_INTERVAL_MS
      return true;
    }
  },

  startWebSocket: () => {
    const existing = get().wsInstance;
    if (existing) return;

    const ws = new VpnWebSocket();
    const unsub = ws.subscribe((msg) => {
      if (msg.type === 'status') {
        set({ status: msg.payload, lastUpdated: msg.ts, error: null });
      } else if (msg.type === 'logs') {
        // Don't overwrite a larger HTTP fetch with the WS's smaller push
        if (msg.payload.length >= get().logs.length) {
          set({ logs: msg.payload });
        }
      } else if (msg.type === 'system') {
        const history = [...get().systemHistory, msg.payload].slice(-SYSTEM_HISTORY_MAX);
        set({ systemMetrics: msg.payload, systemHistory: history });
      }
    });
    ws.connect();
    set({ wsInstance: ws });

    // Store unsub for cleanup (workaround - attach to ws instance)
    (ws as any)._unsub = unsub;
  },

  stopWebSocket: () => {
    const ws = get().wsInstance;
    if (ws) {
      (ws as any)._unsub?.();
      ws.disconnect();
      set({ wsInstance: null });
    }
  },

  clearError: () => set({ error: null }),

  setLiveMode: (enabled: boolean) => {
    if (enabled) {
      set({ liveMode: true });
      // Immediately refresh, then poll
      get().fetchStatus();
      get().fetchConfigs();
      get().fetchLogs(50);
      liveIntervalId = setInterval(() => {
        get().fetchStatus();
        get().fetchConfigs();
        get().fetchLogs(50);
      }, LIVE_INTERVAL_MS);
    } else {
      set({ liveMode: false });
      if (liveIntervalId !== null) {
        clearInterval(liveIntervalId);
        liveIntervalId = null;
      }
    }
  },
}));
