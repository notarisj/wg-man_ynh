import React, { useEffect, useCallback, useState } from 'react';
import {
  ShieldCheck, ShieldOff, Shield,
  Zap, ZapOff,
  Clock, Activity, Wifi, WifiOff,
  ArrowUpDown, Server, Eye, History, Cpu, MemoryStick,
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

// ── Spark Bars ─────────────────────────────────────────────────
const SparkBars: React.FC<{ data: number[]; color: string }> = ({ data, color }) => {
  const bars = data.slice(-24);
  if (bars.length === 0) return <div className="sparkbars-empty" />;
  const H = 48; const barW = 5; const gap = 2;
  const w = bars.length * (barW + gap) - gap;
  return (
    <svg width={w} height={H} className="sparkbars-svg">
      {bars.map((v, i) => {
        const h = Math.max(2, (Math.min(100, v) / 100) * H);
        const opacity = 0.3 + 0.7 * ((i + 1) / bars.length);
        return (
          <rect key={i} x={i * (barW + gap)} y={H - h} width={barW} height={h} rx={1.5}
            fill={color} opacity={opacity} />
        );
      })}
    </svg>
  );
};

function formatMb(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`;
}

// ── Resource Graph Card ────────────────────────────────────────
const ResourceGraph: React.FC<{
  label: string;
  icon: React.ReactNode;
  subLabel?: string | null;
  displayValue: string;
  avgLabel: string;
  pkLabel: string;
  pctHistory: number[];
  color: string;
}> = ({ label, icon, subLabel, displayValue, avgLabel, pkLabel, pctHistory, color }) => (
  <GlassCard className="dashboard__resource">
    <div className="dashboard__resource-top">
      <span className="dashboard__resource-label">{icon}{label}</span>
      {subLabel && <span className="dashboard__resource-sublabel">{subLabel}</span>}
    </div>
    <div className="dashboard__resource-body">
      <div className="dashboard__resource-left">
        <span className="dashboard__resource-bigval" style={{ color }}>{displayValue}</span>
        <span className="dashboard__resource-avgpk">avg {avgLabel} · pk {pkLabel}</span>
      </div>
      <SparkBars data={pctHistory} color={color} />
    </div>
  </GlassCard>
);

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

  // Dev-only: simulate system metrics so the graphs are visible without a backend
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    let cpu = 5; let cpuDir = 1;
    const RAM_TOTAL = 7669;
    let ramUsed = 800;
    const tick = () => {
      cpu += (Math.random() - 0.45) * 4 * cpuDir;
      if (cpu > 65) cpuDir = -1;
      if (cpu < 1)  cpuDir =  1;
      cpu = Math.max(0.1, Math.min(100, cpu));
      ramUsed += (Math.random() - 0.48) * 30;
      ramUsed = Math.max(400, Math.min(RAM_TOTAL * 0.95, ramUsed));
      const m = { cpuPercent: parseFloat(cpu.toFixed(1)), ramPercent: Math.round(ramUsed / RAM_TOTAL * 100), ramUsedMb: Math.round(ramUsed), ramTotalMb: RAM_TOTAL };
      useVpnStore.setState(s => ({ systemMetrics: m, systemHistory: [...s.systemHistory, m].slice(-40) }));
    };
    tick(); // immediate first sample
    const id = setInterval(tick, 2000);
    return () => clearInterval(id);
  }, []);

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
      {(() => {
        const cpuHist = systemHistory.map(s => s.cpuPercent);
        const cpuAvg  = cpuHist.length ? cpuHist.reduce((a, b) => a + b, 0) / cpuHist.length : null;
        const cpuPk   = cpuHist.length ? Math.max(...cpuHist) : null;
        const cpuColor = sm ? metricColor(sm.cpuPercent) : 'var(--clr-green)';

        const ramHist   = systemHistory.map(s => s.ramPercent);
        const ramMbHist = systemHistory.map(s => s.ramUsedMb);
        const ramAvg    = ramMbHist.length ? ramMbHist.reduce((a, b) => a + b, 0) / ramMbHist.length : null;
        const ramPk     = ramMbHist.length ? Math.max(...ramMbHist) : null;
        const ramColor  = sm ? metricColor(sm.ramPercent) : 'var(--clr-amber)';

        return (
          <div className="dashboard__resources">
            <ResourceGraph
              label="CPU"
              icon={<Cpu size={13} />}
              displayValue={sm ? `${sm.cpuPercent.toFixed(1)}%` : '—'}
              avgLabel={cpuAvg !== null ? `${cpuAvg.toFixed(1)}%` : '—'}
              pkLabel={cpuPk !== null ? `${cpuPk.toFixed(1)}%` : '—'}
              pctHistory={cpuHist}
              color={cpuColor}
            />
            <ResourceGraph
              label="RAM"
              icon={<MemoryStick size={13} />}
              subLabel={sm ? `${(sm.ramTotalMb / 1024).toFixed(1)} GB` : null}
              displayValue={sm ? formatMb(sm.ramUsedMb) : '—'}
              avgLabel={ramAvg !== null ? formatMb(Math.round(ramAvg)) : '—'}
              pkLabel={ramPk !== null ? formatMb(ramPk) : '—'}
              pctHistory={ramHist}
              color={ramColor}
            />
          </div>
        );
      })()}

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
