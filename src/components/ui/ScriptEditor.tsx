import React, { useState, useEffect, useCallback } from 'react';
import { Save, RotateCcw, AlertCircle, Check, ShieldCheck } from 'lucide-react';
import CodeMirror from '@uiw/react-codemirror';
import { StreamLanguage } from '@codemirror/language';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { api } from '../../lib/api';
import { PasskeyPrompt } from './PasskeyPrompt';
import './ScriptEditor.css';

const bashLang = StreamLanguage.define(shell);

const appThemeBase = EditorView.theme({
  '&': {
    backgroundColor: '#0b0e13',
    color: '#abb2bf',
  },
  '.cm-content': { caretColor: '#22c55e' },
  '.cm-cursor': { borderLeftColor: '#22c55e' },
  '.cm-selectionBackground, ::selection': { backgroundColor: 'rgba(34,197,94,0.18) !important' },
  '.cm-gutters': {
    backgroundColor: '#080b0f',
    color: '#3d4451',
    borderRight: '1px solid #151820',
  },
  '.cm-activeLineGutter': { backgroundColor: 'transparent' },
  '.cm-foldPlaceholder': { backgroundColor: 'transparent', border: 'none' },
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

const appTheme = [appThemeBase, syntaxHighlighting(appHighlight)];

interface ScriptEditorProps {
  onPathLoad?: (path: string) => void;
}

export const ScriptEditor: React.FC<ScriptEditorProps> = ({ onPathLoad }) => {
  const [original, setOriginal]           = useState('');
  const [content, setContent]             = useState('');
  const [loading, setLoading]             = useState(true);
  const [validating, setValidating]       = useState(false);
  const [saving, setSaving]               = useState(false);
  const [syntaxError, setSyntaxError]     = useState<string | null>(null);
  const [saveError, setSaveError]         = useState<string | null>(null);
  const [saved, setSaved]                 = useState(false);
  const [showPasskey, setShowPasskey]     = useState(false);

  const loadScript = useCallback(async () => {
    setLoading(true);
    const res = await api.script.get();
    setLoading(false);
    if (res.ok) {
      setOriginal(res.data.content);
      setContent(res.data.content);
      onPathLoad?.(res.data.path);
    } else {
      setSaveError(res.error);
    }
  }, [onPathLoad]);

  useEffect(() => { loadScript(); }, [loadScript]);

  // Clear syntax error whenever content changes
  const handleChange = useCallback((val: string) => {
    setContent(val);
    setSyntaxError(null);
    setSaved(false);
  }, []);

  const handleSaveClick = useCallback(async () => {
    setSyntaxError(null);
    setSaveError(null);
    setValidating(true);
    const res = await api.script.validate(content);
    setValidating(false);
    if (!res.ok) { setSaveError(res.error); return; }
    if (res.data && !res.data.ok) { setSyntaxError(res.data.error ?? 'Syntax error'); return; }
    setShowPasskey(true);
  }, [content]);

  const doSave = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    const res = await api.script.save(content);
    setSaving(false);
    if (!res.ok) { setSaveError(res.error); return; }
    setOriginal(content);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }, [content]);

  const onPasskeySuccess = useCallback(async () => {
    setShowPasskey(false);
    await doSave();
  }, [doSave]);

  const isDirty = content !== original;

  if (loading) {
    return (
      <div className="script-editor__loading">
        <span className="spinner spinner-sm" /> Loading script…
      </div>
    );
  }

  const isBusy = validating || saving;

  return (
    <>
      {saveError && (
        <div className="script-editor__error">
          <AlertCircle size={13} /> {saveError}
        </div>
      )}

      {syntaxError && (
        <div className="script-editor__syntax-error">
          <AlertCircle size={13} />
          <pre className="script-editor__syntax-pre">{syntaxError}</pre>
        </div>
      )}

      <div className="script-editor__cm-wrap">
        <CodeMirror
          value={content}
          onChange={handleChange}
          extensions={[bashLang, ...appTheme]}
          theme="dark"
          height="460px"
          basicSetup={{
            lineNumbers: true,
            foldGutter: false,
            autocompletion: false,
            highlightActiveLine: false,
            highlightActiveLineGutter: false,
          }}
        />
      </div>

      <div className="script-editor__actions">
        <button
          className="btn btn-primary btn-sm"
          onClick={handleSaveClick}
          disabled={isBusy || !isDirty}
        >
          {saving      ? <span className="spinner spinner-sm" />
           : validating ? <span className="spinner spinner-sm" />
           : saved      ? <Check size={13} />
           :              <Save size={13} />}
          {saving ? 'Saving…' : validating ? 'Validating…' : saved ? 'Saved' : 'Save Script'}
        </button>

        {isDirty && !isBusy && (
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => { setContent(original); setSyntaxError(null); setSaveError(null); }}
          >
            <RotateCcw size={13} /> Discard
          </button>
        )}

        {!isDirty && !isBusy && (
          <span className="script-editor__hint">
            <ShieldCheck size={12} /> Save requires passkey verification
          </span>
        )}
      </div>

      {showPasskey && (
        <PasskeyPrompt
          mode="authenticate"
          onSuccess={onPasskeySuccess}
          onCancel={() => setShowPasskey(false)}
        />
      )}
    </>
  );
};
