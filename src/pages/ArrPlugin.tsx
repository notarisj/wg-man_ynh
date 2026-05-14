import React, { useEffect, useState, useCallback, type ReactNode } from 'react';
import { RefreshCw, Trash2, RotateCcw, ChevronLeft, AlertCircle, CheckCircle } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { GlassCard } from '../components/ui/GlassCard';
import { type ArrQueueItem, type ArrQueue } from '../lib/api';
import './ArrPlugin.css';

function fmtBytes(b: number): string {
  if (b === 0) return '0 B';
  const k = 1024, sizes = ['B','KB','MB','GB','TB'];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return `${(b / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function itemTitle(item: ArrQueueItem, plugin: 'radarr' | 'sonarr'): string {
  if (plugin === 'radarr' && item.movie) {
    return `${item.movie.title} (${item.movie.year})`;
  }
  if (plugin === 'sonarr' && item.series && item.episode) {
    const { seasonNumber: s, episodeNumber: e, title } = item.episode;
    return `${item.series.title} — S${String(s).padStart(2,'0')}E${String(e).padStart(2,'0')} ${title}`;
  }
  return item.title;
}

function progressPct(item: ArrQueueItem): number {
  if (!item.size) return 0;
  return Math.round(((item.size - item.sizeleft) / item.size) * 100);
}

const STATUS_CLS: Record<string, string> = {
  downloading:  'arr-badge--dl',
  paused:       'arr-badge--paused',
  queued:       'arr-badge--queued',
  completed:    'arr-badge--ok',
  failed:       'arr-badge--err',
  warning:      'arr-badge--warn',
};

function statusCls(item: ArrQueueItem): string {
  const s = item.trackedDownloadStatus?.toLowerCase() ?? '';
  if (s === 'warning') return 'arr-badge--warn';
  if (s === 'error')   return 'arr-badge--err';
  const st = item.status?.toLowerCase() ?? '';
  return STATUS_CLS[st] ?? 'arr-badge--queued';
}

interface Props {
  plugin: 'radarr' | 'sonarr';
  icon: ReactNode;
  label: string;
  fetchQueue: () => Promise<{ ok: true; data: ArrQueue } | { ok: false; error: string }>;
  removeItem: (id: number, removeFromClient: boolean, blocklist: boolean) => Promise<{ ok: boolean } | { ok: false; error: string }>;
  rejectItem: (item: ArrQueueItem) => Promise<{ ok: boolean; searched?: boolean } | { ok: false; error: string }>;
}

export const ArrPlugin: React.FC<Props> = ({ plugin, icon, label, fetchQueue, removeItem, rejectItem }) => {
  const [queue, setQueue]       = useState<ArrQueueItem[]>([]);
  const [total, setTotal]       = useState(0);
  const [loading, setLoading]   = useState(true);
  const [err, setErr]           = useState<string | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [toast, setToast]       = useState<{ msg: string; ok: boolean } | null>(null);
  const [actionId, setActionId] = useState<number | null>(null);
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [confirmMode, setConfirmMode] = useState<'remove' | 'reject'>('remove');
  const [removeFromClient, setRemoveFromClient] = useState(true);

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 4000);
  };

  const load = useCallback(async (spin = false) => {
    if (spin) { setSpinning(true); setTimeout(() => setSpinning(false), 600); }
    const res = await fetchQueue();
    if (!res.ok) { setErr(res.error); setLoading(false); return; }
    setQueue(res.data.records);
    setTotal(res.data.totalRecords);
    setErr(null);
    setLoading(false);
  }, [fetchQueue]);

  useEffect(() => { load(); }, []);

  useEffect(() => {
    const id = setInterval(() => load(), 15_000);
    return () => clearInterval(id);
  }, [load]);

  const doRemove = async (item: ArrQueueItem) => {
    setActionId(item.id);
    const res = await removeItem(item.id, removeFromClient, false);
    setActionId(null);
    setConfirmId(null);
    if (!res.ok) { showToast((res as any).error ?? 'Remove failed', false); return; }
    showToast(`Removed from queue`);
    await load();
  };

  const doReject = async (item: ArrQueueItem) => {
    setActionId(item.id);
    const res = await rejectItem(item);
    setActionId(null);
    setConfirmId(null);
    if (!res.ok) { showToast((res as any).error ?? 'Reject failed', false); return; }
    const searched = (res as any).searched;
    showToast(searched ? 'Blocklisted & searching for alternatives…' : 'Blocklisted — no alternatives found');
    await load();
  };

  const openConfirm = (item: ArrQueueItem, mode: 'remove' | 'reject') => {
    setConfirmId(item.id);
    setConfirmMode(mode);
  };

  const confirmItem = queue.find((q) => q.id === confirmId);

  return (
    <div className="arr-page animate-fade-in">
      <div className="arr-page__header">
        <NavLink to="/plugins" className="arr-back-link">
          <ChevronLeft size={15} /> Plugins
        </NavLink>
        <div className="arr-page__title-row">
          <span className="arr-page__icon">{icon}</span>
          <div>
            <div className="arr-page__title">{label}</div>
            <div className="arr-page__sub">
              {loading ? 'Loading…' : `${total} item${total !== 1 ? 's' : ''} in queue`}
            </div>
          </div>
          <button
            className={`btn btn-ghost btn-sm arr-refresh${spinning ? ' spinning' : ''}`}
            onClick={() => load(true)}
            title="Refresh"
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {toast && (
        <div className={`arr-toast ${toast.ok ? 'arr-toast--ok' : 'arr-toast--err'}`}>
          {toast.ok ? <CheckCircle size={14} /> : <AlertCircle size={14} />} {toast.msg}
        </div>
      )}

      {loading ? (
        <div className="arr-loading"><span className="spinner" /> Loading queue…</div>
      ) : err ? (
        <div className="arr-err"><AlertCircle size={16} /> {err}</div>
      ) : queue.length === 0 ? (
        <div className="arr-empty">Queue is empty</div>
      ) : (
        <div className="arr-list">
          {queue.map((item) => {
            const pct  = progressPct(item);
            const busy = actionId === item.id;
            const hasWarnings = item.statusMessages?.length > 0;
            return (
              <GlassCard key={item.id} className="arr-card">
                <div className="arr-card__top">
                  <div className="arr-card__title" title={itemTitle(item, plugin)}>
                    {itemTitle(item, plugin)}
                  </div>
                  <div className="arr-card__badges">
                    <span className={`arr-badge ${statusCls(item)}`}>
                      {item.trackedDownloadStatus || item.status}
                    </span>
                    <span className="arr-badge arr-badge--quality">{item.quality?.quality?.name}</span>
                    {item.protocol && (
                      <span className="arr-badge arr-badge--proto">{item.protocol}</span>
                    )}
                  </div>
                </div>

                <div className="arr-card__prog-wrap">
                  <div className="arr-card__prog-bar" style={{ width: `${pct}%` }} />
                </div>

                <div className="arr-card__meta">
                  <span>{fmtBytes(item.size - item.sizeleft)} / {fmtBytes(item.size)}</span>
                  {item.timeleft && <span>{item.timeleft} left</span>}
                  {item.downloadClient && <span>{item.downloadClient}</span>}
                  {item.indexer && <span className="arr-meta--dim">{item.indexer}</span>}
                </div>

                {hasWarnings && (
                  <div className="arr-card__warnings">
                    {item.statusMessages.map((m, i) => (
                      <div key={i} className="arr-warning">
                        <AlertCircle size={12} />
                        <div>
                          {m.title && <span className="arr-warning__title">{m.title}: </span>}
                          {m.messages.join('; ')}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="arr-card__actions">
                  <button
                    className="btn btn-ghost btn-sm arr-btn-remove"
                    onClick={() => openConfirm(item, 'remove')}
                    disabled={busy}
                  >
                    {busy ? <span className="spinner spinner-sm" /> : <Trash2 size={13} />}
                    Remove
                  </button>
                  <button
                    className="btn btn-ghost btn-sm arr-btn-reject"
                    onClick={() => openConfirm(item, 'reject')}
                    disabled={busy}
                    title="Blocklist this release and search for alternatives"
                  >
                    {busy ? <span className="spinner spinner-sm" /> : <RotateCcw size={13} />}
                    Re-grab
                  </button>
                </div>
              </GlassCard>
            );
          })}
        </div>
      )}

      {confirmId !== null && confirmItem && (
        <div className="arr-confirm-overlay" onClick={(e) => { if (e.target === e.currentTarget) setConfirmId(null); }}>
          <div className="arr-confirm">
            {confirmMode === 'remove' ? (
              <>
                <div className="arr-confirm__title">Remove from queue?</div>
                <div className="arr-confirm__desc">{itemTitle(confirmItem, plugin)}</div>
                <label className="arr-confirm__check">
                  <input
                    type="checkbox"
                    checked={removeFromClient}
                    onChange={(e) => setRemoveFromClient(e.target.checked)}
                  />
                  Also remove from download client
                </label>
                <div className="arr-confirm__actions">
                  <button className="btn btn-ghost btn-sm" onClick={() => setConfirmId(null)}>Cancel</button>
                  <button
                    className="btn btn-ghost btn-sm arr-btn-remove"
                    onClick={() => doRemove(confirmItem)}
                    disabled={actionId === confirmItem.id}
                  >
                    {actionId === confirmItem.id ? <span className="spinner spinner-sm" /> : <Trash2 size={13} />}
                    Remove
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="arr-confirm__title">Blocklist & re-grab?</div>
                <div className="arr-confirm__desc">{itemTitle(confirmItem, plugin)}</div>
                <div className="arr-confirm__info">
                  This release will be blocklisted and {label} will immediately search for an alternative.
                  If nothing else is found, the blocklist entry can be reviewed in {label} settings.
                </div>
                <div className="arr-confirm__actions">
                  <button className="btn btn-ghost btn-sm" onClick={() => setConfirmId(null)}>Cancel</button>
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => doReject(confirmItem)}
                    disabled={actionId === confirmItem.id}
                  >
                    {actionId === confirmItem.id ? <span className="spinner spinner-sm" /> : <RotateCcw size={13} />}
                    Re-grab
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
