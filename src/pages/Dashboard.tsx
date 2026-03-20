import React, { useEffect, useCallback } from 'react';
import {
  ShieldCheck, ShieldOff, Shield,
  Zap, ZapOff,
  Clock, Activity, Wifi, WifiOff,
  ArrowUpDown, Server, Eye,
} from 'lucide-react';
import { useVpnStore } from '../store/vpnStore';
import { GlassCard } from '../components/ui/GlassCard';
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

export const Dashboard: React.FC = () => {
  const {
    status, fetchStatus, fetchConfigs, fetchLogs,
    logs, connect, disconnect, isConnecting, isDisconnecting,
    startWebSocket, stopWebSocket,
  } = useVpnStore();

  useEffect(() => {
    fetchStatus();
    fetchConfigs();
    fetchLogs(10);
    startWebSocket();
    return () => stopWebSocket();
  }, []);

  const handleConnect = useCallback(() => connect(), [connect]);
  const handleDisconnect = useCallback(() => disconnect(), [disconnect]);

  const isLoading = isConnecting || isDisconnecting;
  const connected = status?.connected ?? false;

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
