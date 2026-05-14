import React, { useEffect, useState, useCallback, useRef } from 'react';
import ReactDOM from 'react-dom';
import {
  Terminal, Plus, RefreshCw, Pencil, Trash2, Play, Clock,
  AlertCircle, CheckCircle2, X, Save, RotateCcw, ShieldCheck,
  Loader, FileText,
} from 'lucide-react';
import CodeMirror from '@uiw/react-codemirror';
import { StreamLanguage } from '@codemirror/language';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { GlassCard } from '../components/ui/GlassCard';
import { PasskeyPrompt } from '../components/ui/PasskeyPrompt';
import { api } from '../lib/api';
import type { UserScriptWithCron, UserScript, UserCronStatus, PasskeyStatus } from '../lib/api';
import { openModal, closeModal } from '../lib/modalManager';
import './Scripts.css';

// ── CodeMirror bash theme (same as ScriptEditor) ─────────────────────────────

const bashLang = StreamLanguage.define(shell);

const appThemeBase = EditorView.theme({
  '&': { backgroundColor: '#0b0e13', color: '#abb2bf' },
  '.cm-content': { caretColor: '#22c55e' },
  '.cm-cursor': { borderLeftColor: '#22c55e' },
  '.cm-selectionBackground, ::selection': { backgroundColor: 'rgba(34,197,94,0.18) !important' },
  '.cm-gutters': { backgroundColor: '#080b0f', color: '#3d4451', borderRight: '1px solid #151820' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent' },
  '.cm-scroller': { fontFamily: "'JetBrains Mono', monospace" },
}, { dark: true });

const appHighlight = HighlightStyle.define([
  { tag: t.comment,                      color: '#4b5263', fontStyle: 'italic' },
  { tag: t.keyword,                      color: '#c678dd' },
  { tag: t.operator,                     color: '#56b6c2' },
  { tag: [t.string, t.special(t.brace)], color: '#98c379' },
  { tag: t.number,                       color: '#d19a66' },
  { tag: t.variableName,                 color: '#e06c75' },
  { tag: t.definition(t.variableName),   color: '#e5c07b' },
  { tag: t.meta,                         color: '#61afef' },
  { tag: t.punctuation,                  color: '#abb2bf' },
]);

const cmTheme = [appThemeBase, syntaxHighlighting(appHighlight)];

// ── Cron helpers ─────────────────────────────────────────────────────────────

type Preset = { label: string; expr: string };

const PRESETS: Preset[] = [
  { label: 'Every 5 min',  expr: '*/5 * * * *'  },
  { label: 'Every 15 min', expr: '*/15 * * * *' },
  { label: 'Every 30 min', expr: '*/30 * * * *' },
  { label: 'Hourly',       expr: '0 * * * *'    },
  { label: 'Every 6 h',   expr: '0 */6 * * *'  },
  { label: '@reboot',      expr: '@reboot'       },
  { label: '@daily',       expr: '@daily'        },
  { label: '@weekly',      expr: '@weekly'       },
  { label: '@monthly',     expr: '@monthly'      },
  { label: 'Custom',       expr: 'custom'        },
];

const DEFAULT_EXPR = '*/5 * * * *';

function matchPreset(expr: string): string {
  return PRESETS.find((p) => p.expr === expr)?.expr ?? 'custom';
}

// ── Script Editor Modal ───────────────────────────────────────────────────────

interface ScriptEditorModalProps {
  /** null = create new */
  editId: string | null;
  onSaved: (script: UserScript) => void;
  onCancel: () => void;
}

const NEW_TEMPLATE = `#!/bin/bash
# My custom script
set -euo pipefail

echo "Script running at $(date)"
`;

const ScriptEditorModal: React.FC<ScriptEditorModalProps> = ({ editId, onSaved, onCancel }) => {
  const isNew = editId === null;

  const [name, setName]               = useState('');
  const [originalName, setOriginalName]   = useState('');
  const [logFile, setLogFile]             = useState('');
  const [originalLogFile, setOriginalLogFile] = useState('');
  const [content, setContent]         = useState(NEW_TEMPLATE);
  const [original, setOriginal]       = useState(NEW_TEMPLATE);
  const [loading, setLoading]         = useState(!isNew);
  const [validating, setValidating]   = useState(false);
  const [saving, setSaving]           = useState(false);
  const [syntaxError, setSyntaxError] = useState<string | null>(null);
  const [saveError, setSaveError]     = useState<string | null>(null);
  const [saved, setSaved]             = useState(false);
  const [showPasskey, setShowPasskey] = useState(false);

  // Cron section state
  const [cronInfo, setCronInfo]     = useState<UserCronStatus | null>(null);
  const [cronEnabled, setCronEnabled] = useState(false);
  const [cronExpr, setCronExpr]     = useState(DEFAULT_EXPR);
  const [cronPreset, setCronPreset] = useState<string>(DEFAULT_EXPR);
  const [cronDelay, setCronDelay]   = useState(0);
  const [cronDirty, setCronDirty]   = useState(false);
  const [cronSaving, setCronSaving] = useState(false);
  const [cronFeedback, setCronFeedback] = useState<{ ok: boolean; msg: string } | null>(null);
  const [showCronPasskey, setShowCronPasskey] = useState(false);

  useEffect(() => {
    if (!isNew && editId) {
      api.scripts.get(editId).then((res) => {
        if (res.ok) {
          setName(res.data.script.name);
          setOriginalName(res.data.script.name);
          setLogFile(res.data.script.logFile ?? '');
          setOriginalLogFile(res.data.script.logFile ?? '');
          setContent(res.data.content);
          setOriginal(res.data.content);
          const cron = res.data.cron;
          setCronInfo(cron);
          setCronEnabled(cron.enabled);
          setCronDelay(cron.delay ?? 0);
          const e = cron.schedule ?? DEFAULT_EXPR;
          setCronExpr(e);
          setCronPreset(matchPreset(e));
        } else {
          setSaveError(res.error);
        }
        setLoading(false);
      });
    }
  }, [editId, isNew]);

  const isDirty = content !== original || logFile !== originalLogFile || name !== originalName;

  const handleSaveClick = useCallback(async () => {
    setSyntaxError(null);
    setSaveError(null);
    if (!name.trim()) { setSaveError('Script name is required'); return; }
    setValidating(true);
    const res = await api.scripts.validate(content);
    setValidating(false);
    if (!res.ok) { setSaveError(res.error); return; }
    if (res.data && !res.data.ok) { setSyntaxError(res.data.error ?? 'Syntax error'); return; }
    setShowPasskey(true);
  }, [name, content, editId, isNew]);

  const doSave = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    const lf = logFile.trim() || undefined;
    if (isNew) {
      const res = await api.scripts.create(name.trim(), content, lf);
      setSaving(false);
      if (!res.ok) { setSaveError(res.error); return; }
      setSaved(true);
      onSaved(res.data.script);
    } else if (editId) {
      const res = await api.scripts.update(editId, { name: name.trim(), content, logFile: logFile.trim() });
      setSaving(false);
      if (!res.ok) { setSaveError(res.error); return; }
      setOriginal(content);
      setOriginalName(name.trim());
      setOriginalLogFile(logFile.trim());
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      onSaved({ id: editId, name: name.trim(), createdAt: 0, updatedAt: Date.now() });
    }
  }, [isNew, editId, name, content, logFile, onSaved]);

  const onPasskeySuccess = useCallback(async () => {
    setShowPasskey(false);
    await doSave();
  }, [doSave]);

  // Cron handlers
  const pickPreset = (p: Preset) => {
    setCronPreset(p.expr);
    if (p.expr !== 'custom') setCronExpr(p.expr);
    setCronDirty(true);
    setCronFeedback(null);
  };

  const saveCron = useCallback(async () => {
    if (!editId) return;
    setCronSaving(true);
    setCronFeedback(null);
    const res = cronEnabled
      ? await api.scripts.setCron(editId, cronExpr, cronDelay)
      : await api.scripts.disableCron(editId);
    setCronSaving(false);
    if (res.ok) {
      setCronFeedback({ ok: true, msg: cronEnabled ? 'Schedule saved.' : 'Cron job disabled.' });
      setCronDirty(false);
    } else {
      setCronFeedback({ ok: false, msg: (res as { ok: false; error: string }).error });
    }
  }, [editId, cronEnabled, cronExpr]);

  const onCronPasskeySuccess = useCallback(async () => {
    setShowCronPasskey(false);
    await saveCron();
  }, [saveCron]);

  const isCustomCron = cronPreset === 'custom';
  const isBusy = validating || saving;
  const overlayRef = useRef<HTMLDivElement>(null);

  return ReactDOM.createPortal(
    <div
      className="scripts-modal-overlay"
      ref={overlayRef}
      onMouseDown={(e) => { (overlayRef.current as any).__md = e.target === e.currentTarget; }}
      onClick={(e) => { if (e.target === e.currentTarget && (overlayRef.current as any).__md) onCancel(); }}
    >
      <div className="scripts-modal animate-slide-up">
        <div className="scripts-modal__header">
          <span className="scripts-modal__title">
            <Terminal size={15} /> {isNew ? 'New Script' : 'Edit Script'}
          </span>
          <button className="scripts-modal__close" onClick={onCancel}><X size={16} /></button>
        </div>

        <div className="scripts-modal__body">
          {/* Name */}
          <div className="scripts-modal__name-row">
            <label className="scripts-modal__label">Name</label>
            <input
              className="scripts-modal__name-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-backup-script"
              spellCheck={false}
              disabled={loading}
            />
          </div>

          {/* Log file */}
          <div className="scripts-modal__name-row">
            <label className="scripts-modal__label scripts-modal__label--icon">
              <FileText size={12} /> Log
            </label>
            <input
              className="scripts-modal__name-input"
              value={logFile}
              onChange={(e) => setLogFile(e.target.value)}
              placeholder="/var/log/my-script.log  (optional — leave empty to capture stdout)"
              spellCheck={false}
              disabled={loading}
            />
          </div>

          {saveError && (
            <div className="scripts-modal__error">
              <AlertCircle size={13} /> {saveError}
            </div>
          )}
          {syntaxError && (
            <div className="scripts-modal__syntax-error">
              <AlertCircle size={13} />
              <pre className="scripts-modal__syntax-pre">{syntaxError}</pre>
            </div>
          )}

          {/* Editor */}
          {loading ? (
            <div className="scripts-modal__loading"><span className="spinner" /> Loading…</div>
          ) : (
            <div className="scripts-modal__cm-wrap">
              <CodeMirror
                value={content}
                onChange={(val) => { setContent(val); setSyntaxError(null); setSaved(false); }}
                extensions={[bashLang, ...cmTheme]}
                theme="dark"
                height="460px"
                basicSetup={{
                  lineNumbers: true, foldGutter: false,
                  autocompletion: false, highlightActiveLine: false,
                  highlightActiveLineGutter: false,
                }}
              />
            </div>
          )}

          {/* Script actions */}
          <div className="scripts-modal__actions">
            <button
              className="btn btn-primary btn-sm"
              onClick={handleSaveClick}
              disabled={isBusy || (!isDirty && !isNew)}
            >
              {saving ? <span className="spinner spinner-sm" />
               : validating ? <span className="spinner spinner-sm" />
               : saved ? <CheckCircle2 size={13} />
               : <Save size={13} />}
              {saving ? 'Saving…' : validating ? 'Validating…' : saved ? 'Saved' : 'Save Script'}
            </button>
            {isDirty && !isBusy && !isNew && (
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => { setContent(original); setSyntaxError(null); setSaveError(null); }}
              >
                <RotateCcw size={13} /> Discard
              </button>
            )}
            {!isDirty && !isBusy && (
              <span className="scripts-modal__hint">
                <ShieldCheck size={12} /> Save requires passkey verification
              </span>
            )}
          </div>

          {/* Cron section — only for existing scripts */}
          {!isNew && (
            <div className="scripts-modal__cron">
              <div className="scripts-modal__cron-title"><Clock size={14} /> Schedule</div>

              <div className="scripts-modal__cron-toggle-row">
                <span className="scripts-modal__cron-label">Enable cron job</span>
                <button
                  className={`cron-toggle-track${cronEnabled ? ' on' : ''}`}
                  onClick={() => { setCronEnabled((e) => !e); setCronDirty(true); setCronFeedback(null); }}
                  aria-pressed={cronEnabled}
                >
                  <span className="cron-toggle-thumb" />
                </button>
              </div>

              <div className={`cron-body${cronEnabled ? '' : ' cron-body--disabled'}`}>
                <div className="cron-section-label">Preset</div>
                <div className="cron-presets">
                  {PRESETS.map((p) => (
                    <button
                      key={p.expr}
                      className={`cron-preset${cronPreset === p.expr ? ' active' : ''}`}
                      onClick={() => pickPreset(p)}
                      disabled={!cronEnabled}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>

                {isCustomCron && (
                  <div className="cron-custom">
                    <div className="cron-section-label">Expression</div>
                    <input
                      className="scripts-modal__name-input"
                      value={cronExpr}
                      onChange={(e) => { setCronExpr(e.target.value); setCronDirty(true); setCronFeedback(null); }}
                      disabled={!cronEnabled}
                      placeholder="*/10 * * * *  or  @monthly"
                      spellCheck={false}
                    />
                  </div>
                )}

                <div className="cron-custom">
                  <div className="cron-section-label">Delay (seconds)</div>
                  <input
                    className="scripts-modal__name-input cron-delay-input"
                    type="number"
                    min={0}
                    max={3600}
                    value={cronDelay}
                    onChange={(e) => { setCronDelay(Math.max(0, parseInt(e.target.value) || 0)); setCronDirty(true); setCronFeedback(null); }}
                    disabled={!cronEnabled}
                    placeholder="0"
                  />
                </div>

                <div className="cron-expr">
                  <span className="cron-expr__label">Expression</span>
                  <code className="cron-expr__value">{cronExpr}{cronDelay > 0 ? ` (+ ${cronDelay}s delay)` : ''}</code>
                </div>

                {cronInfo && (
                  <div className="cron-expr">
                    <span className="cron-expr__label">Cron file</span>
                    <code className="cron-expr__value">{cronInfo.cronFile}</code>
                  </div>
                )}
              </div>

              <div className="cron-footer">
                {cronFeedback && (
                  <span className={`cron-feedback${cronFeedback.ok ? ' cron-feedback--ok' : ' cron-feedback--err'}`}>
                    {cronFeedback.msg}
                  </span>
                )}
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => setShowCronPasskey(true)}
                  disabled={cronSaving || !cronDirty}
                >
                  {cronSaving
                    ? <><Loader size={12} className="cron-spin" /> Saving…</>
                    : <><Save size={12} /> Save Schedule</>}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {showPasskey && (
        <PasskeyPrompt
          mode="authenticate"
          onSuccess={onPasskeySuccess}
          onCancel={() => setShowPasskey(false)}
        />
      )}

      {showCronPasskey && (
        <PasskeyPrompt
          mode="authenticate"
          onSuccess={onCronPasskeySuccess}
          onCancel={() => setShowCronPasskey(false)}
        />
      )}
    </div>,
    document.body,
  );
};

// ── Run Output Modal ──────────────────────────────────────────────────────────

interface RunOutputProps {
  output: string;
  exitCode: number;
  scriptName: string;
  onClose: () => void;
}

const RunOutputModal: React.FC<RunOutputProps> = ({ output, exitCode, scriptName, onClose }) => {
  const preRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (preRef.current) preRef.current.scrollTop = preRef.current.scrollHeight;
  }, [output]);

  return ReactDOM.createPortal(
    <div className="scripts-modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="scripts-modal animate-slide-up">
        <div className="scripts-modal__header">
          <span className="scripts-modal__title"><Play size={15} /> Run: {scriptName}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {exitCode === 0
              ? <span className="scripts-run-status scripts-run-status--ok"><CheckCircle2 size={13} /> Exit 0</span>
              : <span className="scripts-run-status scripts-run-status--err"><AlertCircle size={13} /> Exit {exitCode}</span>
            }
            <button className="scripts-modal__close" onClick={onClose}><X size={16} /></button>
          </div>
        </div>
        <div className="scripts-modal__body">
          <pre ref={preRef} className="scripts-run-output">{output || '(no output)'}</pre>
        </div>
      </div>
    </div>,
    document.body,
  );
};

