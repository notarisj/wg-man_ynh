import React, { useEffect, useState, useCallback } from 'react';
import {
  Layers, CheckCircle2, Circle, RotateCcw, ServerCrash, AlertCircle,
  Search, X, Plus, Pencil, Trash2, LayoutGrid, List,
} from 'lucide-react';
import { useVpnStore } from '../store/vpnStore';
import { GlassCard } from '../components/ui/GlassCard';
import { PasskeyPrompt } from '../components/ui/PasskeyPrompt';
import { ConfigEditor } from '../components/ui/ConfigEditor';
import { api } from '../lib/api';
import type { PasskeyStatus } from '../lib/api';
import './Configs.css';

type PendingAction = { type: 'create' } | { type: 'edit'; name: string } | { type: 'delete'; name: string };

export const Configs: React.FC = () => {
  const { configs, fetchConfigs, switchConfig, isSwitching, isLoadingConfigs, error } = useVpnStore();

  const [viewMode, setViewMode] = useState<'grid' | 'list'>(
    () => (localStorage.getItem('configs-view-mode') as 'grid' | 'list') ?? 'grid',
  );
  const [switchedMsg, setSwitchedMsg]     = useState<string | null>(null);
  const [switchError, setSwitchError]     = useState<string | null>(null);
  const [search, setSearch]               = useState('');

  // Passkey gate
  const [passkeyStatus, setPasskeyStatus] = useState<PasskeyStatus | null>(null);
  const [showPasskey, setShowPasskey]     = useState(false);
  const [passkeyMode, setPasskeyMode]     = useState<'register' | 'authenticate'>('authenticate');
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);

  // Editor
  const [editorOpen, setEditorOpen]       = useState(false);
  const [editingConfig, setEditingConfig] = useState<string | null>(null);

  // Delete confirmation
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleteError, setDeleteError]     = useState<string | null>(null);
  const [isDeleting, setIsDeleting]       = useState(false);

  const namePrefix = 'wg-';

  useEffect(() => {
    fetchConfigs();
    api.passkey.status().then((res) => { if (res.ok) setPasskeyStatus(res.data); });
  }, []);

  // ── Passkey gate ────────────────────────────────────────────

  const requirePasskey = useCallback((action: PendingAction) => {
    setPendingAction(action);
    setPasskeyMode(passkeyStatus?.registered ? 'authenticate' : 'register');
    setShowPasskey(true);
  }, [passkeyStatus]);

  const onPasskeySuccess = useCallback(() => {
    setShowPasskey(false);
    const action = pendingAction;
    setPendingAction(null);
    if (!action) return;
    if (action.type === 'create') { setEditingConfig(null); setEditorOpen(true); }
    else if (action.type === 'edit') { setEditingConfig(action.name); setEditorOpen(true); }
    else if (action.type === 'delete') { setConfirmDelete(action.name); }
  }, [pendingAction]);

  const onPasskeyRegistered = useCallback(() => {
    api.passkey.status().then((res) => { if (res.ok) setPasskeyStatus(res.data); });
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
          <div className="configs-view-toggle">
            <button
              className={`configs-view-toggle__btn${viewMode === 'grid' ? ' active' : ''}`}
              title="Grid view"
              onClick={() => { setViewMode('grid'); localStorage.setItem('configs-view-mode', 'grid'); }}
            >
              <LayoutGrid size={14} />
            </button>
            <button
              className={`configs-view-toggle__btn${viewMode === 'list' ? ' active' : ''}`}
              title="List view"
              onClick={() => { setViewMode('list'); localStorage.setItem('configs-view-mode', 'list'); }}
            >
              <List size={14} />
            </button>
          </div>
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
      ) : viewMode === 'grid' ? (
        <div className="configs-page__grid">
          {filtered.map((cfg) => {
            const isActive = cfg.isActive;
            const isBusy = isSwitching === cfg.name;
            return (
              <GlassCard key={cfg.name} className={`config-card${isActive ? ' config-card--active' : ''}`}>
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
                      <button className="config-card__action-btn" title="Edit config" onClick={() => requirePasskey({ type: 'edit', name: cfg.name })}>
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
                    <button className="btn btn-ghost btn-sm" disabled><CheckCircle2 size={14} /> Currently Active</button>
                  ) : (
                    <button id={`btn-switch-${cfg.name}`} className="btn btn-primary btn-sm" onClick={() => handleSwitch(cfg.name)} disabled={!!isSwitching}>
                      {isBusy ? <span className="spinner spinner-sm" /> : <Layers size={14} />}
                      {isBusy ? 'Switching…' : 'Switch to This'}
                    </button>
                  )}
                </div>
              </GlassCard>
            );
          })}
        </div>
      ) : (
        <div className="configs-page__list">
          {filtered.map((cfg) => {
            const isActive = cfg.isActive;
            const isBusy = isSwitching === cfg.name;
            return (
              <GlassCard key={cfg.name} className={`config-row${isActive ? ' config-row--active' : ''}`}>
                {isActive && <div className="config-card__active-glow" />}
                <div className="config-row__icon">
                  {isActive
                    ? <CheckCircle2 size={16} className="config-card__icon--active" />
                    : <Circle size={16} className="config-card__icon--inactive" />}
                </div>
                <div className="config-row__identity">
                  <span className="config-card__name">{cfg.name}</span>
                  {cfg.comment && <span className="config-card__comment">{cfg.comment}</span>}
                </div>
                <div className="config-row__meta">
                  <span className="config-card__meta-val mono">{cfg.address ?? '—'}</span>
                  <span className="config-row__sep" />
                  <span className="config-card__meta-val mono">{cfg.endpoint ?? '—'}</span>
                </div>
                <div className="config-row__right">
                  {isActive && <span className="config-card__badge">Active</span>}
                  {isActive ? (
                    <button className="btn btn-ghost btn-sm" disabled><CheckCircle2 size={14} /> Active</button>
                  ) : (
                    <button className="btn btn-primary btn-sm" onClick={() => handleSwitch(cfg.name)} disabled={!!isSwitching}>
                      {isBusy ? <span className="spinner spinner-sm" /> : <Layers size={14} />}
                      {isBusy ? 'Switching…' : 'Switch'}
                    </button>
                  )}
                  <button className="config-card__action-btn" title="Edit config" onClick={() => requirePasskey({ type: 'edit', name: cfg.name })}>
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
              </GlassCard>
            );
          })}
        </div>
      )}

      {/* Passkey prompt */}
      {showPasskey && (
        <PasskeyPrompt
          mode={passkeyMode}
          onSuccess={onPasskeySuccess}
          onCancel={() => { setShowPasskey(false); setPendingAction(null); }}
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

      {/* Delete confirmation */}
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
