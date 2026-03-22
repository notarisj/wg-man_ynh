import React, { useState, useEffect, useCallback } from 'react';
import { Save, RotateCcw, AlertCircle, Check } from 'lucide-react';
import { api } from '../../lib/api';
import { PasskeyPrompt } from './PasskeyPrompt';
import './ScriptEditor.css';

interface ScriptEditorProps {
  onPathLoad?: (path: string) => void;
}

export const ScriptEditor: React.FC<ScriptEditorProps> = ({ onPathLoad }) => {
  const [original, setOriginal]       = useState('');
  const [content, setContent]         = useState('');
  const [loading, setLoading]         = useState(true);
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [saved, setSaved]             = useState(false);
  const [showPasskey, setShowPasskey] = useState(false);

  const loadScript = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await api.script.get();
    setLoading(false);
    if (res.ok) {
      setOriginal(res.data.content);
      setContent(res.data.content);
      onPathLoad?.(res.data.path);
    } else {
      setError(res.error);
    }
  }, [onPathLoad]);

  useEffect(() => { loadScript(); }, [loadScript]);

  const doSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    const res = await api.script.save(content);
    setSaving(false);
    if (!res.ok) { setError(res.error); return; }
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

  return (
    <>
      {error && (
        <div className="script-editor__error">
          <AlertCircle size={13} /> {error}
        </div>
      )}

      <textarea
        className="script-editor__textarea"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        spellCheck={false}
      />

      <div className="script-editor__actions">
        <button
          className="btn btn-primary btn-sm"
          onClick={() => setShowPasskey(true)}
          disabled={saving || !isDirty}
        >
          {saving ? <span className="spinner spinner-sm" /> : saved ? <Check size={13} /> : <Save size={13} />}
          {saved ? 'Saved' : 'Save Script'}
        </button>

        {isDirty && (
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => { setContent(original); setError(null); }}
            disabled={saving}
          >
            <RotateCcw size={13} /> Discard
          </button>
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