// ── Log Modal ─────────────────────────────────────────────────────────────────

interface LogModalProps {
  content: string;
  logFile: string;
  scriptName: string;
  onClose: () => void;
  onRefresh: () => void;
  refreshing: boolean;
}

const LogModal: React.FC<LogModalProps> = ({ content, logFile, scriptName, onClose, onRefresh, refreshing }) => {
  const preRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (preRef.current) preRef.current.scrollTop = preRef.current.scrollHeight;
  }, [content]);

  return ReactDOM.createPortal(
    <div className="scripts-modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="scripts-modal animate-slide-up">
        <div className="scripts-modal__header">
          <span className="scripts-modal__title"><FileText size={15} /> {scriptName}: log</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              className="btn btn-ghost btn-sm"
              onClick={onRefresh}
              disabled={refreshing}
              title="Refresh log"
            >
              <RefreshCw size={13} className={refreshing ? 'spinning' : ''} />
            </button>
            <button className="scripts-modal__close" onClick={onClose}><X size={16} /></button>
          </div>
        </div>
        <div className="scripts-modal__body">
          <code className="scripts-modal__log-path">{logFile}</code>
          <pre ref={preRef} className="scripts-run-output">{content || '(log file is empty)'}</pre>
        </div>
      </div>
    </div>,
    document.body,
  );
};

