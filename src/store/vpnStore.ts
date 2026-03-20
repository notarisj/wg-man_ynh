import { create } from 'zustand';
import { api, VpnWebSocket } from '../lib/api';
import type { VpnStatus, WgConfig } from '../lib/api';

type User = { username: string; email?: string };

// Module-level interval so it survives store re-renders
let liveIntervalId: ReturnType<typeof setInterval> | null = null;
const LIVE_INTERVAL_MS = 5000;

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

  // Actions
  fetchMe: () => Promise<void>;
  fetchStatus: () => Promise<void>;
  fetchConfigs: () => Promise<void>;
  fetchLogs: (lines?: number) => Promise<void>;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  switchConfig: (name: string) => Promise<void>;
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
    } else {
      get().fetchConfigs();
      // WS push will deliver updated status + logs within PUSH_INTERVAL_MS
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
        set({ logs: msg.payload });
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
