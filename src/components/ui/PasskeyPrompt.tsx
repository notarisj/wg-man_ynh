import React, { useState, useEffect, useCallback, useRef } from 'react';
import ReactDOM from 'react-dom';
import { KeyRound, ShieldCheck, X, Fingerprint, AlertCircle, Loader2 } from 'lucide-react';
import {
  startRegistration as browserStartRegistration,
  startAuthentication as browserStartAuthentication,
} from '@simplewebauthn/browser';
import { api } from '../../lib/api';
import './PasskeyPrompt.css';

export type PasskeyPromptMode = 'register' | 'authenticate';

interface PasskeyPromptProps {
  mode: PasskeyPromptMode;
  onSuccess: () => void;
  onCancel: () => void;
  /** Called after successful registration so parent can re-check status */
  onRegistered?: () => void;
}

export const PasskeyPrompt: React.FC<PasskeyPromptProps> = ({
  mode, onSuccess, onCancel, onRegistered,
}) => {
  const [status, setStatus] = useState<'idle' | 'busy' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [keyName, setKeyName] = useState('');
  const overlayMouseDown = useRef(false);

  const handleAction = useCallback(async () => {
    setStatus('busy');
    setMessage('');

    try {
      if (mode === 'register') {
        const startRes = await api.passkey.registerStart();
        if (!startRes.ok) {
          setStatus('error');
          setMessage(
            (startRes.error as any)?.includes?.('locked') || startRes.error?.includes?.('locked')
              ? 'Passkey registration has been locked. Re-enable it via SSH on the server.'
              : startRes.error,
          );
          return;
        }

        const attestation = await browserStartRegistration({ optionsJSON: startRes.data });

        const finishRes = await api.passkey.registerFinish(attestation, keyName.trim() || undefined);
        if (!finishRes.ok) { setStatus('error'); setMessage(finishRes.error); return; }

        setStatus('success');
        setMessage('Passkey registered successfully!');
        onRegistered?.();
        setTimeout(onSuccess, 800);
      } else {
        const startRes = await api.passkey.assertStart();
        if (!startRes.ok) { setStatus('error'); setMessage(startRes.error); return; }

        const assertion = await browserStartAuthentication({ optionsJSON: startRes.data });

        const finishRes = await api.passkey.assertFinish(assertion);
        if (!finishRes.ok) { setStatus('error'); setMessage(finishRes.error); return; }

        setStatus('success');
        setMessage('Verified!');
        setTimeout(onSuccess, 400);
      }
    } catch (err: any) {
      // User cancelled the authenticator prompt
      if (err?.name === 'NotAllowedError') {
        setStatus('error');
        setMessage('Authentication was cancelled or timed out.');
      } else {
        setStatus('error');
        setMessage(err?.message ?? 'An unexpected error occurred.');
      }
    }
  }, [mode, onSuccess, onRegistered]);

  // Auto-trigger authentication immediately on mount
  useEffect(() => {
    if (mode === 'authenticate') handleAction();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

const isRegister = mode === 'register';

  return ReactDOM.createPortal(
    <div
      className="passkey-overlay"
      onMouseDown={(e) => { overlayMouseDown.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (e.target === e.currentTarget && overlayMouseDown.current) onCancel(); }}
    >
      <div className="passkey-modal animate-slide-up">
        <button className="passkey-modal__close" onClick={onCancel} aria-label="Cancel">
          <X size={16} />
        </button>

        <div className="passkey-modal__icon">
          {status === 'success'
            ? <ShieldCheck size={32} className="passkey-icon--success" />
            : <Fingerprint size={32} className="passkey-icon--default" />}
        </div>

        <h2 className="passkey-modal__title">
          {isRegister ? 'Set Up Passkey' : 'Verify with Passkey'}
        </h2>
        <p className="passkey-modal__desc">
          {isRegister
            ? 'Create a passkey to protect config changes. You\'ll use it each time you create, edit, or delete a config.'
            : 'Config changes require passkey verification. Authenticate with your device to continue.'}
        </p>

        {isRegister && status !== 'success' && (
          <input
            className="passkey-modal__name-input"
            type="text"
            placeholder="Key name (e.g. MacBook Touch ID)"
            value={keyName}
            onChange={(e) => setKeyName(e.target.value)}
            maxLength={64}
            disabled={status === 'busy'}
            autoFocus
          />
        )}

        {status === 'error' && (
          <div className="passkey-modal__error">
            <AlertCircle size={14} /> {message}
          </div>
        )}

        {status === 'success' && (
          <div className="passkey-modal__success">
            <ShieldCheck size={14} /> {message}
          </div>
        )}

        <div className="passkey-modal__actions">
          {(status === 'idle' || status === 'error') && (
            <>
              <button className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
              <button className="btn btn-primary" onClick={handleAction}>
                <KeyRound size={15} />
                {isRegister ? 'Create Passkey' : 'Authenticate'}
              </button>
            </>
          )}
          {status === 'busy' && (
            <div className="passkey-modal__busy">
              <Loader2 size={18} className="passkey-spinner" />
              {isRegister ? 'Waiting for authenticator…' : 'Waiting for authenticator…'}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
};
