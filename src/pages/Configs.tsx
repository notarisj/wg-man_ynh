import React, { useEffect, useState, useCallback } from 'react';
import {
  Layers, CheckCircle2, Circle, RotateCcw, ServerCrash, AlertCircle,
  Search, X, Plus, Pencil, Trash2, KeyRound, Lock, LockOpen, Terminal, ChevronDown, ChevronUp, Copy, Check,
} from 'lucide-react';
import { useVpnStore } from '../store/vpnStore';
import { GlassCard } from '../components/ui/GlassCard';
import { PasskeyPrompt } from '../components/ui/PasskeyPrompt';
import { ConfigEditor } from '../components/ui/ConfigEditor';
import { api } from '../lib/api';
import type { PasskeyStatus } from '../lib/api';
import './Configs.css';

// ── Passkey gate hook ─────────────────────────────────────────

type PendingAction = { type: 'create' } | { type: 'edit'; name: string } | { type: 'delete'; name: string };

// ── Page ──────────────────────────────────────────────────────

export const Configs: React.FC = () => {
  const { configs, fetchConfigs, switchConfig, isSwitching, isLoadingConfigs, error } = useVpnStore();

  const [switchedMsg, setSwitchedMsg]       = useState<string | null>(null);
  const [switchError, setSwitchError]       = useState<string | null>(null);
  const [search, setSearch]                 = useState('');

  // Passkey state
  const [passkeyStatus, setPasskeyStatus]   = useState<PasskeyStatus | null>(null);
  const [showPasskey, setShowPasskey]       = useState(false);
  const [passkeyMode, setPasskeyMode]       = useState<'register' | 'authenticate'>('authenticate');
  const [pendingAction, setPendingAction]   = useState<PendingAction | null>(null);

  // Editor state
  const [editorOpen, setEditorOpen]         = useState(false);
  const [editingConfig, setEditingConfig]   = useState<string | null>(null); // null = new

  // Delete confirmation
  const [confirmDelete, setConfirmDelete]   = useState<string | null>(null);
  const [deleteError, setDeleteError]       = useState<string | null>(null);
  const [isDeleting, setIsDeleting]         = useState(false);

  // Lock registration
  const [lockPending, setLockPending]       = useState(false);
  const [isLocking, setIsLocking]           = useState(false);
  const [passkeyPanelOpen, setPasskeyPanelOpen] = useState(false);
  const [cmdCopied, setCmdCopied]           = useState(false);

  // Config name prefix derived from pattern (e.g. "wg-*.conf" → "wg-")
  const namePrefix = 'wg-';

  useEffect(() => {
    fetchConfigs();
    api.passkey.status().then((res) => { if (res.ok) setPasskeyStatus(res.data); });
  }, []);

  // ── Passkey gate ────────────────────────────────────────────

  const requirePasskey = useCallback((action: PendingAction) => {
    if (!passkeyStatus?.registered) {
      // No passkey yet — register first
      setPendingAction(action);
      setPasskeyMode('register');
      setShowPasskey(true);
    } else {
      // Authenticate with existing passkey
      setPendingAction(action);
      setPasskeyMode('authenticate');
      setShowPasskey(true);
    }
  }, [passkeyStatus]);

  const onPasskeySuccess = useCallback(() => {
    setShowPasskey(false);
    const action = pendingAction;
    setPendingAction(null);
    if (!action) return;

    if (action.type === 'create') {
      setEditingConfig(null);
      setEditorOpen(true);
    } else if (action.type === 'edit') {
      setEditingConfig(action.name);
      setEditorOpen(true);
    } else if (action.type === 'delete') {
      setConfirmDelete(action.name);
    }
  }, [pendingAction]);

  const onPasskeyRegistered = useCallback(() => {
    api.passkey.status().then((res) => { if (res.ok) setPasskeyStatus(res.data); });
  }, []);

  // Lock registration — called after passkey auth succeeds with lockPending=true
  const onPasskeySuccessWithLock = useCallback(() => {
    setShowPasskey(false);
    setPendingAction(null);
    if (lockPending) {
      setLockPending(false);
      setIsLocking(true);
      api.passkey.lockRegistration().then((res) => {
        setIsLocking(false);
        if (res.ok) {
          api.passkey.status().then((s) => { if (s.ok) setPasskeyStatus(s.data); });
        }
      });
    }
  }, [lockPending]);

  const handleLockRegistration = useCallback(() => {
    setLockPending(true);
    setPendingAction(null);
    setPasskeyMode('authenticate');
    setShowPasskey(true);
  }, []);

  // ── CRUD handlers ────────────────────────────────────────────

  const handleSwitch = async (name: string) => {
    setSwitchError(null);
    const ok = await switchConfig(name);
    if (ok) {
      setSwitchedMsg(`Switched to ${name}`);
      setTimeout(() => setSwitchedMsg(null), 3500);
    } else {
      setSwitchError(error ?? 'Failed to switch config');
      setTimeout(() => setSwitchError(null), 5000);
    }
  };

  const handleEditorSave = useCallback((savedName: string) => {
    setEditorOpen(false);
    setEditingConfig(null);
    setSwitchedMsg(`Config "${savedName}" saved`);
    setTimeout(() => setSwitchedMsg(null), 3500);
    fetchConfigs();
  }, [fetchConfigs]);

  const handleDeleteConfirm = async () => {
    if (!confirmDelete) return;
    setIsDeleting(true);
    setDeleteError(null);
    const res = await api.deleteConfig(confirmDelete);
    setIsDeleting(false);
    if (!res.ok) { setDeleteError(res.error); return; }
    setConfirmDelete(null);
    setSwitchedMsg(`Config "${confirmDelete}" deleted`);
    setTimeout(() => setSwitchedMsg(null), 3500);
    fetchConfigs();
  };

  // ── Filtering ────────────────────────────────────────────────

  const q = search.toLowerCase();
  const filtered = search
    ? configs.filter((c) =>
        [c.name, c.comment, c.address, c.endpoint].some((v) => v?.toLowerCase().includes(q))
      )
    : configs;

  // ── Render ───────────────────────────────────────────────────

  return (
    <div className="configs-page animate-fade-in">

      {/* Topbar */}
      <div className="configs-page__topbar">
        <p className="configs-page__count">
          {search ? `${filtered.length} of ${configs.length}` : configs.length} configuration{configs.length !== 1 ? 's' : ''} found
        </p>
        <div className="page-search">
          <Search size={14} className="page-search__icon" />
          <input
            type="text"
            className="page-search__input"
            placeholder="Search configs…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button className="page-search__clear" onClick={() => setSearch('')} aria-label="Clear">
              <X size={12} />
            </button>
          )}
        </div>
        <div className="configs-page__topbar-actions">
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => fetchConfigs()}
            disabled={isLoadingConfigs}
          >
            {isLoadingConfigs ? <span className="spinner spinner-sm" /> : <RotateCcw size={15} />}
            Refresh
          </button>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => requirePasskey({ type: 'create' })}
          >
            <Plus size={15} /> New Config
          </button>
          <button
            className="configs-page__passkey-toggle"
            onClick={() => setPasskeyPanelOpen((v) => !v)}
            title="Passkey security settings"
          >
            <KeyRound size={13} className={
              !passkeyStatus ? '' :
              passkeyStatus.registrationLocked ? 'passkey-badge--lock' :
              passkeyStatus.registered ? 'passkey-badge--ok' : 'passkey-badge--warn'
            } />
            {passkeyPanelOpen ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
          </button>
        </div>
      </div>

      {/* Toasts */}
      {switchedMsg && (
        <div className="configs-page__toast">
          <CheckCircle2 size={15} /> {switchedMsg}
        </div>
      )}
      {switchError && (
        <div className="configs-page__toast configs-page__toast--error">
          <AlertCircle size={15} /> {switchError}
        </div>
      )}

      {/* Passkey management panel */}
      {passkeyPanelOpen && passkeyStatus && (
        <GlassCard className="passkey-panel animate-slide-up">
          <div className="passkey-panel__header">
            <div className="passkey-panel__title">
              {passkeyStatus.registrationLocked
                ? <><Lock size={15} className="passkey-badge--lock" /> Passkey Registration Locked</>
                : passkeyStatus.registered
                ? <><KeyRound size={15} className="passkey-badge--ok" /> Passkey Active</>
                : <><KeyRound size={15} className="passkey-badge--warn" /> No Passkey Registered</>}
            </div>
            {passkeyStatus.registered && !passkeyStatus.registrationLocked && (
              <button
                className="btn btn-sm"
                style={{ background: 'rgba(245,158,11,0.08)', color: 'var(--clr-amber)', border: '1px solid rgba(245,158,11,0.25)' }}
                onClick={handleLockRegistration}
                disabled={isLocking}
                title="Prevent any new passkeys from being registered via the UI"
              >
                {isLocking ? <span className="spinner spinner-sm" /> : <Lock size={13} />}
                Lock Registration
              </button>
            )}
          </div>

          {passkeyStatus.registrationLocked ? (
            <div className="passkey-panel__locked">
              <div className="passkey-panel__locked-desc">
                <Lock size={14} />
                New passkey registration is <strong>disabled</strong>. To re-enable it, SSH into the server and run:
              </div>
              <div className="passkey-panel__ssh-block">
                <Terminal size={12} />
                <code className="passkey-panel__ssh-cmd">sudo jq '.registrationLocked = false' {passkeyStatus.storeFile} | sudo tee {passkeyStatus.storeFile}</code>
                <button
                  className="passkey-panel__copy-btn"
                  title="Copy command"
                  onClick={() => {
                    navigator.clipboard.writeText(`sudo jq '.registrationLocked = false' ${passkeyStatus.storeFile} | sudo tee ${passkeyStatus.storeFile}`);
                    setCmdCopied(true);
                    setTimeout(() => setCmdCopied(false), 2000);
                  }}
                >
                  {cmdCopied ? <Check size={12} /> : <Copy size={12} />}
                </button>
              </div>
              <div className="passkey-panel__ssh-note">
                Then restart the service: <code>sudo systemctl restart wg-man</code>
              </div>
            </div>
          ) : passkeyStatus.registered ? (
            <div className="passkey-panel__info">
              <LockOpen size={13} /> Registration is open — additional passkeys can be added. Lock it once setup is complete.
            </div>
          ) : (
            <div className="passkey-panel__info">
              <AlertCircle size={13} /> No passkey registered yet. You will be prompted to create one when you first modify a config.
            </div>
          )}

          {passkeyStatus.credentials.length > 0 && (
            <div className="passkey-panel__creds">
              <div className="passkey-panel__creds-label">Registered keys</div>
              {passkeyStatus.credentials.map((c) => (
                <div key={c.id} className="passkey-panel__cred">
                  <KeyRound size={11} />
                  <span className="passkey-panel__cred-id">{c.id.slice(0, 20)}…</span>
                  <span className="passkey-panel__cred-date">
                    {new Date(c.registeredAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </GlassCard>
      )}

      {/* Config grid */}
      {isLoadingConfigs && configs.length === 0 ? (
        <div className="configs-page__grid">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="skeleton" style={{ height: 140, borderRadius: 12 }} />
          ))}
        </div>
      ) : configs.length === 0 ? (
        <GlassCard className="configs-page__empty">
          <ServerCrash size={36} />
          <p>No WireGuard configs found matching the pattern.</p>
        </GlassCard>
      ) : filtered.length === 0 ? (
        <GlassCard className="configs-page__empty">
          <Search size={36} />
          <p>No configs match "{search}".</p>
        </GlassCard>
      ) : (
        <div className="configs-page__grid">
          {filtered.map((cfg) => {
            const isActive = cfg.isActive;
            const isBusy = isSwitching === cfg.name;
            return (
              <GlassCard
                key={cfg.name}
                className={`config-card${isActive ? ' config-card--active' : ''}`}
              >
                {isActive && <div className="config-card__active-glow" />}
                <div className="config-card__header">
                  <div className="config-card__title-row">
                    <div className="config-card__icon">
                      {isActive
                        ? <CheckCircle2 size={18} className="config-card__icon--active" />
                        : <Circle size={18} className="config-card__icon--inactive" />}
                    </div>
                    <div>
                      <div className="config-card__name">{cfg.name}</div>
                      {cfg.comment && <div className="config-card__comment">{cfg.comment}</div>}
                    </div>
                    {isActive && <span className="config-card__badge">Active</span>}
                    <div className="config-card__actions">
                      <button
                        className="config-card__action-btn"
                        title="Edit config"
                        onClick={() => requirePasskey({ type: 'edit', name: cfg.name })}
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        className="config-card__action-btn config-card__action-btn--danger"
                        title={isActive ? 'Cannot delete active config' : 'Delete config'}
                        disabled={isActive}
                        onClick={() => requirePasskey({ type: 'delete', name: cfg.name })}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                </div>

                <div className="config-card__meta">
                  <div className="config-card__meta-row">
                    <span className="config-card__meta-label">Address</span>
                    <span className="config-card__meta-val mono">{cfg.address ?? '—'}</span>
                  </div>
                  <div className="config-card__meta-row">
                    <span className="config-card__meta-label">Endpoint</span>
                    <span className="config-card__meta-val mono">{cfg.endpoint ?? '—'}</span>
                  </div>
                </div>

                <div className="config-card__footer">
                  {isActive ? (
                    <button className="btn btn-ghost btn-sm" disabled>
                      <CheckCircle2 size={14} /> Currently Active
                    </button>
                  ) : (
                    <button
                      id={`btn-switch-${cfg.name}`}
                      className="btn btn-primary btn-sm"
                      onClick={() => handleSwitch(cfg.name)}
                      disabled={!!isSwitching}
                    >
                      {isBusy ? <span className="spinner spinner-sm" /> : <Layers size={14} />}
                      {isBusy ? 'Switching…' : 'Switch to This'}
                    </button>
                  )}
                </div>
              </GlassCard>
            );
          })}
        </div>
      )}

      {/* Passkey prompt */}
      {showPasskey && (
        <PasskeyPrompt
          mode={passkeyMode}
          onSuccess={lockPending ? onPasskeySuccessWithLock : onPasskeySuccess}
          onCancel={() => { setShowPasskey(false); setPendingAction(null); setLockPending(false); }}
          onRegistered={onPasskeyRegistered}
        />
      )}

      {/* Config editor */}
      {editorOpen && (
        <ConfigEditor
          editName={editingConfig}
          namePrefix={namePrefix}
          onSave={handleEditorSave}
          onCancel={() => { setEditorOpen(false); setEditingConfig(null); }}
        />
      )}

      {/* Delete confirmation dialog */}
      {confirmDelete && (
        <div className="configs-page__confirm-overlay" onClick={(e) => e.target === e.currentTarget && setConfirmDelete(null)}>
          <div className="configs-page__confirm animate-slide-up">
            <div className="configs-page__confirm-title">Delete Config</div>
            <p className="configs-page__confirm-desc">
              Are you sure you want to delete <code>{confirmDelete}</code>? This cannot be undone.
            </p>
            {deleteError && (
              <div className="configs-page__confirm-error">
                <AlertCircle size={13} /> {deleteError}
              </div>
            )}
            <div className="configs-page__confirm-actions">
              <button className="btn btn-ghost btn-sm" onClick={() => setConfirmDelete(null)} disabled={isDeleting}>
                Cancel
              </button>
              <button className="btn btn-danger btn-sm" onClick={handleDeleteConfirm} disabled={isDeleting}>
                {isDeleting ? <span className="spinner spinner-sm" /> : <Trash2 size={14} />}
                {isDeleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
