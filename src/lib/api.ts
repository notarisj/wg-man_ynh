// API client for the wg-man backend
// In production, requests go to the same origin (nginx proxies /api under the app base path)
// In development, set VITE_API_URL to http://localhost:3001

// import.meta.env.BASE_URL reflects the Vite `base` config (e.g. "/wg-man/" when installed at sub-path)
const BASE_URL = import.meta.env.VITE_API_URL ?? import.meta.env.BASE_URL.replace(/\/$/, '');

export const getLogoutUrl  = () => `${BASE_URL}/api/auth/logout`;
export const getDexLoginUrl = () => `${BASE_URL}/api/auth/login`;
export const getSsoLoginUrl = () => '/yunohost/sso/';

export type VpnStatus = {
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
};

export type WgConfig = {
  name: string;
  filename: string;
  isActive: boolean;
  address: string | null;
  endpoint: string | null;
  comment: string | null;
  missingDns: boolean;
  /** WG-B: true when AllowedIPs routes all IPv4 but not IPv6 — potential traffic leak */
  ipv6LeakRisk: boolean;
};

export type SystemMetrics = {
  cpuPercent: number;
  ramPercent: number;
  ramUsedMb: number;
  ramTotalMb: number;
};

export type VpnHistoryEvent = {
  ts: number;
  type: 'connected' | 'disconnected' | 'switched';
  config: string | null;
  endpoint: string | null;
};

export type CronStatus = {
  enabled:    boolean;
  schedule:   string | null;
  cronFile:   string;
  scriptPath: string;
  logFile:    string;
};

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

async function apiFetch<T>(
  path: string,
  options?: RequestInit
): Promise<ApiResult<T>> {
  try {
    const res = await fetch(`${BASE_URL}/api${path}`, {
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
      },
      ...options,
    });

    if (res.status === 403) {
      return { ok: false, error: 'Please log in via the YunoHost portal.' };
    }

    const data = await res.json();
    if (!res.ok) {
      return { ok: false, error: data.error ?? `HTTP ${res.status}` };
    }
    return { ok: true, data };
  } catch (err: any) {
    return { ok: false, error: err.message ?? 'Network error' };
  }
}

export type PasskeyStatus = {
  registered: boolean;
  registrationLocked: boolean;
  credentials: { id: string; registeredAt: number }[];
  storeFile: string;
};

export const api = {
  me: () => apiFetch<{ user: { username: string; email?: string } }>('/me'),
  authConfig: () => apiFetch<{ dexEnabled: boolean }>('/auth/config'),
  status: () => apiFetch<VpnStatus>('/status'),
  configs: () => apiFetch<WgConfig[]>('/configs'),
  logs: (lines = 100) => apiFetch<string[]>(`/logs?lines=${lines}`),
  searchLogs: (q: string) => apiFetch<string[]>(`/logs/search?q=${encodeURIComponent(q)}`),
  history: (limit = 500) => apiFetch<VpnHistoryEvent[]>(`/history?limit=${limit}`),
  connect: () => apiFetch<{ success: boolean; output: string }>('/connect', { method: 'POST' }),
  disconnect: () => apiFetch<{ success: boolean; message: string }>('/disconnect', { method: 'POST' }),
  switchConfig: (name: string) =>
    apiFetch<{ success: boolean; message: string }>(`/switch/${encodeURIComponent(name)}`, { method: 'POST' }),
  cron: {
    get:     ()               => apiFetch<CronStatus>('/cron'),
    set:     (schedule: string) => apiFetch<{ ok: boolean }>('/cron', { method: 'POST', body: JSON.stringify({ schedule }) }),
    disable: ()               => apiFetch<{ ok: boolean }>('/cron', { method: 'DELETE' }),
  },
  passkey: {
    status:         () => apiFetch<PasskeyStatus>('/passkey/status'),
    registerStart:  () => apiFetch<any>('/passkey/register/start', { method: 'POST' }),
    registerFinish: (body: any) => apiFetch<{ ok: boolean }>('/passkey/register/finish', { method: 'POST', body: JSON.stringify(body) }),
    assertStart:       () => apiFetch<any>('/passkey/assert/start', { method: 'POST' }),
    assertFinish:      (body: any) => apiFetch<{ ok: boolean }>('/passkey/assert/finish', { method: 'POST', body: JSON.stringify(body) }),
    lockRegistration:  () => apiFetch<{ ok: boolean }>('/passkey/lock-registration', { method: 'POST' }),
    reset:             () => apiFetch<{ ok: boolean }>('/passkey/reset', { method: 'DELETE' }),
  },
  configContent: (name: string) => apiFetch<{ content: string }>(`/configs/${encodeURIComponent(name)}/content`),
  createConfig:  (name: string, content: string) => apiFetch<{ ok: boolean; message: string }>('/configs', { method: 'POST', body: JSON.stringify({ name, content }) }),
  updateConfig:  (name: string, content: string) => apiFetch<{ ok: boolean; message: string }>(`/configs/${encodeURIComponent(name)}`, { method: 'PUT', body: JSON.stringify({ content }) }),
  deleteConfig:  (name: string) => apiFetch<{ ok: boolean; message: string }>(`/configs/${encodeURIComponent(name)}`, { method: 'DELETE' }),
};

