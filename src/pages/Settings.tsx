import React, { useEffect } from 'react';
import {
  UserCircle, Info, ExternalLink, Shield,
  Clock, Server, Tag, GitBranch,
} from 'lucide-react';
import { useVpnStore } from '../store/vpnStore';
import { GlassCard } from '../components/ui/GlassCard';
import { CronScheduler } from '../components/ui/CronScheduler';
import './Settings.css';

export const Settings: React.FC = () => {
  const { user, fetchMe, status } = useVpnStore();

  useEffect(() => { fetchMe(); }, []);

  return (
    <div className="settings-page animate-fade-in">
      {/* User Info */}
      <GlassCard className="settings-card">
        <div className="settings-card__title">
          <UserCircle size={16} /> YunoHost Account
        </div>
        <div className="settings-row">
          <span className="settings-label">Username</span>
          <span className="settings-value">{user?.username ?? '—'}</span>
        </div>
        <div className="settings-row">
          <span className="settings-label">Email</span>
          <span className="settings-value">{user?.email ?? '—'}</span>
        </div>
        <div className="settings-row">
          <span className="settings-label">Auth Method</span>
          <span className="settings-value settings-value--badge">SSOwat SSO</span>
        </div>
        <a
          href="/yunohost/admin"
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-ghost btn-sm settings-card__link"
        >
          <ExternalLink size={13} /> YunoHost Admin Panel
        </a>
      </GlassCard>

      {/* VPN Config */}
      <GlassCard className="settings-card">
        <div className="settings-card__title">
          <Shield size={16} /> WireGuard Configuration
        </div>
        <div className="settings-row">
          <span className="settings-label">Interface</span>
          <span className="settings-value mono">{status?.interface ?? 'wg-vpn'}</span>
        </div>
        <div className="settings-row">
          <span className="settings-label">Config Directory</span>
          <span className="settings-value mono">/etc/wireguard/</span>
        </div>
        <div className="settings-row">
          <span className="settings-label">Config Pattern</span>
          <span className="settings-value mono">nl-ams-wg-*.conf</span>
        </div>
        <div className="settings-row">
          <span className="settings-label">State File</span>
          <span className="settings-value mono">/var/lib/vpn-monitor.current</span>
        </div>
        <div className="settings-row">
          <span className="settings-label">Log File</span>
          <span className="settings-value mono">/var/log/vpn-monitor.log</span>
        </div>
      </GlassCard>

      {/* Monitor Script */}
      <GlassCard className="settings-card">
        <div className="settings-card__title">
          <Clock size={16} /> Monitor Script
        </div>
        <div className="settings-row">
          <span className="settings-label">Script Path</span>
          <span className="settings-value mono">/home/notaris/scripts/vpn-monitor.sh</span>
        </div>
        <div className="settings-row">
          <span className="settings-label">Ping Check</span>
          <span className="settings-value mono">1.1.1.1</span>
        </div>
        <div className="settings-row">
          <span className="settings-label">Max Handshake Age</span>
          <span className="settings-value mono">120s</span>
        </div>
        <div className="settings-row">
          <span className="settings-label">WS Push Interval</span>
          <span className="settings-value mono">5s</span>
        </div>
        <div className="settings-info">
          <Info size={13} />
          The vpn-monitor.sh script runs via cron for automatic failover. The web app
          also lets you trigger it on-demand from the Dashboard.
        </div>
      </GlassCard>

      {/* Cron scheduler */}
      <CronScheduler />

      {/* API Info */}
      <GlassCard className="settings-card">
        <div className="settings-card__title">
          <Server size={16} /> API Server
        </div>
        <div className="settings-row">
          <span className="settings-label">Listen Address</span>
          <span className="settings-value mono">127.0.0.1:3001</span>
        </div>
        <div className="settings-row">
          <span className="settings-label">WebSocket</span>
          <span className="settings-value mono">ws://…/ws</span>
        </div>
        <div className="settings-row">
          <span className="settings-label">Auth</span>
          <span className="settings-value mono">YNH_USER header (nginx)</span>
        </div>
      </GlassCard>

      {/* About */}
      <GlassCard className="settings-card">
        <div className="settings-card__title">
          <Tag size={16} /> About
        </div>
        <div className="settings-row">
          <span className="settings-label">Version</span>
          <span className="settings-value mono">v{__APP_VERSION__}</span>
        </div>
        <div className="settings-row">
          <span className="settings-label">License</span>
          <span className="settings-value">MIT</span>
        </div>
        <div className="settings-row">
          <span className="settings-label">Source</span>
          <a
            className="settings-value settings-github-link"
            href="https://github.com/notarisj/wg-man_ynh"
            target="_blank"
            rel="noopener noreferrer"
          >
            <GitBranch size={14} />
            notarisj/wg-man_ynh
            <ExternalLink size={12} className="settings-github-link__ext" />
          </a>
        </div>
      </GlassCard>
    </div>
  );
};
