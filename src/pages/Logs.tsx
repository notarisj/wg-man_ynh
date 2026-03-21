import React, { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import { ScrollText, RefreshCw, ChevronsDown, Pause, Play, Search, X, ChevronUp } from 'lucide-react';
import { useVpnStore } from '../store/vpnStore';
import './Logs.css';

function classifyLine(line: string): string {
  if (line.includes('SUCCESS') || line.includes('is now active')) return 'success';
  if (line.includes('CRITICAL')) return 'critical';
  if (line.includes('FAILED') || line.includes('ERROR')) return 'error';
  if (line.includes('ACTION') || line.includes('TRIGGER')) return 'warn';
  return 'info';
}

const LOAD_MORE_STEP = 150;
const MAX_LINE_COUNT = 2000;
const SCROLL_THRESHOLD = 80; // px from top to trigger load-more

export const Logs: React.FC = () => {
  const { logs, fetchLogs, isLoadingLogs, searchLogs, searchResults, isSearching } = useVpnStore();
  const [autoScroll, setAutoScroll] = useState(true);
  const [liveRefresh, setLiveRefresh] = useState(true);
  const [lineCount, setLineCount] = useState(150);
  const [search, setSearch] = useState('');
  const [loadingMore, setLoadingMore] = useState(false);
  const [reachedBeginning, setReachedBeginning] = useState(false);

  const terminalBodyRef = useRef<HTMLDivElement>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const loadMoreSessionRef = useRef<{ prevCount: number; prevScrollHeight: number; requestedCount: number } | null>(null);
  const lineCountRef = useRef(lineCount);
  const logsLengthRef = useRef(logs.length);
  const searchRef = useRef(search);
  const reachedBeginningRef = useRef(reachedBeginning);

  // Keep refs in sync so callbacks have stable references without stale closures
  useEffect(() => { lineCountRef.current = lineCount; }, [lineCount]);
  useEffect(() => { logsLengthRef.current = logs.length; }, [logs]);
  useEffect(() => { searchRef.current = search; }, [search]);
  useEffect(() => { reachedBeginningRef.current = reachedBeginning; }, [reachedBeginning]);

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

  // Trigger load-more when scrolled near the top
  const handleScroll = useCallback(() => {
    const el = terminalBodyRef.current;
    if (!el || searchRef.current || reachedBeginningRef.current || loadMoreSessionRef.current || lineCountRef.current >= MAX_LINE_COUNT) return;
    if (el.scrollTop < SCROLL_THRESHOLD) {
      const requestedCount = Math.min(lineCountRef.current + LOAD_MORE_STEP, MAX_LINE_COUNT);
      loadMoreSessionRef.current = { prevCount: logsLengthRef.current, prevScrollHeight: el.scrollHeight, requestedCount };
      setLoadingMore(true);
      setLineCount(requestedCount);
    }
  }, []);

  const orderedLogs = [...logs].reverse(); // chronological (oldest first → scroll to bottom for newest)
  // When searching: use server results (already newest-first from grep); otherwise show loaded logs
  const displayLogs = search ? (searchResults ?? []) : orderedLogs;

  return (
    <div className="logs-page animate-fade-in">
      {/* Toolbar */}
      <div className="logs-toolbar">
        <div className="logs-toolbar__left">
          <span className="logs-toolbar__count">
            {search ? `${displayLogs.length} results` : `${logs.length} lines`}
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
            onClick={() => fetchLogs(lineCount)}
            disabled={isLoadingLogs}
          >
            {isLoadingLogs && !loadingMore ? <span className="spinner spinner-sm" /> : <RefreshCw size={13} />}
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
