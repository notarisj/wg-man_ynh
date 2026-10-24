import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Upload, ArrowLeft, ArrowRight, CheckCircle2, XCircle, Circle, AlertTriangle,
  RotateCcw, ChevronDown, ChevronRight, ShieldCheck, FileArchive,
} from 'lucide-react';
import { GlassCard } from '../components/ui/GlassCard';
import { PasskeyPrompt } from '../components/ui/PasskeyPrompt';
import { api, healthz } from '../lib/api';
import type { ImportSummary, MigrationPlan, MigrationStatus, RelayState } from '../lib/api';
import { showToast } from '../lib/toast';
import './Migrate.css';

type Step = 'upload' | 'review' | 'plan' | 'run';

const STEPS: { id: Step; label: string }[] = [
  { id: 'upload', label: 'Upload' },
  { id: 'review', label: 'Review' },
  { id: 'plan',   label: 'Changes' },
  { id: 'run',    label: 'Migrate' },
];

const DEAD: RelayState[] = ['offline', 'removed', 'outdated'];
const FINISHED = ['done', 'failed', 'rolled_back'];
const POLL_MS = 2000;
const RECENT_S = 30 * 60;
const RELOAD_KEY = 'migrate-reloaded-at';

/** Reload at most once a minute, so a lasting error cannot loop. */
function reloadOnce(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
    if (Date.now() - last < 60_000) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch { /* storage unavailable: reload anyway */ }
  window.location.reload();
  return true;
}

