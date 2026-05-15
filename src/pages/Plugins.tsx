import React, { useEffect, useState, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { Puzzle, Wifi, Film, Tv, Check, X, ChevronRight, AlertCircle } from 'lucide-react';
import { GlassCard } from '../components/ui/GlassCard';
import { PasskeyPrompt } from '../components/ui/PasskeyPrompt';
import { api } from '../lib/api';
import { usePluginStore, type PluginSafe } from '../store/pluginStore';
import { openModal, closeModal } from '../lib/modalManager';
import { showToast } from '../lib/toast';
import './Plugins.css';

const PLUGIN_META = {
  qbittorrent: { label: 'qBittorrent', icon: <Wifi size={22} />,  desc: 'Manage torrents — pause, resume, delete and monitor speeds.', defaultPort: 8080, needsAuth: true  },
  radarr:      { label: 'Radarr',      icon: <Film size={22} />,   desc: 'Monitor movie download queue and re-grab failed releases.',   defaultPort: 7878, needsAuth: false },
  sonarr:      { label: 'Sonarr',      icon: <Tv size={22} />,     desc: 'Monitor TV episode queue and re-grab failed releases.',       defaultPort: 8989, needsAuth: false },
} as const;
type PluginId = keyof typeof PLUGIN_META;

type Draft = { host: string; port: string; https: boolean; publicUrl: string; username: string; password: string; apiKey: string };

const defaultDraft = (cfg: PluginSafe | undefined, id: PluginId): Draft => ({
  host:      cfg?.host  || 'localhost',
  port:      String(cfg?.port || PLUGIN_META[id].defaultPort),
  https:     cfg?.https || false,
  publicUrl: cfg?.publicUrl || '',
  username:  cfg?.username || '',
  password:  '',
  apiKey:    '',
});

export const Plugins: React.FC = () => {
  const { plugins, fetchPlugins } = usePluginStore();
  const [editing, setEditing]     = useState<PluginId | null>(null);
  const [draft, setDraft]         = useState<Draft | null>(null);
  const [saving, setSaving]       = useState(false);
  const [saveErr, setSaveErr]     = useState<string | null>(null);
  const [showPasskey, setShowPasskey] = useState(false);
  const [pendingDisable, setPendingDisable] = useState<PluginId | null>(null);
  useEffect(() => { fetchPlugins(); }, []);

  // Track modal open state for background blur
  const isModalOpen = editing !== null || showPasskey || pendingDisable !== null;
  useEffect(() => {
    if (isModalOpen) { openModal(); return closeModal; }
  }, [isModalOpen]);

  const openEdit = useCallback((id: PluginId) => {
    setEditing(id);
    setDraft(defaultDraft(plugins?.[id], id));
    setSaveErr(null);
  }, [plugins]);

  const closeEdit = useCallback(() => setEditing(null), []);

  const doSave = useCallback(async () => {
    if (!editing || !draft) return;
    setSaving(true);
    setSaveErr(null);
    const res = await api.plugins.save(editing, {
      enabled:   true,
      host:      draft.host.trim(),
      port:      parseInt(draft.port, 10) || PLUGIN_META[editing].defaultPort,
      https:     draft.https,
      publicUrl: draft.publicUrl.trim() || undefined,
      username:  draft.username || undefined,
      password:  draft.password || undefined,
      apiKey:    draft.apiKey   || undefined,
    });
    setSaving(false);
    if (!res.ok) { setSaveErr(res.error); return; }
    setShowPasskey(false);
    setEditing(null);
    await fetchPlugins();
    showToast(`${PLUGIN_META[editing].label} configured successfully`);
  }, [editing, draft, fetchPlugins]);

  const doDisable = useCallback(async (id: PluginId) => {
    const res = await api.plugins.save(id, { enabled: false });
    setPendingDisable(null);
    if (res.ok) { await fetchPlugins(); showToast(`${PLUGIN_META[id].label} disabled`); }
  }, [fetchPlugins]);

  const set = (k: keyof Draft, v: string | boolean) =>
    setDraft((d) => d ? { ...d, [k]: v } : d);

  return (
    <div className="plugins-page animate-fade-in">
      <div className="plugins-page__header">
        <Puzzle size={20} />
        <div>
          <div className="plugins-page__title">Plugin Marketplace</div>
          <div className="plugins-page__sub">Connect wg-man to your local services</div>
        </div>
      </div>

      <div className="plugins-grid">
        {(Object.keys(PLUGIN_META) as PluginId[]).map((id) => {
          const meta   = PLUGIN_META[id];
          const cfg    = plugins?.[id];
          const active = cfg?.enabled ?? false;

          return (
            <GlassCard key={id} className={`plugin-card${active ? ' plugin-card--active' : ''}`}>
              <div className="plugin-card__icon">{meta.icon}</div>
              <div className="plugin-card__body">
                <div className="plugin-card__name">{meta.label}</div>
                <div className="plugin-card__desc">{meta.desc}</div>
                {active && cfg && (
                  <div className="plugin-card__detail">
                    {cfg.https ? 'https' : 'http'}://{cfg.host}:{cfg.port}
                    {cfg.publicUrl && <span className="plugin-card__puburl"> · {cfg.publicUrl}</span>}
                  </div>
                )}
              </div>
              <div className="plugin-card__status">
                <span className={`plugin-status ${active ? 'plugin-status--on' : 'plugin-status--off'}`}>
                  {active ? 'Enabled' : 'Disabled'}
                </span>
              </div>
              <div className="plugin-card__actions">
                {active && cfg && (
                  <a
                    href={cfg.publicUrl || `${cfg.https ? 'https' : 'http'}://${cfg.host}:${cfg.port}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-primary btn-sm"
                  >
                    Open <ChevronRight size={13} />
                  </a>
                )}
                <button className="btn btn-ghost btn-sm" onClick={() => openEdit(id)}>
                  Configure
                </button>
                {active && (
                  <button className="btn btn-ghost btn-sm plugin-card__disable" onClick={() => setPendingDisable(id)}>
                    <X size={13} /> Disable
                  </button>
                )}
              </div>
            </GlassCard>
          );
        })}
      </div>

      {/* Config modal — portal to document.body so it covers the full viewport */}
      {editing && draft && ReactDOM.createPortal(
        <div className="plugins-modal-overlay" onMouseDown={(e) => { (e.currentTarget as any).__md = e.target === e.currentTarget; }} onClick={(e) => { if (e.target === e.currentTarget && (e.currentTarget as any).__md) closeEdit(); }}>
          <div className="plugins-modal">
            <div className="plugins-modal__header">
              <span className="plugins-modal__title">
                {PLUGIN_META[editing].icon} Configure {PLUGIN_META[editing].label}
              </span>
              <button className="scripts-modal__close" onClick={closeEdit}><X size={16} /></button>
            </div>
            <div className="plugins-modal__body">
              <div className="plugins-form-row">
                <label className="plugins-form-label">Host</label>
                <input className="scripts-modal__name-input" value={draft.host} onChange={(e) => set('host', e.target.value)} placeholder="localhost" spellCheck={false} />
              </div>
              <div className="plugins-form-row">
                <label className="plugins-form-label">Port</label>
                <input className="scripts-modal__name-input" type="number" value={draft.port} onChange={(e) => set('port', e.target.value)} style={{ maxWidth: 100 }} />
              </div>
              <div className="plugins-form-row plugins-form-row--check">
                <label className="plugins-form-label">HTTPS</label>
                <input type="checkbox" checked={draft.https} onChange={(e) => set('https', e.target.checked)} />
              </div>
              <div className="plugins-form-row">
                <label className="plugins-form-label">Public URL</label>
                <input
                  className="scripts-modal__name-input"
                  value={draft.publicUrl}
                  onChange={(e) => set('publicUrl', e.target.value)}
                  placeholder="https://radarr.example.com  (optional — used for the Open button only)"
                  spellCheck={false}
                  autoComplete="off"
                />
              </div>
              {PLUGIN_META[editing].needsAuth && (
                <>
                  <div className="plugins-form-row">
                    <label className="plugins-form-label">Username</label>
                    <input className="scripts-modal__name-input" value={draft.username} onChange={(e) => set('username', e.target.value)} autoComplete="off" />
                  </div>
                  <div className="plugins-form-row">
                    <label className="plugins-form-label">Password</label>
                    <input className="scripts-modal__name-input" type="password" value={draft.password}
                      onChange={(e) => set('password', e.target.value)} placeholder={plugins?.[editing]?.hasPassword ? '••••••••' : ''}
                      autoComplete="new-password" />
                  </div>
                </>
              )}
              {!PLUGIN_META[editing].needsAuth && (
                <div className="plugins-form-row">
                  <label className="plugins-form-label">API Key</label>
                  <input className="scripts-modal__name-input" value={draft.apiKey}
                    onChange={(e) => set('apiKey', e.target.value)} placeholder={plugins?.[editing]?.hasApiKey ? '••••••••••••' : 'Settings → General → API Key'}
                    spellCheck={false} autoComplete="off" />
                </div>
              )}
              {saveErr && <div className="scripts-modal__error"><AlertCircle size={12} /> {saveErr}</div>}
              <div className="plugins-modal__actions">
                <button className="btn btn-primary btn-sm" onClick={() => setShowPasskey(true)} disabled={saving}>
                  {saving ? <span className="spinner spinner-sm" /> : <Check size={13} />}
                  Save & Enable
                </button>
                <button className="btn btn-ghost btn-sm" onClick={closeEdit}>Cancel</button>
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {showPasskey && (
        <PasskeyPrompt
          mode="authenticate"
          onSuccess={() => { setShowPasskey(false); doSave(); }}
          onCancel={() => setShowPasskey(false)}
        />
      )}

      {pendingDisable && (
        <PasskeyPrompt
          mode="authenticate"
          onSuccess={() => doDisable(pendingDisable)}
          onCancel={() => setPendingDisable(null)}
        />
      )}
    </div>
  );
};
