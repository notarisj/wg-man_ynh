import React, { useState, useEffect, useCallback } from 'react';
import { FileCode, Save, RotateCcw, AlertCircle, Check } from 'lucide-react';
import { api } from '../../lib/api';
import { GlassCard } from './GlassCard';
import { PasskeyPrompt } from './PasskeyPrompt';
import './ScriptEditor.css';

export const ScriptEditor: React.FC = () => {
  const [original, setOriginal]     = useState('');
  const [content, setContent]       = useState('');
  const [scriptPath, setScriptPath] = useState('');
  const [loading, setLoading]       = useState(true);
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [saved, setSaved]           = useState(false);
  const [showPasskey, setShowPasskey] = useState(false);

  const loadScript = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await api.script.get();
    setLoading(false);
    if (res.ok) {
      setOriginal(res.data.content);
      setContent(res.data.content);
      setScriptPath(res.data.path);
    } else {
      setError(res.error);
    }
  }, []);

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

  return (
    <GlassCard className="settings-card settings-card--script">
      <div className="settings-card__title">
        <FileCode size={16} /> Monitor Script
      </div>

      {scriptPath && (
        <div className="script-editor__path">
          <span className="script-editor__path-label">Path</span>
          <code className="script-editor__path-value">{scriptPath}</code>
        </div>
      )}

      {error && (
        <div className="settings-passkey-error">
          <AlertCircle size={13} /> {error}
        </div>
      )}

      {loading ? (
        <div className="settings-passkey-loading">
          <span className="spinner spinner-sm" /> Loading…
        </div>
      ) : (
        <>
          <textarea
            className="script-editor__textarea"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            spellCheck={false}
            rows={24}
          />

          <div className="script-editor__actions">
            <button
              className="settings-passkey-btn settings-passkey-btn--green"
              onClick={() => setShowPasskey(true)}
              disabled={saving || !isDirty}
            >
              {saving
                ? <span className="spinner spinner-sm" />
                : saved
                ? <Check size={13} />
                : <Save size={13} />}
              {saved ? 'Saved' : 'Save Script'}
            </button>

            {isDirty && (
              <button
                className="settings-passkey-btn settings-passkey-btn--amber"
                onClick={() => setContent(original)}
                disabled={saving}
              >
                <RotateCcw size={13} /> Discard Changes
              </button>
            )}
          </div>
        </>
      )}

      {showPasskey && (
        <PasskeyPrompt
          mode="authenticate"
          onSuccess={onPasskeySuccess}
          onCancel={() => setShowPasskey(false)}
        />
      )}
    </GlassCard>
  );
};
