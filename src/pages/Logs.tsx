import React, { useEffect, useRef, useState } from 'react';
import { ScrollText, RefreshCw, ChevronsDown, Pause, Play, ChevronDown, Check } from 'lucide-react';
import { useVpnStore } from '../store/vpnStore';
import './Logs.css';

function classifyLine(line: string): string {
  if (line.includes('SUCCESS') || line.includes('is now active')) return 'success';
  if (line.includes('CRITICAL')) return 'critical';
  if (line.includes('FAILED') || line.includes('ERROR')) return 'error';
  if (line.includes('ACTION') || line.includes('TRIGGER')) return 'warn';
  return 'info';
}

const LINE_OPTIONS = [
  { value: 50,  label: 'Last 50' },
  { value: 150, label: 'Last 150' },
  { value: 300, label: 'Last 300' },
  { value: 500, label: 'Last 500' },
];

export const Logs: React.FC = () => {
  const { logs, fetchLogs, isLoadingLogs } = useVpnStore();
  const [autoScroll, setAutoScroll] = useState(true);
  const [liveRefresh, setLiveRefresh] = useState(true);
  const [lineCount, setLineCount] = useState(150);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Fetch immediately on mount + on lineCount change
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

  // Auto-scroll to bottom
  useEffect(() => {
    if (autoScroll && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll]);

  // Show logs in chronological order (newest last for log view)
  const orderedLogs = [...logs].reverse();

  return (
    <div className="logs-page animate-fade-in">
      {/* Toolbar */}
      <div className="logs-toolbar">
        <div className="logs-toolbar__left">
          <span className="logs-toolbar__count">{logs.length} lines</span>
          <div className="logs-select" ref={dropdownRef}>
            <button
              className="logs-select__trigger"
              onClick={() => setDropdownOpen((v) => !v)}
              aria-haspopup="listbox"
              aria-expanded={dropdownOpen}
            >
              {LINE_OPTIONS.find((o) => o.value === lineCount)?.label}
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
            {isLoadingLogs ? <span className="spinner spinner-sm" /> : <RefreshCw size={13} />}
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
        <div className="logs-terminal__body">
          {orderedLogs.length === 0 ? (
            <div className="logs-terminal__empty">No log entries found.</div>
          ) : (
            orderedLogs.map((line, i) => {
              const cls = classifyLine(line);
              return (
                <div key={i} className={`log-line log-line--${cls}`}>
                  <span className="log-line__num">{i + 1}</span>
                  <span className="log-line__text">{line}</span>
                </div>
              );
            })
          )}
          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  );
};
