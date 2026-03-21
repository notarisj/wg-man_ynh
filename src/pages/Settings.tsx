import React, { useEffect, useState, useCallback } from 'react';
import {
  UserCircle, Info, ExternalLink, Shield,
  Clock, Server, Tag, GitBranch,
  KeyRound, Lock, Terminal, Copy, Check, AlertCircle, Trash2,
} from 'lucide-react';
import { useVpnStore } from '../store/vpnStore';
import { GlassCard } from '../components/ui/GlassCard';
import { CronScheduler } from '../components/ui/CronScheduler';
import { PasskeyPrompt } from '../components/ui/PasskeyPrompt';
import { api } from '../lib/api';
import type { PasskeyStatus } from '../lib/api';
import './Settings.css';

export const Settings: React.FC = () => {
  const { user, fetchMe, status } = useVpnStore();

  // ── Passkey management ───────────────────────────────────────
  const [passkeyStatus, setPasskeyStatus]   = useState<PasskeyStatus | null>(null);
  const [showPasskeyFor, setShowPasskeyFor] = useState<'lock' | 'reset' | null>(null);
  const [isLocking, setIsLocking]           = useState(false);
  const [isResetting, setIsResetting]       = useState(false);
  const [pkError, setPkError]               = useState<string | null>(null);
  const [cmdCopied, setCmdCopied]           = useState(false);
  const [rpCmdCopied, setRpCmdCopied]       = useState(false);

  // Domain setup
  const [domainRpID, setDomainRpID]         = useState(() => typeof window !== 'undefined' ? window.location.hostname : '');
  const [domainOrigin, setDomainOrigin]     = useState(() => typeof window !== 'undefined' ? window.location.origin : '');
  const [domainError, setDomainError]       = useState<string | null>(null);
  const [isSavingDomain, setIsSavingDomain] = useState(false);

  const refreshPasskey = useCallback(() => {
    api.passkey.status().then((res) => { if (res.ok) setPasskeyStatus(res.data); });
  }, []);

  useEffect(() => {
    fetchMe();
    refreshPasskey();
  }, []);

  const onPasskeySuccess = useCallback(() => {
    const action = showPasskeyFor;
    setShowPasskeyFor(null);
    setPkError(null);
    if (action === 'lock') {
      setIsLocking(true);
      api.passkey.lockRegistration().then((res) => {
        setIsLocking(false);
        if (!res.ok) setPkError(res.error);
        else refreshPasskey();
      });
    } else if (action === 'reset') {
      setIsResetting(true);
      api.passkey.reset().then((res) => {
        setIsResetting(false);
        if (!res.ok) setPkError(res.error);
        else refreshPasskey();
      });
    }
  }, [showPasskeyFor, refreshPasskey]);

  const handleSaveDomain = useCallback(async () => {
    setDomainError(null);
    setIsSavingDomain(true);
    const res = await api.passkey.setupDomain(domainRpID.trim(), domainOrigin.trim());
    setIsSavingDomain(false);
    if (!res.ok) { setDomainError(res.error); return; }
    refreshPasskey();
  }, [domainRpID, domainOrigin, refreshPasskey]);

  // ── Render ───────────────────────────────────────────────────
  return (
    <div className="settings-page animate-fade-in">

      {/* Passkey Security */}
      <GlassCard className="settings-card settings-card--passkey">
        <div className="settings-card__title">
          <KeyRound size={16} />
          Passkey Security
        </div>

        {passkeyStatus ? (
          <>
            {/* Status row */}
            <div className="settings-row">
              <span className="settings-label">Status</span>
              <span className={`settings-value--badge ${
                passkeyStatus.registrationLocked ? 'settings-badge--amber' :
                passkeyStatus.registered ? 'settings-badge--green' : 'settings-badge--warn'
              }`}>
                {passkeyStatus.registrationLocked ? 'Registration Locked' :
                 passkeyStatus.registered ? 'Active' : 'No Passkey'}
              </span>
            </div>

            {/* Credentials */}
            {passkeyStatus.credentials.length > 0 && (
              <div className="settings-row">
                <span className="settings-label">Registered Keys</span>
                <span className="settings-value">{passkeyStatus.credentials.length}</span>
              </div>
            )}

            {pkError && (
              <div className="settings-passkey-error">
                <AlertCircle size={13} /> {pkError}
              </div>
            )}

            {/* Registration lock controls */}
            {passkeyStatus.registered && !passkeyStatus.registrationLocked && (
              <button
                className="settings-passkey-btn settings-passkey-btn--amber"
                onClick={() => { setPkError(null); setShowPasskeyFor('lock'); }}
                disabled={isLocking}
              >
                {isLocking ? <span className="spinner spinner-sm" /> : <Lock size={13} />}
                Lock Registration
              </button>
            )}

            {passkeyStatus.registrationLocked && (
              <div className="settings-passkey-locked">
                <div className="settings-passkey-locked__desc">
                  <Lock size={13} /> New passkey registration is <strong>disabled</strong>. To re-enable via SSH:
                </div>
                <div className="passkey-panel__ssh-block">
                  <Terminal size={12} />
                  <code className="passkey-panel__ssh-cmd">
                    {`sudo jq '.registrationLocked = false' ${passkeyStatus.storeFile} > /tmp/pk.json && sudo mv /tmp/pk.json ${passkeyStatus.storeFile} && sudo systemctl restart wg-man`}
                  </code>
                  <button
                    className="passkey-panel__copy-btn"
                    title="Copy command"
                    onClick={() => {
                      navigator.clipboard.writeText(`sudo jq '.registrationLocked = false' ${passkeyStatus.storeFile} > /tmp/pk.json && sudo mv /tmp/pk.json ${passkeyStatus.storeFile} && sudo systemctl restart wg-man`);
                      setCmdCopied(true);
                      setTimeout(() => setCmdCopied(false), 2000);
                    }}
                  >
                    {cmdCopied ? <Check size={12} /> : <Copy size={12} />}
                  </button>
                </div>
              </div>
            )}

            {/* Domain config */}
            <div className="settings-passkey-domain">
              <div className="settings-passkey-domain__label">WebAuthn Domain</div>
              {passkeyStatus.rpConfig ? (
                <>
                  <div className="settings-row" style={{ borderBottom: 'none', padding: '4px 0' }}>
                    <span className="settings-label">RP ID</span>
                    <span className="settings-value mono">{passkeyStatus.rpConfig.rpID}</span>
                  </div>
                  <div className="settings-row" style={{ padding: '4px 0' }}>
                    <span className="settings-label">Origin</span>
                    <span className="settings-value mono">{passkeyStatus.rpConfig.origin}</span>
                  </div>
                  <div className="passkey-panel__ssh-note">
                    To change, remove via SSH then restart:
                  </div>
                  <div className="passkey-panel__ssh-block">
                    <Terminal size={12} />
                    <code className="passkey-panel__ssh-cmd">
                      {`sudo jq 'del(.rpConfig)' ${passkeyStatus.storeFile} > /tmp/pk.json && sudo mv /tmp/pk.json ${passkeyStatus.storeFile} && sudo systemctl restart wg-man`}
                    </code>
                    <button
                      className="passkey-panel__copy-btn"
                      title="Copy command"
                      onClick={() => {
                        navigator.clipboard.writeText(`sudo jq 'del(.rpConfig)' ${passkeyStatus.storeFile} > /tmp/pk.json && sudo mv /tmp/pk.json ${passkeyStatus.storeFile} && sudo systemctl restart wg-man`);
                        setRpCmdCopied(true);
                        setTimeout(() => setRpCmdCopied(false), 2000);
                      }}
                    >
                      {rpCmdCopied ? <Check size={12} /> : <Copy size={12} />}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="passkey-panel__ssh-note" style={{ marginBottom: 8 }}>
                    Lock in your domain so passkeys are always bound to it. Pre-filled from your current browser URL.
                  </div>
                  <div className="passkey-panel__domain-fields">
                    <div className="passkey-panel__domain-field">
                      <label className="passkey-panel__domain-label">RP ID (hostname)</label>
                      <input
                        className="passkey-panel__domain-input"
                        value={domainRpID}
                        onChange={(e) => setDomainRpID(e.target.value)}
                        placeholder="example.com"
                        spellCheck={false}
                      />
                    </div>
                    <div className="passkey-panel__domain-field">
                      <label className="passkey-panel__domain-label">Origin (full URL)</label>
                      <input
                        className="passkey-panel__domain-input"
                        value={domainOrigin}
                        onChange={(e) => setDomainOrigin(e.target.value)}
                        placeholder="https://example.com"
                        spellCheck={false}
                      />
                    </div>
                  </div>
                  {domainError && (
                    <div className="settings-passkey-error" style={{ marginTop: 4 }}>
                      <AlertCircle size={12} /> {domainError}
                    </div>
                  )}
                  <button
                    className="settings-passkey-btn settings-passkey-btn--green"
                    onClick={handleSaveDomain}
                    disabled={isSavingDomain || !domainRpID.trim() || !domainOrigin.trim()}
                    style={{ marginTop: 6 }}
                  >
                    {isSavingDomain ? <span className="spinner spinner-sm" /> : <Lock size={13} />}
                    Lock Domain
                  </button>
                </>
              )}
            </div>

            {/* Credential list */}
            {passkeyStatus.credentials.length > 0 && (
              <div className="settings-passkey-creds">
                <div className="settings-passkey-creds__label">Registered Keys</div>
                {passkeyStatus.credentials.map((c) => (
                  <div key={c.id} className="settings-passkey-cred">
                    <KeyRound size={11} />
                    <span className="settings-passkey-cred__id">{c.id.slice(0, 24)}…</span>
                    <span className="settings-passkey-cred__date">
                      {new Date(c.registeredAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Reset — dangerous */}
            {passkeyStatus.registered && (
              <button
                className="settings-passkey-btn settings-passkey-btn--danger"
                onClick={() => { setPkError(null); setShowPasskeyFor('reset'); }}
                disabled={isResetting}
                title="Delete all passkeys — you will be locked out until a new one is registered"
              >
                {isResetting ? <span className="spinner spinner-sm" /> : <Trash2 size={13} />}
                Reset All Passkeys
              </button>
            )}
          </>
        ) : (
          <div className="settings-passkey-loading">
            <span className="spinner spinner-sm" /> Loading…
          </div>
        )}
      </GlassCard>

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

      {/* Passkey prompt modal for lock/reset actions */}
      {showPasskeyFor && (
        <PasskeyPrompt
          mode="authenticate"
          onSuccess={onPasskeySuccess}
          onCancel={() => setShowPasskeyFor(null)}
        />
      )}
    </div>
  );
};
