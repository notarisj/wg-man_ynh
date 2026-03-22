import React, { useEffect, useState } from 'react';
import { History as HistoryIcon, Wifi, WifiOff, ArrowLeftRight, RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react';
import { useVpnStore } from '../store/vpnStore';
import { GlassCard } from '../components/ui/GlassCard';
import type { VpnHistoryEvent } from '../lib/api';
import './History.css';

// ── Period config ──────────────────────────────────────────────

export type Period = '24h' | '7d' | '30d' | 'all';

export const PERIOD_OPTIONS: { value: Period; label: string; windowMs: number | null; segments: number }[] = [
  { value: '24h', label: '24 Hours', windowMs: 24 * 3_600_000,      segments: 96 },
  { value: '7d',  label: '7 Days',   windowMs: 7 * 24 * 3_600_000,  segments: 84 },
  { value: '30d', label: '30 Days',  windowMs: 30 * 24 * 3_600_000, segments: 90 },
  { value: 'all', label: 'All Time', windowMs: null,                 segments: 96 },
];

export function getWindowMs(period: Period, events: VpnHistoryEvent[]): number {
  const opt = PERIOD_OPTIONS.find(p => p.value === period)!;
  if (opt.windowMs !== null) return opt.windowMs;
  // 'all': span from earliest event to now
  if (!events.length) return 24 * 3_600_000;
  const earliest = events[events.length - 1].ts; // newest-first → last = oldest
  return Math.max(Date.now() - earliest, 3_600_000);
}

export function getSegments(period: Period): number {
  return PERIOD_OPTIONS.find(p => p.value === period)!.segments;
}

export function periodStartLabel(period: Period, events: VpnHistoryEvent[]): string {
  if (period === '24h')  return '24h ago';
  if (period === '7d')   return '7 days ago';
  if (period === '30d')  return '30 days ago';
  if (!events.length) return 'No data';
  const ms = getWindowMs('all', events);
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  if (days >= 1) return `${days}d ago`;
  return `${hours}h ago`;
}

export function periodMidLabel(period: Period, events: VpnHistoryEvent[]): string {
  if (period === '24h')  return '12h ago';
  if (period === '7d')   return '3.5 days ago';
  if (period === '30d')  return '15 days ago';
  const ms = getWindowMs('all', events);
  const halfDays = Math.floor(ms / 2 / 86_400_000);
  const halfHours = Math.floor((ms / 2 % 86_400_000) / 3_600_000);
  if (halfDays >= 1) return `${halfDays}d ago`;
  return `${halfHours}h ago`;
}

// ── Timeline helpers ───────────────────────────────────────────

function getStateAtTime(events: VpnHistoryEvent[], t: number): 'connected' | 'disconnected' | 'unknown' {
  for (const e of events) { // newest-first
    if (e.ts <= t) return e.type === 'disconnected' ? 'disconnected' : 'connected';
  }
  return 'unknown';
}

export function buildTimeline(
  events: VpnHistoryEvent[],
  windowMs = 24 * 3_600_000,
  segments = 96,
): Array<'connected' | 'disconnected' | 'unknown'> {
  const now = Date.now();
  const segMs = windowMs / segments;
  return Array.from({ length: segments }, (_, i) => {
    const mid = now - (segments - i - 0.5) * segMs;
    return getStateAtTime(events, mid);
  });
}

export function calcUptime(timeline: Array<'connected' | 'disconnected' | 'unknown'>): number | null {
  const known = timeline.filter(s => s !== 'unknown');
  if (!known.length) return null;
  return Math.round((known.filter(s => s === 'connected').length / known.length) * 100);
}

// ── Formatting ─────────────────────────────────────────────────

function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`;
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return m ? `${h}h ${m}m` : `${h}h`;
}

function formatTs(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function withDuration(events: VpnHistoryEvent[]) {
  const now = Date.now();
  return events.map((e, i) => ({
    ...e,
    durationMs: (i === 0 ? now : events[i - 1].ts) - e.ts,
  }));
}

// ── Sub-components ─────────────────────────────────────────────

function formatSegTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export const UptimeBar: React.FC<{
  timeline: Array<'connected' | 'disconnected' | 'unknown'>;
  events: VpnHistoryEvent[];
  windowMs: number;
  segments: number;
}> = ({ timeline, events, windowMs, segments }) => {
  const [hovered, setHovered] = useState<number | null>(null);
  const segMs = windowMs / segments;
  const now = Date.now();

  const getSegData = (i: number) => {
    const segEnd   = now - (segments - i - 1) * segMs;
    const segStart = segEnd - segMs;
    const segEvents = events.filter(e => e.ts >= segStart && e.ts < segEnd);
    return { segStart, segEnd, segEvents };
  };

  return (
    <div className="uptime-bar-wrap">
      <div className="uptime-bar">
        {timeline.map((state, i) => (
          <div
            key={i}
            className={`uptime-bar__seg uptime-bar__seg--${state}`}
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
          />
        ))}
      </div>

      {hovered !== null && (() => {
        const { segStart, segEnd, segEvents } = getSegData(hovered);
        const leftPct = ((hovered + 0.5) / segments) * 100;
        return (
          <div
            className="uptime-seg-popover"
            style={{ left: `clamp(100px, ${leftPct}%, calc(100% - 100px))` }}
          >
            <div className="uptime-seg-popover__time">
              {formatSegTime(segStart)} – {formatSegTime(segEnd)}
            </div>
            {segEvents.length === 0 ? (
              <div className="uptime-seg-popover__empty">No events in this period</div>
            ) : (
              <div className="uptime-seg-popover__events">
                {segEvents.map((e, j) => (
                  <div key={j} className="uptime-seg-popover__event">
                    <span className={`uptime-seg-popover__dot uptime-seg-popover__dot--${e.type}`} />
                    <span className="uptime-seg-popover__label">
                      {e.type.charAt(0).toUpperCase() + e.type.slice(1)}
                    </span>
                    {e.config && (
                      <span className="uptime-seg-popover__config">{e.config}</span>
                    )}
                    <span className="uptime-seg-popover__ts">{formatSegTime(e.ts)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
};

const EventBadge: React.FC<{ type: VpnHistoryEvent['type'] }> = ({ type }) => {
  const map = {
    connected:    { label: 'Connected',    cls: 'badge--connected' },
    disconnected: { label: 'Disconnected', cls: 'badge--disconnected' },
    switched:     { label: 'Switched',     cls: 'badge--switched' },
  };
  const { label, cls } = map[type];
  return <span className={`event-badge ${cls}`}>{label}</span>;
};

type Filter = 'all' | VpnHistoryEvent['type'];

// ── Page ───────────────────────────────────────────────────────

const PAGE_SIZE = 10;

export const History: React.FC = () => {
  const { vpnHistory, fetchHistory, isLoadingHistory } = useVpnStore();
  const [filter, setFilter] = useState<Filter>('all');
  const [period, setPeriod] = useState<Period>('24h');
  const [page, setPage]     = useState(1);

  // Reset to page 1 when filter or period changes
  useEffect(() => { setPage(1); }, [filter, period]);

  useEffect(() => { fetchHistory(); }, []);

  const windowMs  = getWindowMs(period, vpnHistory);
  const segments  = getSegments(period);
  const timeline  = buildTimeline(vpnHistory, windowMs, segments);
  const uptime    = calcUptime(timeline);

  // Events within the selected period
  const cutoff = Date.now() - windowMs;
  const periodEvents = period === 'all'
    ? vpnHistory
    : vpnHistory.filter(e => e.ts >= cutoff);

  const latest       = vpnHistory[0];
  const currentState = latest ? (latest.type === 'disconnected' ? 'disconnected' : 'connected') : null;
  const currentSince = latest ? Date.now() - latest.ts : null;

  const periodConnected = periodEvents.filter(e => e.type !== 'disconnected').length;

  const allWithDuration = withDuration(vpnHistory);
  const periodAll = allWithDuration.filter(e => period === 'all' || e.ts >= cutoff);
  const typeCounts = {
    all:          periodAll.length,
    connected:    periodAll.filter(e => e.type === 'connected').length,
    switched:     periodAll.filter(e => e.type === 'switched').length,
    disconnected: periodAll.filter(e => e.type === 'disconnected').length,
  };
  const displayed = periodAll.filter(e => filter === 'all' || e.type === filter);
  const totalPages = Math.max(1, Math.ceil(displayed.length / PAGE_SIZE));
  const safePage   = Math.min(page, totalPages);
  const paginated  = displayed.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const uptimeLabel = PERIOD_OPTIONS.find(p => p.value === period)!.label + ' Uptime';

  return (
    <div className="history-page animate-fade-in">

      {/* ── Header ── */}
      <div className="history-header">
        <div className="history-header__title">
          <HistoryIcon size={20} />
          Connection History
        </div>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => fetchHistory()}
          disabled={isLoadingHistory}
        >
          {isLoadingHistory ? <span className="spinner spinner-sm" /> : <RefreshCw size={13} />}
          Refresh
        </button>
      </div>

      {/* ── Stats row ── */}
      <div className="history-stats">
        <GlassCard className="history-stat">
          <div className="history-stat__label">{uptimeLabel}</div>
          <div className="history-stat__value" style={{ color: uptime !== null && uptime >= 80 ? 'var(--clr-green)' : 'var(--clr-amber)' }}>
            {uptime !== null ? `${uptime}%` : '—'}
          </div>
        </GlassCard>
        <GlassCard className="history-stat">
          <div className="history-stat__label">Current State</div>
          <div className="history-stat__value" style={{ color: currentState === 'connected' ? 'var(--clr-green)' : currentState === 'disconnected' ? 'var(--clr-red)' : 'var(--clr-text-muted)' }}>
            {currentState === 'connected' ? 'Connected' : currentState === 'disconnected' ? 'Disconnected' : '—'}
          </div>
          {currentSince !== null && (
            <div className="history-stat__sub">for {formatDuration(currentSince)}</div>
          )}
        </GlassCard>
        <GlassCard className="history-stat">
          <div className="history-stat__label">Events in Period</div>
          <div className="history-stat__value">{periodEvents.length}</div>
          <div className="history-stat__sub">{periodConnected} connections</div>
        </GlassCard>
        <GlassCard className="history-stat">
          <div className="history-stat__label">Active Config</div>
          <div className="history-stat__value history-stat__value--config">
            {currentState === 'connected' && latest?.config ? latest.config : '—'}
          </div>
        </GlassCard>
      </div>

      {/* ── Timeline ── */}
      <GlassCard className="history-timeline-card">
        <div className="history-timeline-header">
          <span className="history-timeline-title">Timeline</span>
          <div className="history-period-tabs">
            {PERIOD_OPTIONS.map(opt => (
              <button
                key={opt.value}
                className={`history-period-tab${period === opt.value ? ' active' : ''}`}
                onClick={() => setPeriod(opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <div className="history-timeline-legend">
            <span className="legend-dot legend-dot--connected" /> Connected
            <span className="legend-dot legend-dot--disconnected" /> Disconnected
            <span className="legend-dot legend-dot--unknown" /> No data
          </div>
        </div>
        <UptimeBar timeline={timeline} events={vpnHistory} windowMs={windowMs} segments={segments} />
        <div className="history-timeline-labels">
          <span>{periodStartLabel(period, vpnHistory)}</span>
          <span>{periodMidLabel(period, vpnHistory)}</span>
          <span>Now</span>
        </div>
      </GlassCard>

      {/* ── Event list ── */}
      <GlassCard className="history-events-card">
        <div className="history-events-header">
          <div className="history-filter-tabs">
            {(['all', 'connected', 'switched', 'disconnected'] as Filter[]).map(f => (
              <button
                key={f}
                className={`history-filter-tab${filter === f ? ' active' : ''}`}
                onClick={() => setFilter(f)}
              >
                {`${f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)} (${typeCounts[f]})`}
              </button>
            ))}
          </div>
          <span className="history-events-period-note">
            {period !== 'all' ? `Showing events in last ${PERIOD_OPTIONS.find(p => p.value === period)!.label.toLowerCase()}` : 'Showing all recorded events'}
          </span>
        </div>

        {isLoadingHistory ? (
          <div className="history-events-empty"><span className="spinner spinner-sm" /> Loading…</div>
        ) : displayed.length === 0 ? (
          <div className="history-events-empty">No events in this period.</div>
        ) : (
          <>
            <div className="history-events-list">
              {paginated.map((e, i) => (
                <div key={i} className="history-event">
                  <div className="history-event__icon">
                    {e.type === 'connected'    && <Wifi size={15} style={{ color: 'var(--clr-green)' }} />}
                    {e.type === 'disconnected' && <WifiOff size={15} style={{ color: 'var(--clr-red)' }} />}
                    {e.type === 'switched'     && <ArrowLeftRight size={15} style={{ color: 'var(--clr-amber)' }} />}
                  </div>
                  <div className="history-event__body">
                    <div className="history-event__top">
                      <EventBadge type={e.type} />
                      {e.config && <span className="history-event__config">{e.config}</span>}
                    </div>
                    {e.endpoint && <div className="history-event__endpoint">{e.endpoint}</div>}
                  </div>
                  <div className="history-event__meta">
                    <div className="history-event__ts">{formatTs(e.ts)}</div>
                    <div className="history-event__duration">{formatDuration(e.durationMs)}</div>
                  </div>
                </div>
              ))}
            </div>
            {totalPages > 1 && (
              <div className="history-pagination">
                <button
                  className="history-pagination__btn"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={safePage === 1}
                >
                  <ChevronLeft size={14} />
                </button>
                <span className="history-pagination__info">
                  {safePage} / {totalPages}
                </span>
                <button
                  className="history-pagination__btn"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={safePage === totalPages}
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            )}
          </>
        )}
      </GlassCard>
    </div>
  );
};
