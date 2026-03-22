import React, { useEffect, useCallback, useState } from 'react';
import {
  ShieldCheck, ShieldOff, Shield,
  Zap, ZapOff,
  Clock, Activity, Wifi, WifiOff,
  ArrowUpDown, Server, Eye, Cpu, MemoryStick, History,
} from 'lucide-react';
import { useVpnStore } from '../store/vpnStore';
import { GlassCard } from '../components/ui/GlassCard';
import { buildTimeline, calcUptime, UptimeBar, PERIOD_OPTIONS, getWindowMs, getSegments, periodStartLabel, periodMidLabel } from './History';
import type { Period } from './History';
import './History.css';
import type { SystemMetrics } from '../lib/api';
import './Dashboard.css';

function formatBytes(bytes: number | null): string {
  if (bytes === null || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function formatAge(seconds: number | null): string {
  if (seconds === null) return '—';
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m ago`;
}

function metricColor(pct: number): string {
  if (pct >= 85) return '#ef4444';
  if (pct >= 65) return 'var(--clr-amber)';
  return 'var(--clr-green)';
}

// ── Sparkline ─────────────────────────────────────────────────
const SparkLine: React.FC<{ data: number[]; gradId: string; color: string }> = ({ data, gradId, color }) => {
  if (data.length < 2) {
    return <div className="sparkline-empty">Waiting for data…</div>;
  }

  const W = 300; const H = 44; const PAD = 4;
  const pts = data.map((v, i): [number, number] => [
    PAD + (i / (data.length - 1)) * (W - PAD * 2),
    PAD + (1 - Math.max(0, Math.min(100, v)) / 100) * (H - PAD * 2),
  ]);
  const polyline = pts.map(([x, y]) => `${x},${y}`).join(' ');
  const fill = `${PAD},${H - PAD} ${polyline} ${W - PAD},${H - PAD}`;
  const [lx, ly] = pts[pts.length - 1];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="sparkline-svg">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.2" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={fill} fill={`url(#${gradId})`} />
      <polyline points={polyline} fill="none" stroke={color} strokeWidth="1.5"
        strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lx} cy={ly} r={2.5} fill={color} />
    </svg>
  );
};

// ── Resource Graph Card ────────────────────────────────────────
const ResourceGraph: React.FC<{
  label: string;
  icon: React.ReactNode;
  value: number | null;
  history: number[];
  gradId: string;
  detail?: string | null;
}> = ({ label, icon, value, history, gradId, detail }) => {
  const color = value !== null ? metricColor(value) : 'var(--clr-text-dim)';
  return (
    <GlassCard className="dashboard__resource">
      <div className="dashboard__resource-header">
        <div className="dashboard__resource-left">
          {icon}
          <span className="dashboard__resource-label">{label}</span>
        </div>
        <div className="dashboard__resource-right">
          <span className="dashboard__resource-value" style={{ color }}>
            {value !== null ? `${value}%` : '—'}
          </span>
          {detail && <span className="dashboard__resource-detail">{detail}</span>}
        </div>
      </div>
      <SparkLine data={history} gradId={gradId} color={color} />
    </GlassCard>
  );
};

// ── Dashboard ──────────────────────────────────────────────────
export const Dashboard: React.FC = () => {
  const {
    status, fetchStatus, fetchConfigs, fetchLogs,
    logs, connect, disconnect, isConnecting, isDisconnecting,
    systemMetrics, systemHistory, vpnHistory, fetchHistory,
  } = useVpnStore();

  useEffect(() => {
    fetchStatus();
    fetchConfigs();
    fetchLogs(10);
    fetchHistory();
  }, []);

  const handleConnect = useCallback(() => connect(), [connect]);
  const handleDisconnect = useCallback(() => disconnect(), [disconnect]);

  const [period, setPeriod] = useState<Period>('24h');

  const isLoading = isConnecting || isDisconnecting;
  const connected = status?.connected ?? false;
  const sm: SystemMetrics | null = systemMetrics;

  return (
    <div className="dashboard animate-fade-in">

      {/* ── Hero Status Card ──────────────────────────────── */}
      <GlassCard className={`dashboard__hero ${connected ? 'dashboard__hero--connected' : 'dashboard__hero--off'}`}>
        <div className="dashboard__hero-glow" />
        <div className="dashboard__hero-content">
          <div className="dashboard__hero-left">
            <div className={`dashboard__status-icon-wrap ${connected ? 'connected' : 'off'}`}>
              {status === null
                ? <Shield size={52} />
                : connected
                ? <ShieldCheck size={52} />
                : <ShieldOff size={52} />}
              {connected && <span className="dashboard__hero-pulse" />}
            </div>
            <div>
              <div className={`dashboard__hero-label ${connected ? 'connected' : 'off'}`}>
                {status === null ? 'Loading...' : connected ? 'VPN Connected' : 'VPN Disconnected'}
              </div>
              <div className="dashboard__hero-config">
                {status?.currentConfig ?? (status === null ? '—' : 'No active config')}
              </div>
              {status?.endpoint && (
                <div className="dashboard__hero-endpoint">
                  <Server size={12} /> {status.endpoint}
                </div>
              )}
            </div>
          </div>
          <div className="dashboard__hero-actions">
            <button
              id="btn-connect"
              className="btn btn-primary btn-lg"
              onClick={handleConnect}
              disabled={isLoading}
            >
              {isConnecting ? <span className="spinner" /> : <Zap size={18} />}
              {isConnecting ? 'Connecting...' : 'Auto-Connect'}
            </button>
            <button
              id="btn-disconnect"
              className="btn btn-danger btn-lg"
              onClick={handleDisconnect}
              disabled={isLoading || !connected}
            >
              {isDisconnecting ? <span className="spinner" /> : <ZapOff size={18} />}
              {isDisconnecting ? 'Stopping...' : 'Disconnect'}
            </button>
          </div>
        </div>
      </GlassCard>

      {/* ── Stats Grid ───────────────────────────────────── */}
      <div className="dashboard__stats">
        <GlassCard className="dashboard__stat">
          <div className="dashboard__stat-icon" style={{ color: 'var(--clr-teal)' }}>
            <Clock size={20} />
          </div>
          <div>
            <div className="dashboard__stat-label">Last Handshake</div>
            <div className="dashboard__stat-value">
              {formatAge(status?.handshakeAge ?? null)}
            </div>
          </div>
        </GlassCard>

        <GlassCard className="dashboard__stat">
          <div className="dashboard__stat-icon" style={{ color: status?.pingOk ? 'var(--clr-green)' : 'var(--clr-red)' }}>
            {status?.pingOk ? <Wifi size={20} /> : <WifiOff size={20} />}
          </div>
          <div>
            <div className="dashboard__stat-label">Ping (1.1.1.1)</div>
            <div className="dashboard__stat-value" style={{ color: status?.pingOk ? 'var(--clr-green)' : 'var(--clr-red)' }}>
              {status === null ? '—' : status.pingOk ? 'Reachable' : 'Unreachable'}
            </div>
          </div>
        </GlassCard>

        <GlassCard className="dashboard__stat">
          <div className="dashboard__stat-icon" style={{ color: 'var(--clr-blue)' }}>
            <ArrowUpDown size={20} />
          </div>
          <div>
            <div className="dashboard__stat-label">Traffic</div>
            <div className="dashboard__stat-value">
              <span style={{ color: 'var(--clr-green)' }}>↑ {formatBytes(status?.txBytes ?? null)}</span>
              {' / '}
              <span style={{ color: 'var(--clr-blue)' }}>↓ {formatBytes(status?.rxBytes ?? null)}</span>
            </div>
          </div>
        </GlassCard>

        <GlassCard className="dashboard__stat">
          <div className="dashboard__stat-icon" style={{ color: 'var(--clr-amber)' }}>
            <Activity size={20} />
          </div>
          <div>
            <div className="dashboard__stat-label">Interface</div>
            <div className="dashboard__stat-value">
              {status?.interface ?? '—'}
            </div>
          </div>
        </GlassCard>
      </div>

      {/* ── Server Resources ─────────────────────────────── */}
      <div className="dashboard__resources">
        <ResourceGraph
          label="CPU"
          icon={<Cpu size={13} />}
          value={sm?.cpuPercent ?? null}
          history={systemHistory.map(s => s.cpuPercent)}
          gradId="grad-cpu"
        />
        <ResourceGraph
          label="RAM"
          icon={<MemoryStick size={13} />}
          value={sm?.ramPercent ?? null}
          history={systemHistory.map(s => s.ramPercent)}
          gradId="grad-ram"
          detail={sm ? `${sm.ramUsedMb} / ${sm.ramTotalMb} MB` : null}
        />
      </div>

      {/* ── Connection Uptime ────────────────────────────── */}
      {(() => {
        const windowMs = getWindowMs(period, vpnHistory);
        const segments = getSegments(period);
        const timeline = buildTimeline(vpnHistory, windowMs, segments);
        const uptime   = calcUptime(timeline);
        return (
          <GlassCard className="dashboard__uptime">
            <div className="history-timeline-header">
              <span className="history-timeline-title">
                <History size={14} /> Connection Uptime
                {uptime !== null && (
                  <span style={{ marginLeft: 10, fontWeight: 700, color: uptime >= 80 ? 'var(--clr-green)' : 'var(--clr-amber)', fontSize: 13 }}>
                    {uptime}%
                  </span>
                )}
              </span>
              <div className="history-period-tabs">
                {PERIOD_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    className={`history-period-tab${period === opt.value ? ' active' : ''}`}
                    onClick={() => setPeriod(opt.value)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <div className="history-timeline-legend">
                <span className="legend-dot legend-dot--connected" /> Connected
                <span className="legend-dot legend-dot--disconnected" /> Disconnected
                <span className="legend-dot legend-dot--unknown" /> No data
              </div>
            </div>
            <UptimeBar timeline={timeline} events={vpnHistory} windowMs={windowMs} segments={segments} />
            <div className="history-timeline-labels">
              <span>{periodStartLabel(period, vpnHistory)}</span>
              <span>{periodMidLabel(period, vpnHistory)}</span>
              <span>Now</span>
            </div>
          </GlassCard>
        );
      })()}

      {/* ── Bottom Row ───────────────────────────────────── */}
      <div className="dashboard__bottom">
        {/* Connection Details */}
        <GlassCard className="dashboard__details">
          <div className="dashboard__section-title">
            <Eye size={16} /> Connection Details
          </div>
          <div className="dashboard__details-grid">
            <div className="dashboard__detail-row">
              <span className="dashboard__detail-label">Config</span>
              <span className="dashboard__detail-val">{status?.currentConfig ?? '—'}</span>
            </div>
            <div className="dashboard__detail-row">
              <span className="dashboard__detail-label">Endpoint</span>
              <span className="dashboard__detail-val mono">{status?.endpoint ?? '—'}</span>
            </div>
            <div className="dashboard__detail-row">
              <span className="dashboard__detail-label">Allowed IPs</span>
              <span className="dashboard__detail-val mono">{status?.allowedIps ?? '—'}</span>
            </div>
            <div className="dashboard__detail-row">
              <span className="dashboard__detail-label">Listen Port</span>
              <span className="dashboard__detail-val mono">{status?.listenPort ?? '—'}</span>
            </div>
            <div className="dashboard__detail-row">
              <span className="dashboard__detail-label">Public Key</span>
              <span className="dashboard__detail-val mono truncate">
                {status?.publicKey ? `${status.publicKey.slice(0, 20)}…` : '—'}
              </span>
            </div>
          </div>
        </GlassCard>

        {/* Recent Logs */}
        <GlassCard className="dashboard__log-preview">
          <div className="dashboard__section-title">
            <Activity size={16} /> Recent Activity
          </div>
          {logs.length === 0 ? (
            <div className="dashboard__log-empty">No log entries yet</div>
          ) : (
            <div className="dashboard__log-list">
              {logs.slice(0, 8).map((line, i) => (
                <div key={i} className={`dashboard__log-line ${getLogClass(line)}`}>
                  {line}
                </div>
              ))}
            </div>
          )}
        </GlassCard>
      </div>
    </div>
  );
};

function getLogClass(line: string): string {
  if (line.includes('SUCCESS') || line.includes('is now active')) return 'log--success';
  if (line.includes('FAILED') || line.includes('CRITICAL')) return 'log--error';
  if (line.includes('ACTION') || line.includes('TRIGGER')) return 'log--warn';
  return 'log--muted';
}
