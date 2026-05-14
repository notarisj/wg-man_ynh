import React, { useEffect, useState, useCallback, type ReactNode } from 'react';
import { RefreshCw, Trash2, RotateCcw, ChevronLeft, AlertCircle, Search, X, ArrowDown, ArrowUp } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { GlassCard } from '../components/ui/GlassCard';
import { type ArrQueueItem, type ArrQueue, type ArrRelease, type ApiResult } from '../lib/api';
import { showToast } from '../lib/toast';
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
  downloading: 'arr-badge--dl',
  paused:      'arr-badge--paused',
  queued:      'arr-badge--queued',
  completed:   'arr-badge--ok',
  failed:      'arr-badge--err',
  warning:     'arr-badge--warn',
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
  fetchQueue:     () => Promise<ApiResult<ArrQueue>>;
  removeItem:     (id: number, removeFromClient: boolean, blocklist: boolean) => Promise<ApiResult<{ ok: boolean }>>;
  rejectItem:     (item: ArrQueueItem) => Promise<ApiResult<{ ok: boolean; searched?: boolean }>>;
  searchReleases: (item: ArrQueueItem) => Promise<ApiResult<ArrRelease[]>>;
  grabRelease:    (guid: string, indexerId: number) => Promise<ApiResult<{ ok: boolean }>>;
}