// ── WebSocket Manager ───────────────────────────────────────

type WsMessage =
  | { type: 'status'; payload: VpnStatus;     ts: number }
  | { type: 'logs';   payload: string[];       ts: number }
  | { type: 'system'; payload: SystemMetrics; ts: number }
  | { type: 'error';  payload: { message: string }; ts: number }
  | { type: 'pong' };

type WsCallback = (msg: WsMessage) => void;

const WS_RECONNECT_BASE_MS  = 1_000;  // initial delay
const WS_RECONNECT_MAX_MS   = 30_000; // cap
const WS_RECONNECT_FACTOR   = 2;      // exponential growth

export class VpnWebSocket {
  private ws: WebSocket | null = null;
  private callbacks: WsCallback[] = [];
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private shouldConnect = true;
  // FE-03: exponential backoff state
  private reconnectDelay = WS_RECONNECT_BASE_MS;

  get wsUrl(): string {
    const base = import.meta.env.VITE_WS_URL ?? '';
    if (base) return `${base}/ws`;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    // Use import.meta.env.BASE_URL so WebSocket path respects the app's install sub-path
    const appBase = import.meta.env.BASE_URL; // e.g. "/wg-man/" or "/"
    return `${protocol}//${window.location.host}${appBase}ws`;
  }

  connect(): void {
    if (!this.shouldConnect) return;
    try {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.onopen = () => {
        // FE-03: reset backoff on successful connection
        this.reconnectDelay = WS_RECONNECT_BASE_MS;
        this.pingInterval = setInterval(() => {
          if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: 'ping' }));
          }
        }, 30000);
      };
      this.ws.onmessage = (e) => {
        try {
          const msg: WsMessage = JSON.parse(e.data);
          this.callbacks.forEach((cb) => cb(msg));
        } catch { /* ignore */ }
      };
      this.ws.onclose = () => {
        this.clearPing();
        if (this.shouldConnect) {
          // FE-03: exponential backoff capped at WS_RECONNECT_MAX_MS
          this.reconnectTimeout = setTimeout(() => this.connect(), this.reconnectDelay);
          this.reconnectDelay = Math.min(this.reconnectDelay * WS_RECONNECT_FACTOR, WS_RECONNECT_MAX_MS);
        }
      };
      this.ws.onerror = () => this.ws?.close();
    } catch { /* ignore in dev without server */ }
  }

  disconnect(): void {
    this.shouldConnect = false;
    this.clearPing();
    if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
    this.ws?.close();
    this.ws = null;
  }

  subscribe(cb: WsCallback): () => void {
    this.callbacks.push(cb);
    return () => {
      this.callbacks = this.callbacks.filter((c) => c !== cb);
    };
  }

  private clearPing(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }
}
