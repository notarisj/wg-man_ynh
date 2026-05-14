import React, { useEffect, useState, useCallback } from 'react';
import { Wifi, RefreshCw, Pause, Play, Trash2, ArrowDown, ArrowUp, ChevronLeft } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { GlassCard } from '../components/ui/GlassCard';
import { api, type QbitTorrent } from '../lib/api';
import './QBittorrent.css';

const STATES: Record<string, { label: string; cls: string }> = {
  downloading:      { label: 'Downloading', cls: 'qbit-badge--dl' },
  stalledDL:        { label: 'Stalled',     cls: 'qbit-badge--stalled' },
  uploading:        { label: 'Seeding',     cls: 'qbit-badge--seed' },
  stalledUP:        { label: 'Seeding',     cls: 'qbit-badge--seed' },
  pausedDL:         { label: 'Paused',      cls: 'qbit-badge--paused' },
  pausedUP:         { label: 'Paused',      cls: 'qbit-badge--paused' },
  queuedDL:         { label: 'Queued',      cls: 'qbit-badge--queued' },
  queuedUP:         { label: 'Queued',      cls: 'qbit-badge--queued' },
  checkingDL:       { label: 'Checking',    cls: 'qbit-badge--checking' },
  checkingUP:       { label: 'Checking',    cls: 'qbit-badge--checking' },
  checkingResumeData: { label: 'Checking',  cls: 'qbit-badge--checking' },
  moving:           { label: 'Moving',      cls: 'qbit-badge--checking' },
  error:            { label: 'Error',       cls: 'qbit-badge--error' },
  missingFiles:     { label: 'Missing',     cls: 'qbit-badge--error' },
};

function fmtBytes(b: number): string {
  if (b === 0) return '0 B';
  const k = 1024, sizes = ['B','KB','MB','GB','TB'];
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

type Filter = 'all' | 'downloading' | 'seeding' | 'paused' | 'error';

export const QBittorrent: React.FC = () => {
  const [torrents, setTorrents]   = useState<QbitTorrent[]>([]);
  const [transfer, setTransfer]   = useState<Record<string, any> | null>(null);
  const [loading, setLoading]     = useState(true);
  const [err, setErr]             = useState<string | null>(null);
  const [spinning, setSpinning]   = useState(false);
  const [selected, setSelected]   = useState<Set<string>>(new Set());
  const [filter, setFilter]       = useState<Filter>('all');
  const [delConfirm, setDelConfirm] = useState(false);
  const [delFiles, setDelFiles]   = useState(false);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [toast, setToast]         = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const load = useCallback(async (spin = false) => {
    if (spin) { setSpinning(true); setTimeout(() => setSpinning(false), 600); }
    const [tRes, trRes] = await Promise.all([api.qbit.torrents(), api.qbit.transfer()]);
    if (!tRes.ok) { setErr(tRes.error); setLoading(false); return; }
    setTorrents(tRes.data);
    if (trRes.ok) setTransfer(trRes.data);
    setErr(null);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, []);

  useEffect(() => {
    const id = setInterval(() => load(), 5000);
    return () => clearInterval(id);
  }, [load]);

  const filtered = torrents.filter((t) => {
    if (filter === 'all') return true;
    if (filter === 'downloading') return t.state.includes('DL') || t.state === 'downloading';
    if (filter === 'seeding') return t.state.includes('UP') || t.state === 'uploading';
    if (filter === 'paused') return t.state.toLowerCase().includes('pause');
    if (filter === 'error') return t.state === 'error' || t.state === 'missingFiles';
    return true;
  });

  const allSelected = filtered.length > 0 && filtered.every((t) => selected.has(t.hash));

  const toggleAll = () => {
    if (allSelected) {
      setSelected((s) => { const n = new Set(s); filtered.forEach((t) => n.delete(t.hash)); return n; });
    } else {
      setSelected((s) => { const n = new Set(s); filtered.forEach((t) => n.add(t.hash)); return n; });
    }
  };

  const toggle = (hash: string) =>
    setSelected((s) => { const n = new Set(s); n.has(hash) ? n.delete(hash) : n.add(hash); return n; });

  const hashes = Array.from(selected);

  const doPause = async () => {
    setActionErr(null);
    const res = await api.qbit.pause(hashes);
    if (!res.ok) { setActionErr(res.error); return; }
    showToast(`Paused ${hashes.length} torrent(s)`);
    setSelected(new Set());
    await load();
  };

  const doResume = async () => {
    setActionErr(null);
    const res = await api.qbit.resume(hashes);
    if (!res.ok) { setActionErr(res.error); return; }
    showToast(`Resumed ${hashes.length} torrent(s)`);
    setSelected(new Set());
    await load();
  };

  const doDelete = async () => {
    setActionErr(null);
    const res = await api.qbit.delete(hashes, delFiles);
    if (!res.ok) { setActionErr(res.error); return; }
    showToast(`Deleted ${hashes.length} torrent(s)${delFiles ? ' + files' : ''}`);
    setSelected(new Set());
    setDelConfirm(false);
    await load();
  };

  const dlSpeed = transfer?.dl_info_speed ?? 0;
  const upSpeed = transfer?.up_info_speed ?? 0;

  return (
    <div className="qbit-page animate-fade-in">
      <div className="qbit-page__header">
        <div className="qbit-page__back-row">
          <NavLink to="/plugins" className="qbit-back-link">
            <ChevronLeft size={15} /> Plugins
          </NavLink>
        </div>
        <div className="qbit-page__title-row">
          <Wifi size={20} className="qbit-page__icon" />
          <div>
            <div className="qbit-page__title">qBittorrent</div>
            <div className="qbit-page__sub">Torrent manager</div>
          </div>
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
      </div>

      {toast && <div className="qbit-toast">{toast}</div>}
      {actionErr && <div className="qbit-action-err">{actionErr}</div>}

      <GlassCard className="qbit-toolbar">
        <div className="qbit-filters">
          {(['all','downloading','seeding','paused','error'] as Filter[]).map((f) => (
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
          <button className="btn btn-ghost btn-sm qbit-del-btn" onClick={() => setDelConfirm(true)}><Trash2 size={13} /> Delete</button>
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
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} />
                </th>
                <th className="qbit-th">Name</th>
                <th className="qbit-th qbit-th--num">Size</th>
                <th className="qbit-th qbit-th--prog">Progress</th>
                <th className="qbit-th qbit-th--num">Down</th>
                <th className="qbit-th qbit-th--num">Up</th>
                <th className="qbit-th qbit-th--num">ETA</th>
                <th className="qbit-th qbit-th--status">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => {
                const st = STATES[t.state] ?? { label: t.state, cls: 'qbit-badge--queued' };
                const pct = Math.round(t.progress * 100);
                const isSel = selected.has(t.hash);
                return (
                  <tr key={t.hash} className={`qbit-row${isSel ? ' qbit-row--selected' : ''}`} onClick={() => toggle(t.hash)}>
                    <td className="qbit-td qbit-td--check" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={isSel} onChange={() => toggle(t.hash)} />
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

      {delConfirm && (
        <div className="qbit-confirm-overlay" onClick={(e) => { if (e.target === e.currentTarget) setDelConfirm(false); }}>
          <div className="qbit-confirm">
            <div className="qbit-confirm__title">Delete {hashes.length} torrent(s)?</div>
            <label className="qbit-confirm__check">
              <input type="checkbox" checked={delFiles} onChange={(e) => setDelFiles(e.target.checked)} />
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
