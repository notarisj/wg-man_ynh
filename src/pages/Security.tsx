import React, { useEffect, useState } from 'react';
import { ShieldCheck, ShieldAlert, ShieldX, CheckCircle2, XCircle, AlertTriangle, Play } from 'lucide-react';
import { GlassCard } from '../components/ui/GlassCard';
import { api } from '../lib/api';
import type { SecurityReport, SecurityStatus } from '../lib/api';
import { showToast } from '../lib/toast';
import './Security.css';

const ORDER: Record<SecurityStatus, number> = { fail: 0, warn: 1, pass: 2 };

const StatusIcon: React.FC<{ status: SecurityStatus; size?: number }> = ({ status, size = 15 }) =>
  status === 'pass' ? <CheckCircle2 size={size} className="security-icon--pass" />
  : status === 'warn' ? <AlertTriangle size={size} className="security-icon--warn" />
  : <XCircle size={size} className="security-icon--fail" />;

export const Security: React.FC = () => {
  const [report, setReport]       = useState<SecurityReport | null>(null);
  const [available, setAvailable] = useState<{ ok: boolean; reason: string | null } | null>(null);
  const [running, setRunning]     = useState(false);
  const [loaded, setLoaded]       = useState(false);

  useEffect(() => {
    api.security.last().then((res) => {
      if (res.ok) { setReport(res.data.report); setAvailable(res.data.available); }
      setLoaded(true);
    });
  }, []);

  const run = async () => {
    setRunning(true);
    const res = await api.security.run();
    setRunning(false);
    if (!res.ok) { showToast(res.error, 'error'); return; }
    setReport(res.data.report);
    const { fail, warn } = res.data.report.counts;
    showToast(fail ? `${fail} check(s) failed` : warn ? `Passed with ${warn} warning(s)` : 'All checks passed',
              fail ? 'error' : undefined);
  };

  const state: SecurityStatus | null = report
    ? (report.counts.fail ? 'fail' : report.counts.warn ? 'warn' : 'pass') : null;
  const groups = report ? [...report.groups].sort((a, b) => ORDER[a.status] - ORDER[b.status]) : [];

  return (
    <div className="security-page animate-fade-in">
      <GlassCard className={`security-summary${state ? ` security-summary--${state}` : ''}`}>
        <div className="security-summary__icon">
          {state === 'pass' ? <ShieldCheck size={34} /> : state === 'warn' ? <ShieldAlert size={34} />
            : state === 'fail' ? <ShieldX size={34} /> : <ShieldCheck size={34} />}
        </div>
        <div className="security-summary__body">
          <h2 className="security-summary__title">
            {!report ? 'Download stack security check'
              : state === 'pass' ? 'Everything is behind the VPN'
              : state === 'warn' ? 'Behind the VPN, with warnings'
              : 'Problems found'}
          </h2>
          <p className="security-summary__text">
            {report
              ? <>{report.counts.pass} passed · {report.counts.warn} warning{report.counts.warn !== 1 ? 's' : ''} · {report.counts.fail} failed — checked {new Date(report.checkedAt * 1000).toLocaleString()} in {(report.durationMs / 1000).toFixed(1)} s</>
              : 'A read-only test: as each app user it checks routing, the exit IP, DNS, the kill switch rules, tries to bypass the tunnel, and inspects every live connection. Nothing is changed or restarted.'}
          </p>
          {report?.host.ip && (
            <p className="security-summary__hint">
              This server's own connection: {report.host.country ?? '?'} ({report.host.mullvad ? 'Mullvad' : 'your ISP'}) — the apps must never appear with this address.
            </p>
          )}
        </div>
        <button className="btn btn-primary btn-sm" onClick={run} disabled={running || available?.ok === false}>
          {running ? <span className="spinner spinner-sm" /> : <Play size={14} />}
          {running ? 'Checking…' : report ? 'Run again' : 'Run check'}
        </button>
      </GlassCard>

      {available && !available.ok && (
        <div className="security-alert"><AlertTriangle size={15} /> {available.reason}</div>
      )}
      {loaded && !report && !running && available?.ok !== false && (
        <p className="security-empty">No check has run yet. It takes about 10 seconds.</p>
      )}

      <div className="security-grid">
        {groups.map((g) => (
          <GlassCard key={g.id} className={`security-group security-group--${g.status}`}>
            <div className="security-group__head">
              <StatusIcon status={g.status} size={16} />
              <span className="security-group__title">{g.title}</span>
            </div>
            <ul className="security-checks">
              {g.checks.map((c) => (
                <li key={c.name} className={`security-check security-check--${c.status}`}>
                  <StatusIcon status={c.status} size={13} />
                  <div>
                    <div className="security-check__name">{c.name}</div>
                    {c.detail && <div className="security-check__detail">{c.detail}</div>}
                  </div>
                </li>
              ))}
            </ul>
          </GlassCard>
        ))}
      </div>
    </div>
  );
};
