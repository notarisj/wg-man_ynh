import React, { useEffect, useState, useCallback, useRef } from 'react';
import { RefreshCw, Pause, Play, Trash2, ArrowDown, ArrowUp, Zap, X } from 'lucide-react';
import { GlassCard } from '../components/ui/GlassCard';
import { api, type QbitTorrent, type ApiResult } from '../lib/api';
import { showToast } from '../lib/toast';
import './QBittorrent.css';

const STATES: Record<string, { label: string; cls: string }> = {
  downloading:        { label: 'Downloading', cls: 'qbit-badge--dl' },
  stalledDL:          { label: 'Stalled',     cls: 'qbit-badge--stalled' },
  forcedDL:           { label: 'Forced',      cls: 'qbit-badge--forced' },
  uploading:          { label: 'Seeding',     cls: 'qbit-badge--seed' },
  stalledUP:          { label: 'Seeding',     cls: 'qbit-badge--seed' },
  forcedUP:           { label: 'Forced',      cls: 'qbit-badge--forced' },
  pausedDL:           { label: 'Paused',      cls: 'qbit-badge--paused' },
  pausedUP:           { label: 'Paused',      cls: 'qbit-badge--paused' },
  queuedDL:           { label: 'Queued',      cls: 'qbit-badge--queued' },
  queuedUP:           { label: 'Queued',      cls: 'qbit-badge--queued' },
  checkingDL:         { label: 'Checking',    cls: 'qbit-badge--checking' },
  checkingUP:         { label: 'Checking',    cls: 'qbit-badge--checking' },
  checkingResumeData: { label: 'Checking',    cls: 'qbit-badge--checking' },
  moving:             { label: 'Moving',      cls: 'qbit-badge--checking' },
  error:              { label: 'Error',       cls: 'qbit-badge--error' },
  missingFiles:       { label: 'Missing',     cls: 'qbit-badge--error' },
};

