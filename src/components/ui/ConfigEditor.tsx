import React, { useState, useEffect, useRef } from 'react';
import { X, Save, AlertCircle } from 'lucide-react';
import { api } from '../../lib/api';
import './ConfigEditor.css';

const NEW_CONFIG_TEMPLATE = `[Interface]
PrivateKey = <your-private-key>
Address = 10.0.0.2/32
DNS = 1.1.1.1

[Peer]
PublicKey = <server-public-key>
Endpoint = <server-ip>:51820
AllowedIPs = 0.0.0.0/0, ::/0
PersistentKeepalive = 25
`;

interface ConfigEditorProps {
  /** Existing config name to edit, or null to create new */
  editName: string | null;
  /** Pattern prefix (e.g. "wg-") for new config name validation */
  namePrefix: string;
  onSave: (name: string) => void;
  onCancel: () => void;
}

export const ConfigEditor: React.FC<ConfigEditorProps> = ({
  editName, namePrefix, onSave, onCancel,
}) => {
  const isNew = editName === null;
  const [name, setName] = useState(isNew ? namePrefix : editName);
  const [content, setContent] = useState(isNew ? NEW_CONFIG_TEMPLATE : '');
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!isNew) {
      api.configContent(editName).then((res) => {
        if (res.ok) setContent(res.data.content);
        else setError('Failed to load config content');
        setLoading(false);
      });
    }
  }, [editName, isNew]);

  const handleSave = async () => {
    setError(null);
    if (!name.trim()) { setError('Config name is required'); return; }

    setSaving(true);
    const res = isNew
      ? await api.createConfig(name.trim(), content)
      : await api.updateConfig(editName, content);
    setSaving(false);

    if (!res.ok) { setError(res.error); return; }
    onSave(name.trim());
  };

  return (
    <div className="ceditor-overlay" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="ceditor-modal animate-slide-up">
        <div className="ceditor-header">
          <div className="ceditor-title">
            {isNew ? 'Create Config' : `Edit ${editName}`}
          </div>
          <button className="ceditor-close" onClick={onCancel} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        {isNew && (
          <div className="ceditor-name-row">
            <label className="ceditor-label">Config Name</label>
            <input
              className="ceditor-name-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={`${namePrefix}myvpn`}
              spellCheck={false}
            />
            <span className="ceditor-name-hint">.conf</span>
          </div>
        )}

        {error && (
          <div className="ceditor-error">
            <AlertCircle size={13} /> {error}
          </div>
        )}

        <div className="ceditor-body">
          {loading ? (
            <div className="ceditor-loading"><span className="spinner" /></div>
          ) : (
            <textarea
              ref={textareaRef}
              className="ceditor-textarea"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              spellCheck={false}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
            />
          )}
        </div>

        <div className="ceditor-footer">
          <button className="btn btn-ghost btn-sm" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
          <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving || loading}>
            {saving ? <span className="spinner spinner-sm" /> : <Save size={14} />}
            {saving ? 'Saving…' : 'Save Config'}
          </button>
        </div>
      </div>
    </div>
  );
};