export const Migrate: React.FC = () => {
  const navigate = useNavigate();
  const fileInput = useRef<HTMLInputElement>(null);

  const [step, setStep]             = useState<Step>('upload');
  const [available, setAvailable]   = useState<{ ok: boolean; reason: string | null } | null>(null);
  const [busy, setBusy]             = useState<string | null>(null);
  const [error, setError]           = useState<string | null>(null);
  const [dragging, setDragging]     = useState(false);

  const [summary, setSummary]       = useState<ImportSummary | null>(null);
  const [selected, setSelected]     = useState<Set<string>>(new Set());
  const [plan, setPlan]             = useState<MigrationPlan | null>(null);
  const [openDiffs, setOpenDiffs]   = useState<Set<string>>(new Set());

  const [migId, setMigId]           = useState<string | null>(null);
  const [status, setStatus]         = useState<MigrationStatus | null>(null);
  const [pollFailed, setPollFailed] = useState(false);
  const [showLog, setShowLog]       = useState(false);
  const [showPasskey, setShowPasskey] = useState(false);

  // Reattach to a migration that is still running (page reload, wg-man restart)
  useEffect(() => {
    api.migrate.current().then((res) => {
      if (!res.ok) return;
      setAvailable(res.data.available);
      // Also show a recent result: wg-man restarts at the end of a migration,
      // which ends the session, so the result is usually seen after a reload.
      const latest = res.data.latest;
      const recent = latest?.finishedAt && Date.now() / 1000 - latest.finishedAt < RECENT_S;
      if (latest && (!FINISHED.includes(latest.state) || recent)) {
        setMigId(latest.id);
        setStep('run');
      }
    });
  }, []);

  // Poll progress while migrating; tolerate the gap while wg-man restarts
  useEffect(() => {
    if (step !== 'run' || !migId) return;
    let stopped = false;
    let failures = 0;
    const tick = async () => {
      const res = await api.migrate.status(migId);
      if (stopped) return;
      if (!res.ok) {
        // wg-man restarts at the end of a migration and the session goes with
        // it. Once it answers again, reload: the passkey gate signs the user
        // back in and this page reopens on the result.
        setPollFailed(true);
        if (++failures >= 2 && await healthz() && !stopped) reloadOnce();
        return;
      }
      failures = 0;
      setPollFailed(false);
      setStatus(res.data);
      const st = res.data.progress?.state;
      if (st && FINISHED.includes(st) && !res.data.running) stopped = true;
    };
    tick();
    const t = setInterval(() => { if (!stopped) tick(); }, POLL_MS);
    return () => { stopped = true; clearInterval(t); };
  }, [step, migId]);

  // ── Upload ────────────────────────────────────────────────────

  const handleFiles = async (list: FileList | null) => {
    const files = list ? Array.from(list) : [];
    if (!files.length) return;
    if (!files.every((f) => /\.(zip|conf)$/i.test(f.name))) {
      setError('Choose the Mullvad .zip, or one or more .conf files');
      return;
    }
    setError(null);
    setBusy('Reading configs…');
    const res = await api.migrate.upload(files);
    setBusy(null);
    if (fileInput.current) fileInput.current.value = '';
    if (!res.ok) { setError(res.error); return; }
    setSummary(res.data);
    // Preselect every config whose server is usable
    setSelected(new Set(res.data.configs.filter((c) => !c.relay || !DEAD.includes(c.relay.status)).map((c) => c.name)));
    setPlan(null);
    setStep('review');
  };

  // ── Review ────────────────────────────────────────────────────

  const locations = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const c of summary?.configs ?? []) m.set(c.location, [...(m.get(c.location) ?? []), c.name]);
    return [...m.entries()];
  }, [summary]);

  const toggle = (names: string[], on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const n of names) { if (on) next.add(n); else next.delete(n); }
      return next;
    });
  };

  const goPlan = async () => {
    if (!summary) return;
    setError(null);
    setBusy('Working out what changes…');
    const res = await api.migrate.plan(summary.id, [...selected], true);
    setBusy(null);
    if (!res.ok) { setError(res.error); return; }
    setPlan(res.data);
    setOpenDiffs(new Set());
    setStep('plan');
  };

  // ── Start ─────────────────────────────────────────────────────

  const start = useCallback(async () => {
    setShowPasskey(false);
    if (!summary) return;
    setError(null);
    setBusy('Starting…');
    const res = await api.migrate.apply(summary.id);
    setBusy(null);
    if (!res.ok) { setError(res.error); showToast(res.error, 'error'); return; }
    setStatus(null);
    setMigId(summary.id);
    setStep('run');
  }, [summary]);

  const restart = () => {
    setSummary(null); setPlan(null); setStatus(null); setMigId(null);
    setSelected(new Set()); setError(null); setStep('upload');
  };

  // ── Render helpers ────────────────────────────────────────────

  const stepIndex = STEPS.findIndex((s) => s.id === step);
  const progress = status?.progress ?? null;
  const changedFiles = plan?.files.filter((f) => f.what.length) ?? [];
  const unchangedFiles = plan?.files.filter((f) => !f.what.length && !f.missing) ?? [];
  const missingFiles = plan?.files.filter((f) => f.missing) ?? [];

  const relayBadge = (s?: RelayState) => s && s !== 'online'
    ? <span className={`migrate-badge migrate-badge--${s}`}>{s}</span>
    : null;

  const stepIcon = (s: string) => {
    if (s === 'ok')      return <CheckCircle2 size={16} className="migrate-step__icon--ok" />;
    if (s === 'failed')  return <XCircle size={16} className="migrate-step__icon--failed" />;
    if (s === 'running') return <span className="spinner spinner-sm" />;
    return <Circle size={16} className="migrate-step__icon--pending" />;
  };

  return (
    <div className="migrate-page animate-fade-in">

      {/* Stepper */}
      <ol className="migrate-stepper">
        {STEPS.map((s, i) => (
          <li key={s.id} className={`migrate-stepper__item${i === stepIndex ? ' active' : ''}${i < stepIndex ? ' done' : ''}`}>
            <span className="migrate-stepper__num">{i < stepIndex ? <CheckCircle2 size={14} /> : i + 1}</span>
            {s.label}
          </li>
        ))}
      </ol>

      {available && !available.ok && (
        <div className="migrate-alert migrate-alert--error"><AlertTriangle size={15} /> {available.reason}</div>
      )}
      {error && <div className="migrate-alert migrate-alert--error"><AlertTriangle size={15} /> {error}</div>}

      {/* ── 1. Upload ───────────────────────────────────────── */}
      {step === 'upload' && (
        <GlassCard className="migrate-card">
          <h2 className="migrate-card__title">Import new WireGuard configs</h2>
          <p className="migrate-card__text">
            In your Mullvad account, open <b>WireGuard configuration</b>, choose <b>Linux</b>, generate a key
            (or pick a device), choose a country or city and download the zip. Drop it here. wg-man rewrites the
            configs for this server, updates the kill switch, DNS and qBittorrent for the new tunnel address,
            reconnects and checks every app — and puts everything back if any step fails.
          </p>
          <div
            className={`migrate-drop${dragging ? ' migrate-drop--over' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files); }}
            onClick={() => fileInput.current?.click()}
            role="button"
            tabIndex={0}
          >
            {busy ? <span className="spinner" /> : <FileArchive size={32} />}
            <span>{busy ?? 'Drop the Mullvad .zip here, or click to choose'}</span>
            <span className="migrate-drop__hint">.zip, or one or more .conf files</span>
            <input
              ref={fileInput}
              type="file"
              accept=".zip,.conf"
              multiple
              hidden
              onChange={(e) => handleFiles(e.target.files)}
            />
          </div>
        </GlassCard>
      )}

      {/* ── 2. Review ───────────────────────────────────────── */}
      {step === 'review' && summary && (
        <>
          <GlassCard className="migrate-card">
            <h2 className="migrate-card__title">What changes</h2>
            <div className="migrate-compare">
              <div className="migrate-compare__head" />
              <div className="migrate-compare__head">Now</div>
              <div className="migrate-compare__head">After</div>

              <div className="migrate-compare__label">Device</div>
              <div>{summary.current.device ?? '—'}</div>
              <div className={summary.sameDevice ? '' : 'migrate-compare__changed'}>{summary.device ?? '—'}</div>

              <div className="migrate-compare__label">Tunnel address</div>
              <div className="mono">{summary.current.ip4 || '—'}</div>
              <div className={`mono${summary.current.ip4 !== summary.ip4 ? ' migrate-compare__changed' : ''}`}>{summary.ip4}</div>

              <div className="migrate-compare__label">Configs</div>
              <div><span className="mono">{summary.current.pattern}</span> ({summary.current.count})</div>
              <div className="migrate-compare__changed">{selected.size} selected</div>

            </div>
          </GlassCard>

          {(summary.errors.length > 0 || summary.warnings.length > 0 || summary.relayError) && (
            <div className="migrate-notes">
              {summary.errors.map((e) => <div key={e} className="migrate-alert migrate-alert--error"><XCircle size={15} /> {e}</div>)}
              {summary.warnings.map((w) => <div key={w} className="migrate-alert migrate-alert--warn"><AlertTriangle size={15} /> {w}</div>)}
              {summary.relayError && <div className="migrate-alert migrate-alert--warn"><AlertTriangle size={15} /> {summary.relayError}</div>}
            </div>
          )}

          {summary.configs.length > 0 && (
            <GlassCard className="migrate-card">
              <div className="migrate-card__row">
                <h2 className="migrate-card__title">Configs to install</h2>
                <div className="migrate-chips">
                  {locations.map(([loc, names]) => {
                    const on = names.filter((n) => selected.has(n)).length;
                    return (
                      <button
                        key={loc}
                        className={`migrate-chip${on ? ' migrate-chip--on' : ''}`}
                        onClick={() => toggle(names, on < names.length)}
                        title={on < names.length ? 'Select all in this location' : 'Deselect this location'}
                      >
                        {loc} <span>{on}/{names.length}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <p className="migrate-card__hint">Servers Mullvad lists as offline or removed are left out by default.</p>
              <div className="migrate-configs">
                {summary.configs.map((c) => (
                  <label key={c.name} className={`migrate-config${selected.has(c.name) ? '' : ' migrate-config--off'}`} title={c.relay?.detail}>
                    <input type="checkbox" checked={selected.has(c.name)} onChange={(e) => toggle([c.name], e.target.checked)} />
                    <span className="mono">{c.name}</span>
                    {relayBadge(c.relay?.status)}
                  </label>
                ))}
              </div>
              {summary.skipped.length > 0 && (
                <p className="migrate-card__hint">
                  Skipped: {summary.skipped.map((s) => `${s.name} (${s.reason})`).join(', ')}
                </p>
              )}
            </GlassCard>
          )}

          <div className="migrate-actions">
            <button className="btn btn-ghost btn-sm" onClick={restart}><ArrowLeft size={14} /> Start over</button>
            <button
              className="btn btn-primary btn-sm"
              onClick={goPlan}
              disabled={!!busy || summary.errors.length > 0 || selected.size === 0 || available?.ok === false}
            >
              {busy ? <span className="spinner spinner-sm" /> : <ArrowRight size={14} />}
              {busy ?? 'Next: review changes'}
            </button>
          </div>
        </>
      )}

      {/* ── 3. Plan ─────────────────────────────────────────── */}
      {step === 'plan' && plan && summary && (
        <>
          <GlassCard className="migrate-card">
            <h2 className="migrate-card__title">The migration will</h2>
            <ol className="migrate-plan">
              <li>Back up every file it touches to <span className="mono">/root/wg-man-migrations/</span></li>
              <li>Pause {[...plan.pauseUnits, ...plan.stopUnits].join(', ') || 'nothing'} — torrenting stops for about a minute</li>
              <li>
                Install {plan.configs.install.length} configs (<span className="mono">{plan.new.pattern}</span>)
                {plan.configs.archive.length > 0 && <> and move the {plan.configs.archive.length} old ones to an archive folder in /etc/wireguard</>}
              </li>
              <li>Update {changedFiles.length} file{changedFiles.length !== 1 ? 's' : ''} for the new tunnel address{plan.current.dns !== plan.new.dns ? ', DNS' : ''}{plan.current.pattern !== plan.new.pattern ? ' and config names' : ''}{plan.ynhSetting ? ' (and the YunoHost app setting)' : ''}</li>
              <li>Connect to <span className="mono">{plan.tryOrder[0]}</span> (falls back to the next config if it does not answer)</li>
              <li>Rebuild DNS routing, restart the apps and the monitor</li>
              <li>Check that {plan.verifyUsers.length ? plan.verifyUsers.join(', ') : 'the apps'} exit through Mullvad</li>
            </ol>
            <p className="migrate-card__hint"><RotateCcw size={12} /> If any step fails, everything is restored and the previous VPN config reconnected.</p>
          </GlassCard>

          <GlassCard className="migrate-card">
            <h2 className="migrate-card__title">File changes</h2>
            {changedFiles.length === 0 && <p className="migrate-card__hint">No settings change — only the config files are replaced.</p>}
            {changedFiles.map((f) => {
              const open = openDiffs.has(f.path);
              return (
                <div key={f.path} className="migrate-file">
                  <button
                    className="migrate-file__head"
                    onClick={() => setOpenDiffs((prev) => { const n = new Set(prev); if (open) n.delete(f.path); else n.add(f.path); return n; })}
                  >
                    {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    <span className="mono">{f.path}</span>
                    <span className="migrate-file__what">{f.what.join(', ')}</span>
                  </button>
                  {open && (
                    <pre className="migrate-diff">
                      {f.diff.filter((l) => !l.startsWith('---') && !l.startsWith('+++')).map((l, i) => (
                        <span key={i} className={l.startsWith('+') ? 'add' : l.startsWith('-') ? 'del' : l.startsWith('@@') ? 'hdr' : ''}>{l}{'\n'}</span>
                      ))}
                    </pre>
                  )}
                </div>
              );
            })}
            {unchangedFiles.length > 0 && (
              <p className="migrate-card__hint">Checked, no change needed: {unchangedFiles.map((f) => f.path).join(', ')}</p>
            )}
            {missingFiles.length > 0 && (
              <p className="migrate-card__hint">Not present on this server: {missingFiles.map((f) => f.path).join(', ')}</p>
            )}
          </GlassCard>

          <div className="migrate-actions">
            <button className="btn btn-ghost btn-sm" onClick={() => setStep('review')} disabled={!!busy}><ArrowLeft size={14} /> Back</button>
            <button className="btn btn-primary btn-sm" onClick={() => setShowPasskey(true)} disabled={!!busy}>
              {busy ? <span className="spinner spinner-sm" /> : <ShieldCheck size={14} />}
              {busy ?? 'Start migration'}
            </button>
          </div>
        </>
      )}

      {/* ── 4. Run ──────────────────────────────────────────── */}
      {step === 'run' && (
        <>
          <GlassCard className="migrate-card">
            <div className="migrate-card__row">
              <h2 className="migrate-card__title">
                {!progress || progress.state === 'running' ? 'Migrating…'
                  : progress.state === 'rolling_back' ? 'Something failed — rolling back…'
                  : progress.state === 'done' ? 'Migration complete'
                  : progress.state === 'rolled_back' ? 'Migration failed — previous setup restored'
                  : 'Migration failed'}
              </h2>
            </div>
            {pollFailed && (
              <div className="migrate-alert migrate-alert--warn">
                <AlertTriangle size={15} />
                wg-man is restarting to load the new configs. This page reloads by itself once it is
                back — sign in again with your passkey to see the result.
              </div>
            )}
            <ol className="migrate-steps">
              {(progress?.steps ?? []).map((s) => (
                <li key={s.id} className={`migrate-step migrate-step--${s.status}`}>
                  {stepIcon(s.status)}
                  <span className="migrate-step__label">{s.label}</span>
                  {s.detail && <span className="migrate-step__detail">{s.detail}</span>}
                </li>
              ))}
              {!progress && <li className="migrate-step"><span className="spinner spinner-sm" /> Starting…</li>}
            </ol>
          </GlassCard>

          {progress && progress.verify.length > 0 && (
            <GlassCard className="migrate-card">
              <h2 className="migrate-card__title">App exit check</h2>
              <div className="migrate-verify">
                {progress.verify.map((v) => (
                  <div key={v.user} className="migrate-verify__row">
                    {v.ok ? <CheckCircle2 size={14} className="migrate-step__icon--ok" /> : <XCircle size={14} className="migrate-step__icon--failed" />}
                    <span className="mono">{v.user}</span>
                    <span className="migrate-step__detail">{v.detail}</span>
                  </div>
                ))}
              </div>
            </GlassCard>
          )}

          {progress?.state === 'done' && (
            <GlassCard className="migrate-card migrate-card--ok">
              <h2 className="migrate-card__title">You are on the new configs</h2>
              <p className="migrate-card__text">
                Connected to <b className="mono">{progress.result.connected}</b> with tunnel address{' '}
                <b className="mono">{progress.result.newIp4}</b>. wg-man restarts once to load the new config names.
              </p>
              <p className="migrate-card__text">
                <b>Last step:</b> if you no longer need the old device, revoke it in your Mullvad account so its key stops working.
              </p>
              <p className="migrate-card__hint">
                Backup: <span className="mono">{progress.result.backup}</span>
                {progress.result.archive && <> · old configs: <span className="mono">{progress.result.archive}</span></>}
              </p>
            </GlassCard>
          )}

          {progress && ['rolled_back', 'failed'].includes(progress.state) && (
            <GlassCard className="migrate-card migrate-card--bad">
              <h2 className="migrate-card__title">What happened</h2>
              <p className="migrate-card__text">{progress.steps.find((s) => s.status === 'failed')?.detail ?? 'See the log below.'}</p>
              {progress.rollback && (
                <p className="migrate-card__text">
                  {progress.rollback.ok ? 'All files were restored.' : 'Some rollback steps failed — see the log.'}{' '}
                  {progress.rollback.reconnected
                    ? <>Reconnected to <span className="mono">{progress.rollback.reconnected}</span>.</>
                    : progress.rollback.reconnected === null
                      ? 'The previous config did not reconnect either (expired account?). The kill switch keeps the torrent apps offline until a working config is active.'
                      : null}
                </p>
              )}
            </GlassCard>
          )}

          {progress && progress.log.length > 0 && (
            <GlassCard className="migrate-card">
              <button className="migrate-file__head" onClick={() => setShowLog((v) => !v)}>
                {showLog ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Log ({progress.log.length} lines)
              </button>
              {showLog && <pre className="migrate-diff migrate-log">{progress.log.join('\n')}</pre>}
            </GlassCard>
          )}

          {progress && FINISHED.includes(progress.state) && (
            <div className="migrate-actions">
              <button className="btn btn-ghost btn-sm" onClick={restart}><Upload size={14} /> Import other configs</button>
              <button className="btn btn-primary btn-sm" onClick={() => navigate('/configs')}>Go to Configs <ArrowRight size={14} /></button>
            </div>
          )}
        </>
      )}

      {showPasskey && (
        <PasskeyPrompt mode="authenticate" onSuccess={start} onCancel={() => setShowPasskey(false)} />
      )}
    </div>
  );
};
