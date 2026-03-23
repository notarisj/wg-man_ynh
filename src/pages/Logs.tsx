import React, { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import { ScrollText, RefreshCw, ChevronsDown, Pause, Play, Search, X, ChevronUp, ChevronDown, Check } from 'lucide-react';
import { useVpnStore } from '../store/vpnStore';
import './Logs.css';

function classifyLine(line: string): string {
  if (line.includes('SUCCESS') || line.includes('is now active')) return 'success';
  if (line.includes('CRITICAL')) return 'critical';
  if (line.includes('FAILED') || line.includes('ERROR')) return 'error';
  if (line.includes('ACTION') || line.includes('TRIGGER')) return 'warn';
  return 'info';
}

type LogLevel = 'all' | 'info' | 'warn' | 'error' | 'critical' | 'success';

const LEVEL_OPTIONS: { value: LogLevel; label: string }[] = [
  { value: 'all',      label: 'All levels' },
  { value: 'success',  label: 'Success' },
  { value: 'error',    label: 'Error' },
  { value: 'critical', label: 'Critical' },
  { value: 'warn',     label: 'Warning' },
  { value: 'info',     label: 'Info' },
];

const LINE_OPTIONS = [
  { value: 50,  label: 'Last 50' },
  { value: 150, label: 'Last 150' },
  { value: 300, label: 'Last 300' },
  { value: 500, label: 'Last 500' },
];

const LOAD_MORE_STEP = 150;
const MAX_LINE_COUNT = 2000;
const SCROLL_THRESHOLD = 80; // px from top to trigger load-more

export const Logs: React.FC = () => {
  const { logs, fetchLogs, searchLogs, searchResults, isSearching } = useVpnStore();
  const [autoScroll, setAutoScroll] = useState(true);
  const [liveRefresh, setLiveRefresh] = useState(true);
  const [lineCount, setLineCount] = useState(150);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [levelDropdownOpen, setLevelDropdownOpen] = useState(false);
  const [levelFilter, setLevelFilter] = useState<LogLevel>('all');
  const [search, setSearch] = useState('');
  const [loadingMore, setLoadingMore] = useState(false);
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const [reachedBeginning, setReachedBeginning] = useState(false);

  const dropdownRef = useRef<HTMLDivElement>(null);
  const levelDropdownRef = useRef<HTMLDivElement>(null);
  const terminalBodyRef = useRef<HTMLDivElement>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const loadMoreSessionRef = useRef<{ prevCount: number; prevScrollHeight: number; requestedCount: number } | null>(null);
  const lineCountRef = useRef(lineCount);
  const logsLengthRef = useRef(logs.length);
  const searchRef = useRef(search);
  const reachedBeginningRef = useRef(reachedBeginning);
  const autoScrollRef = useRef(autoScroll);

  // Keep refs in sync so callbacks have stable references without stale closures
  useEffect(() => { lineCountRef.current = lineCount; }, [lineCount]);
  useEffect(() => { logsLengthRef.current = logs.length; }, [logs]);
  useEffect(() => { searchRef.current = search; }, [search]);
  useEffect(() => { reachedBeginningRef.current = reachedBeginning; }, [reachedBeginning]);
  useEffect(() => { autoScrollRef.current = autoScroll; }, [autoScroll]);

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setDropdownOpen(false);
      if (levelDropdownRef.current && !levelDropdownRef.current.contains(e.target as Node)) setLevelDropdownOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Debounced server-side search
  useEffect(() => {
    if (!search.trim()) {
      searchLogs('');
      return;
    }
    const t = setTimeout(() => searchLogs(search), 350);
    return () => clearTimeout(t);
  }, [search]);

  // Detect whether we've reached the beginning of the log file
  useEffect(() => {
    setReachedBeginning(logs.length > 0 && logs.length < lineCount);
  }, [logs, lineCount]);

  // Fetch on mount + lineCount change
  useEffect(() => { fetchLogs(lineCount); }, [lineCount]);

  // Live refresh interval
  useEffect(() => {
    if (liveRefresh) {
      intervalRef.current = setInterval(() => fetchLogs(lineCount), 4000);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [liveRefresh, lineCount]);

  // Scroll to bottom when search is cleared or when new search results arrive (once, no auto-scroll after)
  useLayoutEffect(() => {
    const el = terminalBodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [search, searchResults]);

  // Scroll management: restore position after load-more, or auto-scroll to bottom
  useLayoutEffect(() => {
    const el = terminalBodyRef.current;
    if (!el || logs.length === 0) return;

    const session = loadMoreSessionRef.current;
    if (session) {
      // Only commit scroll restoration once the load-more fetch actually delivered new lines.
      // If a live-refresh fires first (logs.length unchanged), we skip and keep waiting.
      if (logs.length > session.prevCount) {
        // New lines arrived — restore scroll position to avoid jump
        el.scrollTop = el.scrollHeight - session.prevScrollHeight;
        loadMoreSessionRef.current = null;
        setLoadingMore(false);
      } else if (logs.length < session.requestedCount) {
        // Server returned fewer lines than requested → we're at the beginning
        loadMoreSessionRef.current = null;
        setLoadingMore(false);
      }
      // Otherwise a live-refresh fired but count didn't change yet — keep waiting
      return;
    }

    if (autoScroll && !searchRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [logs, autoScroll]);

  // Trigger load-more when scrolled near the top; toggle auto-scroll based on position
  const handleScroll = useCallback(() => {
    const el = terminalBodyRef.current;
    if (!el) return;

    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
    if (atBottom && !autoScrollRef.current) {
      setAutoScroll(true);
    } else if (!atBottom && autoScrollRef.current && !loadMoreSessionRef.current) {
      setAutoScroll(false);
    }

    if (searchRef.current || reachedBeginningRef.current || loadMoreSessionRef.current || lineCountRef.current >= MAX_LINE_COUNT) return;
    if (el.scrollTop < SCROLL_THRESHOLD) {
      const requestedCount = Math.min(lineCountRef.current + LOAD_MORE_STEP, MAX_LINE_COUNT);
      loadMoreSessionRef.current = { prevCount: logsLengthRef.current, prevScrollHeight: el.scrollHeight, requestedCount };
      setLoadingMore(true);
      setLineCount(requestedCount);
    }
  }, []);

  const orderedLogs = [...logs].reverse(); // chronological (oldest first → scroll to bottom for newest)
  // When searching: use server results (already newest-first from grep); otherwise show loaded logs
  const baseLogs = search ? (searchResults ?? []) : orderedLogs;
  const displayLogs = levelFilter === 'all' ? baseLogs : baseLogs.filter(l => classifyLine(l) === levelFilter);

  return (
    <div className="logs-page animate-fade-in">
      {/* Toolbar */}
      <div className="logs-toolbar">
        <div className="logs-toolbar__left">
          <span className="logs-toolbar__count">
            {search
              ? `${displayLogs.length} results`
              : levelFilter !== 'all'
              ? `${displayLogs.length} / ${logs.length} lines`
              : `${logs.length} lines`}
          </span>
          <div className="page-search">
            <Search size={14} className="page-search__icon" />
            <input
              type="text"
              className="page-search__input"
              placeholder="Search logs…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button className="page-search__clear" onClick={() => setSearch('')} aria-label="Clear search">
                <X size={12} />
              </button>
            )}
          </div>
          <div className="logs-select" ref={dropdownRef}>
            <button
              className="logs-select__trigger"
              onClick={() => setDropdownOpen((v) => !v)}
              aria-haspopup="listbox"
              aria-expanded={dropdownOpen}
            >
              {LINE_OPTIONS.find((o) => o.value === lineCount)?.label ?? `Last ${lineCount}`}
              <ChevronDown size={13} className={`logs-select__chevron${dropdownOpen ? ' open' : ''}`} />
            </button>
            {dropdownOpen && (
              <div className="logs-select__menu" role="listbox">
                {LINE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    className={`logs-select__option${opt.value === lineCount ? ' selected' : ''}`}
                    role="option"
                    aria-selected={opt.value === lineCount}
                    onClick={() => { setLineCount(opt.value); setDropdownOpen(false); }}
                  >
                    {opt.label}
                    {opt.value === lineCount && <Check size={12} />}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="logs-select" ref={levelDropdownRef}>
            <button
              className={`logs-select__trigger${levelFilter !== 'all' ? ' logs-select__trigger--active' : ''}`}
              onClick={() => setLevelDropdownOpen((v) => !v)}
              aria-haspopup="listbox"
              aria-expanded={levelDropdownOpen}
            >
              {LEVEL_OPTIONS.find((o) => o.value === levelFilter)?.label ?? 'All levels'}
              <ChevronDown size={13} className={`logs-select__chevron${levelDropdownOpen ? ' open' : ''}`} />
            </button>
            {levelDropdownOpen && (
              <div className="logs-select__menu" role="listbox">
                {LEVEL_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    className={`logs-select__option${opt.value === levelFilter ? ' selected' : ''} logs-select__option--${opt.value}`}
                    role="option"
                    aria-selected={opt.value === levelFilter}
                    onClick={() => { setLevelFilter(opt.value); setLevelDropdownOpen(false); }}
                  >
                    {opt.value !== 'all' && <span className={`log-level-dot log-level-dot--${opt.value}`} />}
                    {opt.label}
                    {opt.value === levelFilter && <Check size={12} />}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="logs-toolbar__right">
          <button
            id="btn-live-toggle"
            className={`btn btn-sm ${liveRefresh ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setLiveRefresh((v) => !v)}
            title={liveRefresh ? 'Pause live refresh' : 'Start live refresh'}
          >
            {liveRefresh ? <Pause size={13} /> : <Play size={13} />}
            {liveRefresh ? 'Live' : 'Paused'}
          </button>
          <button
            id="btn-refresh-logs"
            className="btn btn-ghost btn-sm"
            onClick={async () => {
              setManualRefreshing(true);
              await fetchLogs(lineCount);
              setTimeout(() => setManualRefreshing(false), 600);
            }}
            disabled={manualRefreshing}
          >
            <RefreshCw size={13} className={manualRefreshing ? 'spinning' : ''} />
            Refresh
          </button>
          <button
            className={`btn btn-sm ${autoScroll ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setAutoScroll((v) => !v)}
            title="Toggle auto-scroll"
          >
            <ChevronsDown size={13} />
            {autoScroll ? 'Auto-scroll on' : 'Auto-scroll off'}
          </button>
        </div>
      </div>

      {/* Terminal window */}
      <div className="logs-terminal">
        <div className="logs-terminal__bar">
          <div className="logs-terminal__dots">
            <span className="logs-terminal__dot red" />
            <span className="logs-terminal__dot amber" />
            <span className="logs-terminal__dot green" />
          </div>
          <span className="logs-terminal__title">
            <ScrollText size={12} /> /var/log/vpn-monitor.log
          </span>
          {liveRefresh && (
            <span className="logs-terminal__live">
              <span className="dot dot-green" style={{ width: 6, height: 6 }} /> LIVE
            </span>
          )}
        </div>
        <div className="logs-terminal__body" ref={terminalBodyRef} onScroll={handleScroll}>
          {/* Load-more indicator at the top */}
          {loadingMore && (
            <div className="logs-load-more">
              <span className="spinner spinner-sm" /> Loading older entries…
            </div>
          )}
          {!search && reachedBeginning && !loadingMore && (
            <div className="logs-load-more logs-load-more--end">
              <ChevronUp size={12} /> Beginning of log
            </div>
          )}
          {!search && !loadingMore && !reachedBeginning && logs.length > 0 && lineCount < MAX_LINE_COUNT && (
            <div className="logs-load-more logs-load-more--hint">
              Scroll up to load older entries
            </div>
          )}

          {search && (isSearching || searchResults === null) ? (
            <div className="logs-terminal__empty">
              <span className="spinner spinner-sm" /> Searching…
            </div>
          ) : displayLogs.length === 0 ? (
            <div className="logs-terminal__empty">
              {search ? `No results for "${search}".` : 'No log entries found.'}
            </div>
          ) : (
            displayLogs.map((line, i) => {
              const cls = classifyLine(line);
              return (
                <div key={i} className={`log-line log-line--${cls}`}>
                  <span className="log-line__num">{i + 1}</span>
                  <span className="log-line__text">{line}</span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