function fmtBytes(b: number): string {
  if (b === 0) return '0 B';
  const k = 1024, sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return `${(b / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function fmtSpeed(bps: number): string {
  if (bps < 1024) return '0 KB/s';
  return `${fmtBytes(bps)}/s`;
}

function fmtEta(secs: number): string {
  if (secs < 0 || secs >= 8640000) return '∞';
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60);
  return m ? `${h}h ${m}m` : `${h}h`;
}

function fmtDate(ts: number): string {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

type Filter = 'all' | 'downloading' | 'seeding' | 'paused' | 'error';

const QbitCheck: React.FC<{
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
  onClick?: (e: React.MouseEvent) => void;
}> = ({ checked, indeterminate, onChange, onClick }) => {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !!indeterminate;
  }, [indeterminate]);
  return (
    <label className="qbit-check" onClick={onClick}>
      <input ref={ref} type="checkbox" checked={checked} onChange={onChange} />
      <span className="qbit-check__box" />
    </label>
  );
};

export const QBittorrent: React.FC = () => {
  const [torrents, setTorrents]     = useState<QbitTorrent[]>([]);
  const [transfer, setTransfer]     = useState<Record<string, any> | null>(null);
  const [loading, setLoading]       = useState(true);
  const [err, setErr]               = useState<string | null>(null);
  const [spinning, setSpinning]     = useState(false);
  const [selected, setSelected]     = useState<Set<string>>(new Set());
  const [filter, setFilter]         = useState<Filter>('all');
  const [delConfirm, setDelConfirm] = useState(false);
  const [delHashes, setDelHashes]   = useState<string[]>([]);
  const [delFiles, setDelFiles]     = useState(false);
  const [actionErr, setActionErr]   = useState<string | null>(null);
  const [detail, setDetail]         = useState<QbitTorrent | null>(null);

  const detailRef = useRef<QbitTorrent | null>(null);
  detailRef.current = detail;

  const load = useCallback(async (spin = false) => {
    if (spin) { setSpinning(true); setTimeout(() => setSpinning(false), 600); }
    const [tRes, trRes] = await Promise.all([api.qbit.torrents(), api.qbit.transfer()]);
    if (!tRes.ok) { setErr(tRes.error); setLoading(false); return; }
    setTorrents(tRes.data);
    const dt = detailRef.current;
    if (dt) {
      const updated = tRes.data.find(t => t.hash === dt.hash);
      if (updated) setDetail(updated);
    }
    if (trRes.ok) setTransfer(trRes.data);
    setErr(null);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, []);
  useEffect(() => {
    const id = setInterval(() => load(), 5000);
    return () => clearInterval(id);
  }, [load]);

  const filtered = torrents.filter(t => {
    if (filter === 'all') return true;
    if (filter === 'downloading') return t.state.includes('DL') || t.state === 'downloading';
    if (filter === 'seeding') return t.state.includes('UP') || t.state === 'uploading';
    if (filter === 'paused') return t.state.toLowerCase().includes('pause');
    if (filter === 'error') return t.state === 'error' || t.state === 'missingFiles';
    return true;
  });

  const allSelected  = filtered.length > 0 && filtered.every(t => selected.has(t.hash));
  const someSelected = filtered.some(t => selected.has(t.hash)) && !allSelected;

  const toggleAll = () => {
    if (allSelected) {
      setSelected(s => { const n = new Set(s); filtered.forEach(t => n.delete(t.hash)); return n; });
    } else {
      setSelected(s => { const n = new Set(s); filtered.forEach(t => n.add(t.hash)); return n; });
    }
  };

  const toggle = (hash: string) =>
    setSelected(s => { const n = new Set(s); n.has(hash) ? n.delete(hash) : n.add(hash); return n; });

  const bulkHashes = Array.from(selected);

  // Generic action runner
  const doAction = useCallback(async (
    fn: (h: string[]) => Promise<ApiResult<unknown>>,
    hs: string[],
    msg: string,
    clearSel = false,
  ) => {
    setActionErr(null);
    const res = await fn(hs);
    if (!res.ok) { setActionErr(res.error ?? 'Action failed'); return; }
    showToast(msg);
    if (clearSel) setSelected(new Set());
    await load();
  }, [load]);

  // Bulk actions
  const doPause       = () => doAction(api.qbit.pause,       bulkHashes, `Paused ${bulkHashes.length} torrent(s)`, true);
  const doResume      = () => doAction(api.qbit.resume,      bulkHashes, `Resumed ${bulkHashes.length} torrent(s)`, true);
  const doForceResume = () => doAction(api.qbit.forceResume, bulkHashes, `Force-resumed ${bulkHashes.length} torrent(s)`, true);

  // Single-torrent actions from drawer
  const singlePause  = (h: string) => doAction(api.qbit.pause,       [h], 'Paused');
  const singleResume = (h: string) => doAction(api.qbit.resume,      [h], 'Resumed');
  const singleForce  = (h: string) => doAction(api.qbit.forceResume, [h], 'Force-resumed');

  // Open delete confirm — works for both bulk and single
  const openDelete = (hs: string[]) => { setDelHashes(hs); setDelFiles(false); setDelConfirm(true); };

  const doDelete = async () => {
    setActionErr(null);
    const res = await api.qbit.delete(delHashes, delFiles);
    if (!res.ok) { setActionErr(res.error ?? 'Delete failed'); return; }
    showToast(`Deleted ${delHashes.length} torrent(s)${delFiles ? ' + files' : ''}`);
    if (detail && delHashes.includes(detail.hash)) setDetail(null);
    setSelected(s => { const n = new Set(s); delHashes.forEach(h => n.delete(h)); return n; });
    setDelConfirm(false);
    await load();
  };

  const dlSpeed = transfer?.dl_info_speed ?? 0;
  const upSpeed = transfer?.up_info_speed ?? 0;

  return (
    <div className="qbit-page animate-fade-in">
      <div className="qbit-page__topbar">
        <div className="qbit-speeds">
          <span className="qbit-speed qbit-speed--dl"><ArrowDown size={13} />{fmtSpeed(dlSpeed)}</span>
          <span className="qbit-speed qbit-speed--up"><ArrowUp size={13} />{fmtSpeed(upSpeed)}</span>
        </div>
        <button
          className={`btn btn-ghost btn-sm qbit-refresh${spinning ? ' spinning' : ''}`}
          onClick={() => load(true)}
          title="Refresh"
        >
          <RefreshCw size={14} />
        </button>
      </div>

      {actionErr && <div className="qbit-action-err">{actionErr}</div>}

      <GlassCard className="qbit-toolbar">
        <div className="qbit-filters">
          {(['all', 'downloading', 'seeding', 'paused', 'error'] as Filter[]).map(f => (
            <button
              key={f}
              className={`qbit-filter-btn${filter === f ? ' qbit-filter-btn--active' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
        <div className={`qbit-bulk-actions${selected.size > 0 ? ' qbit-bulk-actions--visible' : ''}`}>
          <span className="qbit-sel-count">{selected.size > 0 ? `${selected.size} selected` : ''}</span>
          <button className="btn btn-ghost btn-sm" onClick={doPause}><Pause size={13} /> Pause</button>
          <button className="btn btn-ghost btn-sm" onClick={doResume}><Play size={13} /> Resume</button>
          <button className="btn btn-ghost btn-sm qbit-force-btn" onClick={doForceResume} title="Force resume — bypass queue and speed limits">
            <Zap size={13} /> Force
          </button>
          <button className="btn btn-ghost btn-sm qbit-del-btn" onClick={() => openDelete(bulkHashes)}>
            <Trash2 size={13} /> Delete
          </button>
        </div>
      </GlassCard>

      {loading ? (
        <div className="qbit-loading"><span className="spinner" /> Loading torrents…</div>
      ) : err ? (
        <div className="qbit-err">{err}</div>
      ) : filtered.length === 0 ? (
        <div className="qbit-empty">No torrents{filter !== 'all' ? ` in "${filter}"` : ''}</div>
      ) : (
        <GlassCard className="qbit-list-card">
          <table className="qbit-table">
            <thead>
              <tr>
                <th className="qbit-th qbit-th--check">
                  <QbitCheck
                    checked={allSelected}
                    indeterminate={someSelected}
                    onChange={toggleAll}
                    onClick={e => e.stopPropagation()}
                  />
                </th>
                <th className="qbit-th">Name</th>
                <th className="qbit-th qbit-th--num">Size</th>
                <th className="qbit-th qbit-th--prog">Progress</th>
                <th className="qbit-th qbit-th--num">Down</th>
                <th className="qbit-th qbit-th--num">Up</th>
                <th className="qbit-th qbit-th--num">Seeds</th>
                <th className="qbit-th qbit-th--num">Leech</th>
                <th className="qbit-th qbit-th--num">ETA</th>
                <th className="qbit-th qbit-th--status">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(t => {
                const st     = STATES[t.state] ?? { label: t.state, cls: 'qbit-badge--queued' };
                const pct    = Math.round(t.progress * 100);
                const isSel  = selected.has(t.hash);
                const isOpen = detail?.hash === t.hash;
                return (
                  <tr
                    key={t.hash}
                    className={`qbit-row${isSel ? ' qbit-row--selected' : ''}${isOpen ? ' qbit-row--detail' : ''}`}
                    onClick={() => setDetail(isOpen ? null : t)}
                  >
                    <td className="qbit-td qbit-td--check" onClick={e => e.stopPropagation()}>
                      <QbitCheck checked={isSel} onChange={() => toggle(t.hash)} />
                    </td>
                    <td className="qbit-td qbit-td--name" title={t.name}>{t.name}</td>
                    <td className="qbit-td qbit-td--num">{fmtBytes(t.size)}</td>
                    <td className="qbit-td qbit-td--prog">
                      <div className="qbit-prog-wrap">
                        <div className="qbit-prog-bar" style={{ width: `${pct}%` }} />
                        <span className="qbit-prog-label">{pct}%</span>
                      </div>
                    </td>
                    <td className="qbit-td qbit-td--num qbit-td--dl">{t.dlspeed > 0 ? fmtSpeed(t.dlspeed) : '—'}</td>
                    <td className="qbit-td qbit-td--num qbit-td--up">{t.upspeed > 0 ? fmtSpeed(t.upspeed) : '—'}</td>
                    <td className="qbit-td qbit-td--num qbit-td--seeds">{t.num_seeds}</td>
                    <td className="qbit-td qbit-td--num qbit-td--leech">{t.num_leechs}</td>
                    <td className="qbit-td qbit-td--num">{fmtEta(t.eta)}</td>
                    <td className="qbit-td">
                      <span className={`qbit-badge ${st.cls}`}>{st.label}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </GlassCard>
      )}

      {/* Torrent detail drawer */}
      {detail && (() => {
        const t   = detail;
        const st  = STATES[t.state] ?? { label: t.state, cls: 'qbit-badge--queued' };
        const pct = Math.round(t.progress * 100);
        const isPaused  = t.state.toLowerCase().includes('pause');
        const isForced  = t.state.startsWith('forced');
        return (
          <>
            <div className="qbit-drawer-backdrop" onClick={() => setDetail(null)} />
            <div className="qbit-drawer">

              {/* Header */}
              <div className="qbit-drawer__header">
                <span className={`qbit-badge ${st.cls}`}>{st.label}</span>
                <button className="qbit-drawer__close" onClick={() => setDetail(null)} title="Close">
                  <X size={16} />
                </button>
              </div>

              {/* Name */}
              <div className="qbit-drawer__name" title={t.name}>{t.name}</div>

              {/* Progress */}
              <div className="qbit-drawer__prog-area">
                <span className="qbit-drawer__prog-pct">{pct}%</span>
                <div className="qbit-drawer__prog-wrap">
                  <div className="qbit-drawer__prog-bar" style={{ width: `${pct}%` }} />
                </div>
              </div>

              {/* Actions */}
              <div className="qbit-drawer__actions">
                {isPaused ? (
                  <button className="btn btn-ghost btn-sm" onClick={() => singleResume(t.hash)}>
                    <Play size={13} /> Resume
                  </button>
                ) : (
                  <button className="btn btn-ghost btn-sm" onClick={() => singlePause(t.hash)}>
                    <Pause size={13} /> Pause
                  </button>
                )}
                {!isForced && (
                  <button className="btn btn-ghost btn-sm qbit-force-btn" onClick={() => singleForce(t.hash)} title="Force resume — bypass queue and speed limits">
                    <Zap size={13} /> Force
                  </button>
                )}
                <button className="btn btn-ghost btn-sm qbit-del-btn" onClick={() => openDelete([t.hash])}>
                  <Trash2 size={13} /> Delete
                </button>
              </div>

              {/* Stats */}
              <div className="qbit-drawer__body">
                <div className="qbit-drawer__grid">
                  <div className="qbit-drawer__stat">
                    <span className="qbit-drawer__stat-label">Size</span>
                    <span className="qbit-drawer__stat-value">{fmtBytes(t.size)}</span>
                  </div>
                  <div className="qbit-drawer__stat">
                    <span className="qbit-drawer__stat-label">Downloaded</span>
                    <span className="qbit-drawer__stat-value">{fmtBytes(t.downloaded)}</span>
                  </div>
                  <div className="qbit-drawer__stat">
                    <span className="qbit-drawer__stat-label">Uploaded</span>
                    <span className="qbit-drawer__stat-value">{fmtBytes(t.uploaded)}</span>
                  </div>
                  <div className="qbit-drawer__stat">
                    <span className="qbit-drawer__stat-label">Ratio</span>
                    <span className="qbit-drawer__stat-value">{t.ratio.toFixed(2)}</span>
                  </div>
                  <div className="qbit-drawer__stat">
                    <span className="qbit-drawer__stat-label">Seeds</span>
                    <span className="qbit-drawer__stat-value qbit-drawer__stat--seeds">{t.num_seeds}</span>
                  </div>
                  <div className="qbit-drawer__stat">
                    <span className="qbit-drawer__stat-label">Leechers</span>
                    <span className="qbit-drawer__stat-value qbit-drawer__stat--leech">{t.num_leechs}</span>
                  </div>
                  <div className="qbit-drawer__stat">
                    <span className="qbit-drawer__stat-label">DL Speed</span>
                    <span className="qbit-drawer__stat-value qbit-td--dl">{t.dlspeed > 0 ? fmtSpeed(t.dlspeed) : '—'}</span>
                  </div>
                  <div className="qbit-drawer__stat">
                    <span className="qbit-drawer__stat-label">UL Speed</span>
                    <span className="qbit-drawer__stat-value qbit-td--up">{t.upspeed > 0 ? fmtSpeed(t.upspeed) : '—'}</span>
                  </div>
                  <div className="qbit-drawer__stat">
                    <span className="qbit-drawer__stat-label">ETA</span>
                    <span className="qbit-drawer__stat-value">{fmtEta(t.eta)}</span>
                  </div>
                  <div className="qbit-drawer__stat">
                    <span className="qbit-drawer__stat-label">Added</span>
                    <span className="qbit-drawer__stat-value">{fmtDate(t.added_on)}</span>
                  </div>
                  {t.category ? (
                    <div className="qbit-drawer__stat">
                      <span className="qbit-drawer__stat-label">Category</span>
                      <span className="qbit-drawer__stat-value">{t.category}</span>
                    </div>
                  ) : null}
                  {t.tags ? (
                    <div className="qbit-drawer__stat">
                      <span className="qbit-drawer__stat-label">Tags</span>
                      <span className="qbit-drawer__stat-value">{t.tags}</span>
                    </div>
                  ) : null}
                  {t.save_path ? (
                    <div className="qbit-drawer__stat qbit-drawer__stat--full">
                      <span className="qbit-drawer__stat-label">Save path</span>
                      <span className="qbit-drawer__stat-value qbit-drawer__stat-value--path">{t.save_path}</span>
                    </div>
                  ) : null}
                </div>
                <div className="qbit-drawer__hash-block">
                  <span className="qbit-drawer__stat-label">Hash</span>
                  <span className="qbit-drawer__hash-value">{t.hash}</span>
                </div>
              </div>
            </div>
          </>
        );
      })()}

      {/* Delete confirm */}
      {delConfirm && (
        <div
          className="qbit-confirm-overlay"
          onMouseDown={e => { (e.currentTarget as any).__md = e.target === e.currentTarget; }}
          onClick={e => { if (e.target === e.currentTarget && (e.currentTarget as any).__md) setDelConfirm(false); }}
        >
          <div className="qbit-confirm">
            <div className="qbit-confirm__title">Delete {delHashes.length} torrent{delHashes.length !== 1 ? 's' : ''}?</div>
            <label className="qbit-confirm__check">
              <input type="checkbox" checked={delFiles} onChange={e => setDelFiles(e.target.checked)} />
              Also delete downloaded files
            </label>
            <div className="qbit-confirm__actions">
              <button className="btn btn-ghost btn-sm" onClick={() => setDelConfirm(false)}>Cancel</button>
              <button className="btn btn-primary btn-sm qbit-confirm__del" onClick={doDelete}>
                <Trash2 size={13} /> Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
