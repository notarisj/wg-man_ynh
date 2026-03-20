// API client for the wg-man backend
// In production, requests go to the same origin (nginx proxies /api under the app base path)
// In development, set VITE_API_URL to http://localhost:3001

// import.meta.env.BASE_URL reflects the Vite `base` config (e.g. "/wg-man/" when installed at sub-path)
const BASE_URL = import.meta.env.VITE_API_URL ?? import.meta.env.BASE_URL.replace(/\/$/, '');

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
      headers: { 'Content-Type': 'application/json' },
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

export const api = {
  me: () => apiFetch<{ user: { username: string; email?: string } }>('/me'),
  status: () => apiFetch<VpnStatus>('/status'),
  configs: () => apiFetch<WgConfig[]>('/configs'),
  logs: (lines = 100) => apiFetch<string[]>(`/logs?lines=${lines}`),
  connect: () => apiFetch<{ success: boolean; output: string }>('/connect', { method: 'POST' }),
  disconnect: () => apiFetch<{ success: boolean; message: string }>('/disconnect', { method: 'POST' }),
  switchConfig: (name: string) =>
    apiFetch<{ success: boolean; message: string }>(`/switch/${encodeURIComponent(name)}`, { method: 'POST' }),
};

// ── WebSocket Manager ───────────────────────────────────────

type WsMessage =
  | { type: 'status'; payload: VpnStatus; ts: number }
  | { type: 'error';  payload: { message: string }; ts: number }
  | { type: 'pong' };

type WsCallback = (msg: WsMessage) => void;

export class VpnWebSocket {
  private ws: WebSocket | null = null;
  private callbacks: WsCallback[] = [];
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private shouldConnect = true;

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
          this.reconnectTimeout = setTimeout(() => this.connect(), 3000);
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