// ── Main Scripts Page ─────────────────────────────────────────────────────────

type PendingAction =
  | { type: 'create' }
  | { type: 'edit';   id: string }
  | { type: 'delete'; id: string; name: string }
  | { type: 'run';    id: string; name: string };

export const Scripts: React.FC = () => {
  const [scripts, setScripts]     = useState<UserScriptWithCron[]>([]);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [toast, setToast]         = useState<{ ok: boolean; msg: string } | null>(null);

  const [passkeyStatus, setPasskeyStatus] = useState<PasskeyStatus | null>(null);
  const [showPasskey, setShowPasskey]     = useState(false);
  const [passkeyMode, setPasskeyMode]     = useState<'register' | 'authenticate'>('authenticate');
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);

  // Editor modal
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId]   = useState<string | null>(null);

  // Delete confirmation
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string } | null>(null);
  const [deleteError, setDeleteError]     = useState<string | null>(null);
  const [isDeleting, setIsDeleting]       = useState(false);

  // Run output
  const [runResult, setRunResult]     = useState<{ output: string; exitCode: number } | null>(null);
  const [runScriptName, setRunScriptName] = useState('');
  const [isRunning, setIsRunning]     = useState<string | null>(null);

  // Log viewer
  const [logModal, setLogModal]       = useState<{ id: string; name: string; content: string; logFile: string } | null>(null);
  const [logLoading, setLogLoading]   = useState<string | null>(null);
  const [logRefreshing, setLogRefreshing] = useState(false);

  const handleReadLog = useCallback(async (id: string, name: string, isRefresh = false) => {
    if (isRefresh) setLogRefreshing(true); else setLogLoading(id);
    const res = await api.scripts.readLog(id);
    if (isRefresh) setLogRefreshing(false); else setLogLoading(null);
    if (res.ok) setLogModal({ id, name, content: res.data.content, logFile: res.data.logFile });
    else showToast(false, res.error);
  }, []);

  const showToast = (ok: boolean, msg: string) => {
    setToast({ ok, msg });
    setTimeout(() => setToast(null), 3500);
  };

  const loadScripts = useCallback(async () => {
    const res = await api.scripts.list();
    if (res.ok) setScripts(res.data);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadScripts();
    api.passkey.status().then((res) => { if (res.ok) setPasskeyStatus(res.data); });
  }, [loadScripts]);

  // Keep modal blur in sync
  useEffect(() => {
    if (editorOpen || !!runResult || !!confirmDelete || !!logModal) { openModal(); return closeModal; }
  }, [editorOpen, runResult, confirmDelete, logModal]);

  const triggerPasskey = useCallback((action: PendingAction) => {
    setPendingAction(action);
    setPasskeyMode(passkeyStatus?.registered ? 'authenticate' : 'register');
    setShowPasskey(true);
  }, [passkeyStatus]);

  const onPasskeySuccess = useCallback(() => {
    setShowPasskey(false);
    const action = pendingAction;
    setPendingAction(null);
    if (!action) return;
    if (action.type === 'create') { setEditingId(null); setEditorOpen(true); }
    else if (action.type === 'edit') { setEditingId(action.id); setEditorOpen(true); }
    else if (action.type === 'delete') { setConfirmDelete({ id: action.id, name: action.name }); }
    else if (action.type === 'run') {
      setIsRunning(action.id);
      setRunScriptName(action.name);
      api.scripts.run(action.id).then((res) => {
        setIsRunning(null);
        if (res.ok) setRunResult({ output: res.data.output, exitCode: res.data.exitCode });
        else showToast(false, res.error);
      });
    }
  }, [pendingAction]);

  const handleEditorSaved = useCallback((script: UserScript) => {
    setEditorOpen(false);
    setEditingId(null);
    showToast(true, editingId === null ? `Script "${script.name}" created` : `Script "${script.name}" saved`);
    loadScripts();
  }, [editingId, loadScripts]);

  const handleDeleteConfirm = async () => {
    if (!confirmDelete) return;
    setIsDeleting(true);
    setDeleteError(null);
    const res = await api.scripts.delete(confirmDelete.id);
    setIsDeleting(false);
    if (!res.ok) { setDeleteError(res.error); return; }
    setConfirmDelete(null);
    showToast(true, `Script "${confirmDelete.name}" deleted`);
    loadScripts();
  };

  const fmtDate = (ms: number) =>
    new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

  return (
    <div className="scripts-page animate-fade-in">

      {/* Topbar */}
      <div className="scripts-page__topbar">
        <p className="scripts-page__count">
          {scripts.length} script{scripts.length !== 1 ? 's' : ''}
        </p>
        <div className="scripts-page__topbar-actions">
          <button
            className="btn btn-ghost btn-sm"
            onClick={async () => {
              setRefreshing(true);
              await loadScripts();
              setTimeout(() => setRefreshing(false), 600);
            }}
            disabled={refreshing}
          >
            <RefreshCw size={15} className={refreshing ? 'spinning' : ''} />
            Refresh
          </button>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => triggerPasskey({ type: 'create' })}
          >
            <Plus size={15} /> New Script
          </button>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className={`scripts-page__toast${toast.ok ? '' : ' scripts-page__toast--error'}`}>
          {toast.ok ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />} {toast.msg}
        </div>
      )}

      {/* Empty / loading / list */}
      {loading ? (
        <div className="scripts-page__list">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="skeleton" style={{ height: 80, borderRadius: 12 }} />
          ))}
        </div>
      ) : scripts.length === 0 ? (
        <GlassCard className="scripts-page__empty">
          <Terminal size={36} />
          <p>No user scripts yet.</p>
          <button className="btn btn-primary btn-sm" onClick={() => triggerPasskey({ type: 'create' })}>
            <Plus size={14} /> Create your first script
          </button>
        </GlassCard>
      ) : (
        <div className="scripts-page__list">
          {scripts.map((s) => (
            <GlassCard key={s.id} className="script-card">
              <div className="script-card__left">
                <div className="script-card__icon"><Terminal size={18} /></div>
                <div className="script-card__info">
                  <div className="script-card__name">{s.name}</div>
                  <div className="script-card__meta">
                    {s.cron.enabled ? (
                      <span className="script-card__badge script-card__badge--cron">
                        <Clock size={11} /> {s.cron.schedule}
                      </span>
                    ) : (
                      <span className="script-card__badge script-card__badge--idle">Not scheduled</span>
                    )}
                    <span className="script-card__date">Updated {fmtDate(s.updatedAt)}</span>
                  </div>
                </div>
              </div>

              <div className="script-card__actions">
                <button
                  className="btn btn-ghost btn-sm script-card__btn"
                  title="Run now"
                  onClick={() => triggerPasskey({ type: 'run', id: s.id, name: s.name })}
                  disabled={isRunning === s.id}
                >
                  {isRunning === s.id
                    ? <span className="spinner spinner-sm" />
                    : <Play size={13} />}
                  Run
                </button>
                {s.logFile && (
                  <button
                    className="btn btn-ghost btn-sm script-card__btn"
                    title="View log"
                    onClick={() => handleReadLog(s.id, s.name)}
                    disabled={logLoading === s.id}
                  >
                    {logLoading === s.id
                      ? <span className="spinner spinner-sm" />
                      : <FileText size={13} />}
                    Log
                  </button>
                )}
                <button
                  className="btn btn-ghost btn-sm script-card__btn"
                  title="Edit script"
                  onClick={() => triggerPasskey({ type: 'edit', id: s.id })}
                >
                  <Pencil size={13} /> Edit
                </button>
                <button
                  className="btn btn-ghost btn-sm script-card__btn script-card__btn--danger"
                  title="Delete script"
                  onClick={() => triggerPasskey({ type: 'delete', id: s.id, name: s.name })}
                >
                  <Trash2 size={13} /> Delete
                </button>
              </div>
            </GlassCard>
          ))}
        </div>
      )}

      {/* Passkey prompt */}
      {showPasskey && (
        <PasskeyPrompt
          mode={passkeyMode}
          onSuccess={onPasskeySuccess}
          onCancel={() => { setShowPasskey(false); setPendingAction(null); }}
          onRegistered={() => api.passkey.status().then((r) => { if (r.ok) setPasskeyStatus(r.data); })}
        />
      )}

      {/* Script editor modal */}
      {editorOpen && (
        <ScriptEditorModal
          editId={editingId}
          onSaved={handleEditorSaved}
          onCancel={() => { setEditorOpen(false); setEditingId(null); }}
        />
      )}

      {/* Log viewer modal */}
      {logModal !== null && (
        <LogModal
          content={logModal.content}
          logFile={logModal.logFile}
          scriptName={logModal.name}
          onClose={() => setLogModal(null)}
          onRefresh={() => handleReadLog(logModal.id, logModal.name, true)}
          refreshing={logRefreshing}
        />
      )}

      {/* Run output modal */}
      {runResult !== null && (
        <RunOutputModal
          output={runResult.output}
          exitCode={runResult.exitCode}
          scriptName={runScriptName}
          onClose={() => setRunResult(null)}
        />
      )}

      {/* Delete confirmation */}
      {confirmDelete && (
        <div
          className="scripts-page__confirm-overlay"
          onClick={(e) => e.target === e.currentTarget && setConfirmDelete(null)}
        >
          <div className="scripts-page__confirm animate-slide-up">
            <div className="scripts-page__confirm-title">Delete Script</div>
            <p className="scripts-page__confirm-desc">
              Are you sure you want to delete <code>{confirmDelete.name}</code>?
              Its cron job (if any) will also be removed. This cannot be undone.
            </p>
            {deleteError && (
              <div className="scripts-page__confirm-error">
                <AlertCircle size={13} /> {deleteError}
              </div>
            )}
            <div className="scripts-page__confirm-actions">
              <button className="btn btn-ghost btn-sm" onClick={() => setConfirmDelete(null)} disabled={isDeleting}>
                Cancel
              </button>
              <button className="btn btn-danger btn-sm" onClick={handleDeleteConfirm} disabled={isDeleting}>
                {isDeleting ? <span className="spinner spinner-sm" /> : <Trash2 size={14} />}
                {isDeleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
