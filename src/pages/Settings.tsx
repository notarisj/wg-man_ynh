import React, { useEffect, useState, useCallback, useRef } from 'react';
import ReactDOM from 'react-dom';
import {
  UserCircle, ExternalLink, Shield,
  Clock, Server, Tag, GitBranch,
  KeyRound, Lock, Terminal, Copy, Check, AlertCircle, Trash2,
  FileCode, ChevronRight, X, Pencil, RotateCw,
} from 'lucide-react';
import { useVpnStore } from '../store/vpnStore';
import { GlassCard } from '../components/ui/GlassCard';
import { CronScheduler } from '../components/ui/CronScheduler';
import { PasskeyPrompt } from '../components/ui/PasskeyPrompt';
import { ScriptEditor } from '../components/ui/ScriptEditor';
import { api, healthz } from '../lib/api';
import { openModal, closeModal } from '../lib/modalManager';
import type { PasskeyStatus } from '../lib/api';
import './Settings.css';

export const Settings: React.FC = () => {
  const { user, fetchMe } = useVpnStore();

  // ── Modal visibility ──────────────────────────────────────
  const [showPasskeyModal, setShowPasskeyModal] = useState(false);
  const [showScriptModal, setShowScriptModal]   = useState(false);
  const overlayMouseDown = useRef(false);
  const [scriptPath, setScriptPath]             = useState('');

  // ── Blur main-content when any modal is open ──────────────
  useEffect(() => {
    if (showPasskeyModal || showScriptModal) { openModal(); return closeModal; }
  }, [showPasskeyModal, showScriptModal]);

  // ── Passkey management ────────────────────────────────────
  const [passkeyStatus, setPasskeyStatus]   = useState<PasskeyStatus | null>(null);
  const [showPasskeyFor, setShowPasskeyFor] = useState<'lock' | 'reset' | 'wg-edit' | null>(null);
  const [isLocking, setIsLocking]           = useState(false);
  const [isResetting, setIsResetting]       = useState(false);
  const [pkError, setPkError]               = useState<string | null>(null);
  const [cmdCopied, setCmdCopied]           = useState(false);
  const [rpCmdCopied, setRpCmdCopied]       = useState(false);

  const [domainRpID, setDomainRpID]         = useState(() => typeof window !== 'undefined' ? window.location.hostname : '');
  const [domainOrigin, setDomainOrigin]     = useState(() => typeof window !== 'undefined' ? window.location.origin : '');
  const [domainError, setDomainError]       = useState<string | null>(null);
  const [isSavingDomain, setIsSavingDomain] = useState(false);

  // ── WG server config ──────────────────────────────────────
  type WgConfig = { configDir: string; configPattern: string; staticInterface: string; checkIp: string; maxHandshakeAge: number; stateFile: string; logFile: string; monitorScript: string };
  const [wgConfig, setWgConfig]           = useState<WgConfig | null>(null);
  const [wgEditing, setWgEditing]         = useState(false);
  const [wgDraft, setWgDraft]             = useState<Partial<WgConfig>>({});
  const [wgSaving, setWgSaving]           = useState(false);
  const [wgError, setWgError]             = useState<string | null>(null);
  const [wgRestarting, setWgRestarting]   = useState(false);

  const refreshPasskey = useCallback(() => {
    api.passkey.status().then((res) => { if (res.ok) setPasskeyStatus(res.data); });
  }, []);

  useEffect(() => {
    fetchMe();
    refreshPasskey();
    api.serverConfig.get().then((res) => { if (res.ok) setWgConfig(res.data); });
  }, []);

  const startWgEdit = useCallback(() => {
    if (!wgConfig) return;
    setWgDraft({
      configDir:       wgConfig.configDir,
      configPattern:   wgConfig.configPattern,
      staticInterface: wgConfig.staticInterface,
      checkIp:         wgConfig.checkIp,
      maxHandshakeAge: wgConfig.maxHandshakeAge,
    });
    setWgError(null);
    setWgEditing(true);
  }, [wgConfig]);

  const saveWgConfig = useCallback(async () => {
    setWgSaving(true);
    setWgError(null);
    const res = await api.serverConfig.update(wgDraft);
    setWgSaving(false);
    if (!res.ok) { setWgError(res.error); return; }
    setWgEditing(false);
    if (res.data.restarting) {
      setWgRestarting(true);
    } else {
      api.serverConfig.get().then((r) => { if (r.ok) setWgConfig(r.data); });
    }
  }, [wgDraft]);

  // Poll /healthz until the server comes back after restart, then reload the page
  useEffect(() => {
    if (!wgRestarting) return;
    let cancelled = false;
    let attempts = 0;
    const poll = () => {
      if (cancelled) return;
      attempts++;
      if (attempts > 20) { setWgRestarting(false); return; } // give up after ~40s
      healthz().then((alive) => {
        if (cancelled) return;
        if (alive) {
          window.location.reload();
        } else {
          setTimeout(poll, 2000);
        }
      });
    };
    const t = setTimeout(poll, 2000); // wait 2s before first attempt
    return () => { cancelled = true; clearTimeout(t); };
  }, [wgRestarting]);

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
    } else if (action === 'wg-edit') {
      startWgEdit();
    }
  }, [showPasskeyFor, refreshPasskey, startWgEdit]);

  const handleSaveDomain = useCallback(async () => {
    setDomainError(null);
    setIsSavingDomain(true);
    const res = await api.passkey.setupDomain(domainRpID.trim(), domainOrigin.trim());
    setIsSavingDomain(false);
    if (!res.ok) { setDomainError(res.error); return; }
    refreshPasskey();
  }, [domainRpID, domainOrigin, refreshPasskey]);

  // ── Passkey status helpers ────────────────────────────────
  const pkBadge = passkeyStatus
    ? passkeyStatus.registrationLocked ? 'settings-badge--amber'
    : passkeyStatus.registered         ? 'settings-badge--green'
    :                                    'settings-badge--warn'
    : '';
  const pkBadgeText = passkeyStatus
    ? passkeyStatus.registrationLocked ? 'Locked'
    : passkeyStatus.registered         ? 'Active'
    :                                    'No Passkey'
    : '';

  // ── Render ───────────────────────────────────────────────
  return (
    <div className="settings-page animate-fade-in">

      {/* Passkey Security — compact tile */}
      <GlassCard className="settings-card">
        <div className="settings-card__title">
          <KeyRound size={16} /> Passkey Security
        </div>
        {passkeyStatus ? (
          <>
            <div className="settings-row">
              <span className="settings-label">Status</span>
              <span className={`settings-value--badge ${pkBadge}`}>{pkBadgeText}</span>
            </div>
            {passkeyStatus.credentials.length > 0 && (
              <div className="settings-row">
                <span className="settings-label">Registered Keys</span>
                <span className="settings-value">{passkeyStatus.credentials.length}</span>
              </div>
            )}
          </>
        ) : (
          <div className="settings-passkey-loading">
            <span className="spinner spinner-sm" /> Loading…
          </div>
        )}
        <button
          className="btn btn-ghost btn-sm settings-card__link"
          onClick={() => setShowPasskeyModal(true)}
        >
          Manage <ChevronRight size={13} />
        </button>
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
        <div className="settings-card__title" style={{ justifyContent: 'space-between' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Shield size={16} /> WireGuard Configuration</span>
          {!wgEditing && !wgRestarting && wgConfig && (
            <button className="btn btn-ghost btn-sm" onClick={() => { setPkError(null); setShowPasskeyFor('wg-edit'); }} style={{ padding: '2px 8px' }}>
              <Pencil size={13} /> Edit
            </button>
          )}
        </div>

        {wgRestarting ? (
          <div className="settings-passkey-loading">
            <RotateCw size={14} className="spinning" /> Applying changes and restarting service…
          </div>
        ) : wgEditing ? (
          <>
            {(['configDir', 'configPattern', 'staticInterface', 'checkIp'] as const).map((key) => {
              const labels: Record<string, string> = {
                configDir: 'Config Directory', configPattern: 'Config Pattern',
                staticInterface: 'Static Interface', checkIp: 'Ping Check IP',
              };
              return (
                <div key={key} className="settings-row" style={{ alignItems: 'center' }}>
                  <span className="settings-label">{labels[key]}</span>
                  <input
                    className="scripts-modal__name-input"
                    value={String(wgDraft[key] ?? '')}
                    onChange={(e) => setWgDraft((d) => ({ ...d, [key]: e.target.value }))}
                    spellCheck={false}
                  />
                </div>
              );
            })}
            <div className="settings-row" style={{ alignItems: 'center' }}>
              <span className="settings-label">Handshake Age (s)</span>
              <input
                className="scripts-modal__name-input"
                type="number" min={30} max={600}
                value={wgDraft.maxHandshakeAge ?? 150}
                onChange={(e) => setWgDraft((d) => ({ ...d, maxHandshakeAge: parseInt(e.target.value, 10) }))}
              />
            </div>
            {wgError && (
              <div className="scripts-modal__error" style={{ marginTop: 4 }}>
                <AlertCircle size={13} /> {wgError}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <button className="btn btn-primary btn-sm" onClick={saveWgConfig} disabled={wgSaving}>
                {wgSaving ? <span className="spinner spinner-sm" /> : <Check size={13} />}
                {wgSaving ? 'Saving…' : 'Save & Restart'}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => { setWgEditing(false); setWgError(null); }} disabled={wgSaving}>
                <X size={13} /> Cancel
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="settings-row">
              <span className="settings-label">Interface</span>
              <span className="settings-value mono">{wgConfig?.staticInterface ?? '—'}</span>
            </div>
            <div className="settings-row">
              <span className="settings-label">Config Directory</span>
              <span className="settings-value mono">{wgConfig?.configDir ?? '—'}</span>
            </div>
            <div className="settings-row">
              <span className="settings-label">Config Pattern</span>
              <span className="settings-value mono">{wgConfig?.configPattern ?? '—'}</span>
            </div>
            <div className="settings-row">
              <span className="settings-label">State File</span>
              <span className="settings-value mono">{wgConfig?.stateFile ?? '—'}</span>
            </div>
            <div className="settings-row">
              <span className="settings-label">Log File</span>
              <span className="settings-value mono">{wgConfig?.logFile ?? '—'}</span>
            </div>
          </>
        )}
      </GlassCard>

      {/* Monitor Script — compact tile */}
      <GlassCard className="settings-card">
        <div className="settings-card__title">
          <Clock size={16} /> Monitor Script
        </div>
        <div className="settings-row">
          <span className="settings-label">Script Path</span>
          <span className="settings-value mono">{scriptPath || '/usr/local/bin/vpn-monitor.sh'}</span>
        </div>
        <div className="settings-row">
          <span className="settings-label">Ping Check</span>
          <span className="settings-value mono">1.1.1.1</span>
        </div>
        <div className="settings-row">
          <span className="settings-label">Max Handshake Age</span>
          <span className="settings-value mono">150s</span>
        </div>
        <div className="settings-row">
          <span className="settings-label">WS Push Interval</span>
          <span className="settings-value mono">5s</span>
        </div>
        <button
          className="btn btn-ghost btn-sm settings-card__link"
          onClick={() => setShowScriptModal(true)}
        >
          Edit Script <ChevronRight size={13} />
        </button>
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

      {/* ── Passkey management modal ─────────────────────── */}
      {showPasskeyModal && ReactDOM.createPortal(
        <div
          className="settings-modal-overlay"
          onMouseDown={(e) => { overlayMouseDown.current = e.target === e.currentTarget; }}
          onClick={(e) => { if (e.target === e.currentTarget && overlayMouseDown.current) setShowPasskeyModal(false); }}
        >
          <div className="settings-modal">
            <div className="settings-modal__header">
              <span className="settings-modal__title"><KeyRound size={15} /> Passkey Security</span>
              <button className="settings-modal__close" onClick={() => setShowPasskeyModal(false)}>
                <X size={16} />
              </button>
            </div>

            <div className="settings-modal__body">
              {passkeyStatus ? (
                <>
                  {/* Status */}
                  <div className="settings-row">
                    <span className="settings-label">Status</span>
                    <span className={`settings-value--badge ${pkBadge}`}>{pkBadgeText}</span>
                  </div>
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

                  {/* Lock registration */}
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
                        <div className="passkey-panel__ssh-note">To change, remove via SSH then restart:</div>
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
                          <span className="settings-passkey-cred__id">
                            {c.name || `${c.id.slice(0, 20)}…`}
                          </span>
                          <span className="settings-passkey-cred__date">
                            {new Date(c.registeredAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Reset */}
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
            </div>
          </div>
        </div>,
        document.body,
      )}

      {/* ── Script editor modal ──────────────────────────── */}
      {showScriptModal && ReactDOM.createPortal(
        <div
          className="settings-modal-overlay"
          onMouseDown={(e) => { overlayMouseDown.current = e.target === e.currentTarget; }}
          onClick={(e) => { if (e.target === e.currentTarget && overlayMouseDown.current) setShowScriptModal(false); }}
        >
          <div className="settings-modal settings-modal--wide">
            <div className="settings-modal__header">
              <span className="settings-modal__title"><FileCode size={15} /> Monitor Script</span>
              <button className="settings-modal__close" onClick={() => setShowScriptModal(false)}>
                <X size={16} />
              </button>
            </div>
            <div className="settings-modal__body">
              <ScriptEditor onPathLoad={setScriptPath} />
            </div>
          </div>
        </div>,
        document.body,
      )}

      {/* Passkey prompt for lock/reset */}
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