export const ArrPlugin: React.FC<Props> = ({
  plugin, icon, label,
  fetchQueue, removeItem, rejectItem, searchReleases, grabRelease,
}) => {
  const [queue, setQueue]       = useState<ArrQueueItem[]>([]);
  const [total, setTotal]       = useState(0);
  const [loading, setLoading]   = useState(true);
  const [err, setErr]           = useState<string | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [actionId, setActionId] = useState<number | null>(null);
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [confirmMode, setConfirmMode] = useState<'remove' | 'reject'>('remove');
  const [removeFromClient, setRemoveFromClient] = useState(true);

  // Interactive search state
  const [searchItem, setSearchItem]     = useState<ArrQueueItem | null>(null);
  const [releases, setReleases]         = useState<ArrRelease[] | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchErr, setSearchErr]       = useState<string | null>(null);
  const [grabConfirm, setGrabConfirm]   = useState<ArrRelease | null>(null);
  const [grabbing, setGrabbing]         = useState(false);
  const [releaseFilter, setReleaseFilter] = useState('');

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
    if (!res.ok) { showToast((res as any).error ?? 'Remove failed', 'error'); return; }
    showToast('Removed from queue');
    await load();
  };

  const doReject = async (item: ArrQueueItem) => {
    setActionId(item.id);
    const res = await rejectItem(item);
    setActionId(null);
    setConfirmId(null);
    if (!res.ok) { showToast((res as any).error ?? 'Reject failed', 'error'); return; }
    const searched = (res as any).searched;
    showToast(searched ? 'Blocklisted & searching for alternatives…' : 'Blocklisted — no alternatives found');
    await load();
  };

  const openSearch = async (item: ArrQueueItem) => {
    setSearchItem(item);
    setReleases(null);
    setSearchErr(null);
    setReleaseFilter('');
    setGrabConfirm(null);
    setSearchLoading(true);
    const res = await searchReleases(item);
    setSearchLoading(false);
    if (!res.ok) { setSearchErr(res.error); return; }
    setReleases(res.data);
  };

  const closeSearch = () => {
    setSearchItem(null);
    setReleases(null);
    setGrabConfirm(null);
    setSearchErr(null);
  };

  const doGrab = async () => {
    if (!grabConfirm || !searchItem) return;
    setGrabbing(true);
    const res = await grabRelease(grabConfirm.guid, grabConfirm.indexerId);
    if (!res.ok) {
      setGrabbing(false);
      showToast((res as any).error ?? 'Grab failed', 'error');
      return;
    }
    // Remove the old queue item from the download client
    await removeItem(searchItem.id, true, false);
    setGrabbing(false);
    closeSearch();
    showToast(`Grabbed: ${grabConfirm.title}`);
    await load();
  };

  const openConfirm = (item: ArrQueueItem, mode: 'remove' | 'reject') => {
    setConfirmId(item.id);
    setConfirmMode(mode);
  };

  const confirmItem = queue.find((q) => q.id === confirmId);

  const filteredReleases = releases?.filter((r) =>
    !releaseFilter || r.title.toLowerCase().includes(releaseFilter.toLowerCase())
  );

  return (
    <div className="arr-page animate-fade-in">
      <div className="arr-page__header">
        <NavLink to="/plugins" className="plugin-back-btn" title="Back to Plugins">
          <ChevronLeft size={18} />
        </NavLink>
        <span className="arr-page__icon">{icon}</span>
        <div className="arr-page__title">{label}</div>
        <span className="arr-page__count">
          {loading ? '…' : `${total} item${total !== 1 ? 's' : ''} in queue`}
        </span>
        <button
          className={`btn btn-ghost btn-sm arr-refresh${spinning ? ' spinning' : ''}`}
          onClick={() => load(true)}
          title="Refresh"
        >
          <RefreshCw size={14} />
        </button>
      </div>

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
                  <button
                    className="btn btn-ghost btn-sm arr-btn-search"
                    onClick={() => openSearch(item)}
                    disabled={busy}
                    title="Interactive search — pick a specific release"
                  >
                    <Search size={13} />
                    Interactive Search
                  </button>
                </div>
              </GlassCard>
            );
          })}
        </div>
      )}

      {/* Remove / Reject confirm overlay */}
      {confirmId !== null && confirmItem && (
        <div className="arr-confirm-overlay" onMouseDown={(e) => { (e.currentTarget as any).__md = e.target === e.currentTarget; }} onClick={(e) => { if (e.target === e.currentTarget && (e.currentTarget as any).__md) setConfirmId(null); }}>
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

      {/* Interactive search modal */}
      {searchItem && (
        <div className="arr-search-overlay" onMouseDown={(e) => { (e.currentTarget as any).__md = e.target === e.currentTarget; }} onClick={(e) => { if (e.target === e.currentTarget && (e.currentTarget as any).__md) closeSearch(); }}>
          <div className="arr-search-modal">
            <div className="arr-search-modal__header">
              <div className="arr-search-modal__title">
                <Search size={15} />
                Interactive Search — {itemTitle(searchItem, plugin)}
              </div>
              <button className="scripts-modal__close" onClick={closeSearch}><X size={16} /></button>
            </div>

            <div className="arr-search-modal__toolbar">
              <input
                className="arr-search-filter"
                placeholder="Filter releases…"
                value={releaseFilter}
                onChange={(e) => setReleaseFilter(e.target.value)}
                spellCheck={false}
              />
              {releases && (
                <span className="arr-search-count">
                  {filteredReleases?.length} / {releases.length} release{releases.length !== 1 ? 's' : ''}
                </span>
              )}
            </div>

            <div className="arr-search-modal__body">
              {searchLoading ? (
                <div className="arr-search-loading"><span className="spinner" /> Searching indexers…</div>
              ) : searchErr ? (
                <div className="arr-search-err"><AlertCircle size={14} /> {searchErr}</div>
              ) : releases && filteredReleases?.length === 0 ? (
                <div className="arr-search-empty">No releases found</div>
              ) : (
                <table className="arr-search-table">
                  <thead>
                    <tr>
                      <th className="arr-sth">Title</th>
                      <th className="arr-sth arr-sth--num">Age</th>
                      <th className="arr-sth arr-sth--num">Size</th>
                      <th className="arr-sth arr-sth--num">Peers</th>
                      <th className="arr-sth">Quality</th>
                      <th className="arr-sth">Indexer</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredReleases?.map((r) => {
                      const rejected = r.rejections?.length > 0;
                      const notAllowed = !r.downloadAllowed;
                      const isSelected = grabConfirm?.guid === r.guid;
                      const cls = [
                        'arr-srow',
                        rejected    ? 'arr-srow--rejected' : '',
                        notAllowed  ? 'arr-srow--blocked'  : '',
                        isSelected  ? 'arr-srow--selected' : '',
                      ].filter(Boolean).join(' ');
                      return (
                        <tr
                          key={r.guid}
                          className={cls}
                          onClick={() => !notAllowed && setGrabConfirm(isSelected ? null : r)}
                          title={rejected ? r.rejections.join(' · ') : undefined}
                        >
                          <td className="arr-std arr-std--title">
                            <span className="arr-srow__title">{r.title}</span>
                            {rejected && (
                              <span className="arr-srow__rejections">
                                <AlertCircle size={11} />
                                {r.rejections.slice(0,2).join(' · ')}
                                {r.rejections.length > 2 && ` +${r.rejections.length - 2}`}
                              </span>
                            )}
                          </td>
                          <td className="arr-std arr-std--num">{r.age}d</td>
                          <td className="arr-std arr-std--num">{fmtBytes(r.size)}</td>
                          <td className="arr-std arr-std--num">
                            {r.protocol === 'torrent' ? (
                              <span className="arr-peers">
                                <ArrowDown size={10} className="arr-peers--dl" />{r.seeders ?? '—'}
                                <ArrowUp size={10} className="arr-peers--ul" />{r.leechers ?? '—'}
                              </span>
                            ) : '—'}
                          </td>
                          <td className="arr-std">
                            <span className="arr-badge arr-badge--quality">{r.quality?.quality?.name}</span>
                          </td>
                          <td className="arr-std arr-std--indexer">{r.indexer}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {/* Grab confirm bar */}
            {grabConfirm && (
              <div className="arr-grab-bar">
                <div className="arr-grab-bar__title" title={grabConfirm.title}>
                  Grab: {grabConfirm.title}
                </div>
                <div className="arr-grab-bar__actions">
                  <button className="btn btn-ghost btn-sm" onClick={() => setGrabConfirm(null)}>Cancel</button>
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={doGrab}
                    disabled={grabbing}
                  >
                    {grabbing ? <span className="spinner spinner-sm" /> : <ArrowDown size={13} />}
                    Grab & replace
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
