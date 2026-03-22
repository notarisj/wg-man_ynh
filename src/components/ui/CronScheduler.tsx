import React, { useEffect, useState, useCallback } from 'react';
import { Clock, Save, Info, Loader } from 'lucide-react';
import { GlassCard } from './GlassCard';
import { api, type CronStatus } from '../../lib/api';
import './CronScheduler.css';

// ── Presets ─────────────────────────────────────────────────

type Preset = { label: string; expr: string };

const PRESETS: Preset[] = [
  { label: 'Every 5 min',  expr: '*/5 * * * *'  },
  { label: 'Every 15 min', expr: '*/15 * * * *' },
  { label: 'Every 30 min', expr: '*/30 * * * *' },
  { label: 'Hourly',       expr: '0 * * * *'    },
  { label: 'Every 6 h',   expr: '0 */6 * * *'  },
  { label: 'Custom',       expr: 'custom'        },
];

const DEFAULT_EXPR = '*/5 * * * *';

function describeExpr(expr: string): string {
  switch (expr) {
    case '*/5 * * * *':  return 'Runs vpn-monitor.sh as root every 5 minutes.';
    case '*/15 * * * *': return 'Runs vpn-monitor.sh as root every 15 minutes.';
    case '*/30 * * * *': return 'Runs vpn-monitor.sh as root every 30 minutes.';
    case '0 * * * *':    return 'Runs vpn-monitor.sh as root once per hour.';
    case '0 */6 * * *':  return 'Runs vpn-monitor.sh as root every 6 hours.';
    default:             return `Custom schedule (${expr}) — runs vpn-monitor.sh as root.`;
  }
}

function matchPreset(expr: string): string {
  return PRESETS.find((p) => p.expr === expr)?.expr ?? 'custom';
}

function splitExpr(expr: string): [string, string, string, string, string] {
  const parts = expr.split(/\s+/);
  if (parts.length === 5) return parts as [string, string, string, string, string];
  return ['*', '*', '*', '*', '*'];
}

// ── Component ────────────────────────────────────────────────

export const CronScheduler: React.FC = () => {
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [info, setInfo]         = useState<CronStatus | null>(null);
  const [enabled, setEnabled]   = useState(false);
  const [expr, setExpr]         = useState(DEFAULT_EXPR);
  const [preset, setPreset]     = useState<string>(DEFAULT_EXPR);
  const [fields, setFields]     = useState<[string, string, string, string, string]>(['*', '*', '*', '*', '*']);
  const [dirty, setDirty]       = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);

  const load = useCallback(async () => {
    const res = await api.cron.get();
    if (res.ok) {
      setInfo(res.data);
      setEnabled(res.data.enabled);
      const e = res.data.schedule ?? DEFAULT_EXPR;
      setExpr(e);
      setPreset(matchPreset(e));
      setFields(splitExpr(e));
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const pickPreset = (p: Preset) => {
    setPreset(p.expr);
    if (p.expr !== 'custom') {
      setExpr(p.expr);
      setFields(splitExpr(p.expr));
    }
    setDirty(true);
    setFeedback(null);
  };

  const updateField = (i: number, val: string) => {
    const next = [...fields] as [string, string, string, string, string];
    next[i] = val || '*';
    setFields(next);
    setExpr(next.join(' '));
    setDirty(true);
    setFeedback(null);
  };

  const toggleEnabled = () => {
    setEnabled((e) => !e);
    setDirty(true);
    setFeedback(null);
  };

  const save = async () => {
    setSaving(true);
    setFeedback(null);
    const res = enabled ? await api.cron.set(expr) : await api.cron.disable();
    setSaving(false);
    if (res.ok) {
      setFeedback({ ok: true, msg: enabled ? 'Schedule saved.' : 'Cron job disabled.' });
      setDirty(false);
    } else {
      setFeedback({ ok: false, msg: (res as { ok: false; error: string }).error });
    }
  };

  const isCustom = preset === 'custom';

  return (
    <GlassCard className="settings-card">
      <div className="settings-card__title">
        <Clock size={16} /> Auto-Monitor Schedule
      </div>

      {loading ? (
        <div className="cron-loading">
          <Loader size={14} className="cron-spin" />
          Loading…
        </div>
      ) : (
        <>
          {/* Enable / disable toggle */}
          <div className="settings-row">
            <span className="settings-label">Enable cron job</span>
            <button
              className={`cron-toggle-track${enabled ? ' on' : ''}`}
              onClick={toggleEnabled}
              aria-pressed={enabled}
              aria-label={enabled ? 'Disable cron job' : 'Enable cron job'}
            >
              <span className="cron-toggle-thumb" />
            </button>
          </div>

          {/* Schedule body */}
          <div className={`cron-body${enabled ? '' : ' cron-body--disabled'}`}>
            <div className="cron-section-label">Preset</div>

            <div className="cron-presets">
              {PRESETS.map((p) => (
                <button
                  key={p.expr}
                  className={`cron-preset${preset === p.expr ? ' active' : ''}`}
                  onClick={() => pickPreset(p)}
                  disabled={!enabled}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {isCustom && (
              <div className="cron-custom">
                <div className="cron-section-label">Expression fields</div>
                <div className="cron-fields">
                  {(['Min', 'Hour', 'Day', 'Mon', 'DoW'] as const).map((lbl, i) => (
                    <div className="cron-field" key={lbl}>
                      <label htmlFor={`cron-field-${lbl}`}>{lbl}</label>
                      <input
                        id={`cron-field-${lbl}`}
                        value={fields[i]}
                        onChange={(e) => updateField(i, e.target.value)}
                        disabled={!enabled}
                        maxLength={10}
                        spellCheck={false}
                        autoComplete="off"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="cron-expr">
              <span className="cron-expr__label">Expression</span>
              <code className="cron-expr__value">{expr}</code>
            </div>

            <div className="settings-info">
              <Info size={13} />
              <span>{describeExpr(expr)}</span>
            </div>

            {info && (
              <div className="cron-expr">
                <span className="cron-expr__label">Cron file</span>
                <code className="cron-expr__value">{info.cronFile}</code>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="cron-footer">
            {feedback && (
              <span className={`cron-feedback${feedback.ok ? ' cron-feedback--ok' : ' cron-feedback--err'}`}>
                {feedback.msg}
              </span>
            )}
            <button
              className="btn btn-primary btn-sm"
              onClick={save}
              disabled={saving || !dirty}
            >
              {saving
                ? <><Loader size={12} className="cron-spin" /> Saving…</>
                : <><Save size={12} /> Save</>}
            </button>
          </div>
        </>
      )}
    </GlassCard>
  );
};
