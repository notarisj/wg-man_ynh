import React, { useState, useEffect, useCallback } from 'react';
import { Fingerprint, ShieldCheck, Lock, Terminal, AlertCircle, Loader2, KeyRound } from 'lucide-react';
import {
  startRegistration as browserStartRegistration,
  startAuthentication as browserStartAuthentication,
} from '@simplewebauthn/browser';
import { api } from '../../lib/api';
import './AppPasskeyGate.css';

type GateState = 'loading' | 'verified' | 'needs-auth' | 'needs-register' | 'locked-out';

interface AppPasskeyGateProps {
  children: React.ReactNode;
}

export const AppPasskeyGate: React.FC<AppPasskeyGateProps> = ({ children }) => {
  const [gateState, setGateState] = useState<GateState>('loading');
  const [storeFile, setStoreFile]   = useState('');
  const [authStatus, setAuthStatus] = useState<'idle' | 'busy' | 'error'>('idle');
  const [authError, setAuthError]   = useState('');

  const checkSession = useCallback(async () => {
    const res = await api.passkey.session();
    if (!res.ok) { setGateState('needs-auth'); return; }
    const { verified, registered, registrationLocked, storeFile: sf } = res.data;
    setStoreFile(sf);
    if (verified)                        setGateState('verified');
    else if (registered)                 setGateState('needs-auth');
    else if (!registrationLocked)        setGateState('needs-register');
    else                                 setGateState('locked-out');
  }, []);

  useEffect(() => { checkSession(); }, [checkSession]);

  // Auto-trigger authentication on mount when ready
  useEffect(() => {
    if (gateState === 'needs-auth') doAuth();
  }, [gateState]); // eslint-disable-line react-hooks/exhaustive-deps

  const doAuth = useCallback(async () => {
    setAuthStatus('busy');
    setAuthError('');
    try {
      const startRes = await api.passkey.assertStart();
      if (!startRes.ok) { setAuthStatus('error'); setAuthError(startRes.error); return; }
      const assertion = await browserStartAuthentication({ optionsJSON: startRes.data });
      const finishRes = await api.passkey.assertFinish(assertion);
      if (!finishRes.ok) { setAuthStatus('error'); setAuthError(finishRes.error); return; }
      setAuthStatus('idle');
      setGateState('verified');
    } catch (err: any) {
      setAuthStatus('error');
      setAuthError(err?.name === 'NotAllowedError' ? 'Authentication was cancelled or timed out.' : (err?.message ?? 'An unexpected error occurred.'));
    }
  }, []);

  const doRegister = useCallback(async () => {
    setAuthStatus('busy');
    setAuthError('');
    try {
      const startRes = await api.passkey.registerStart();
      if (!startRes.ok) { setAuthStatus('error'); setAuthError(startRes.error); return; }
      const attestation = await browserStartRegistration({ optionsJSON: startRes.data });
      const finishRes = await api.passkey.registerFinish(attestation);
      if (!finishRes.ok) { setAuthStatus('error'); setAuthError(finishRes.error); return; }
      setAuthStatus('idle');
      setGateState('verified');
    } catch (err: any) {
      setAuthStatus('error');
      setAuthError(err?.name === 'NotAllowedError' ? 'Registration was cancelled or timed out.' : (err?.message ?? 'An unexpected error occurred.'));
    }
  }, []);

  if (gateState === 'loading') {
    return (
      <div className="app-gate app-gate--loading">
        <Loader2 size={28} className="app-gate__spinner" />
      </div>
    );
  }

  if (gateState === 'verified') {
    return <>{children}</>;
  }

  if (gateState === 'locked-out') {
    return (
      <div className="app-gate">
        <div className="app-gate__card">
          <div className="app-gate__icon app-gate__icon--warn">
            <Lock size={32} />
          </div>
          <h1 className="app-gate__title">Access Locked</h1>
          <p className="app-gate__desc">
            Passkey registration is disabled and no passkeys are registered. An administrator must unlock registration via SSH to proceed.
          </p>
          <div className="app-gate__ssh-block">
            <Terminal size={13} />
            <code className="app-gate__ssh-cmd">
              {`echo '{"credentials":[],"registrationLocked":false}' | sudo tee ${storeFile} && sudo systemctl restart wg-man`}
            </code>
          </div>
          <p className="app-gate__hint">After running this command, refresh the page to register your passkey.</p>
        </div>
      </div>
    );
  }

  const isRegister = gateState === 'needs-register';

  return (
    <div className="app-gate">
      <div className="app-gate__card">
        <div className="app-gate__icon">
          {authStatus === 'idle' && authError
            ? <AlertCircle size={32} className="app-gate__icon-err" />
            : authStatus === 'busy'
            ? <Loader2 size={32} className="app-gate__spinner" />
            : <Fingerprint size={32} />}
        </div>

        <div className="app-gate__logo">
          <KeyRound size={16} />
          WG Manager
        </div>

        <h1 className="app-gate__title">
          {isRegister ? 'Set Up Passkey' : 'Passkey Required'}
        </h1>
        <p className="app-gate__desc">
          {isRegister
            ? 'This app is protected by a passkey. Create one to gain access.'
            : 'Authenticate with your passkey to access WG Manager.'}
        </p>

        {authError && (
          <div className="app-gate__error">
            <AlertCircle size={14} /> {authError}
          </div>
        )}

        {authStatus === 'busy' ? (
          <p className="app-gate__hint">Waiting for authenticator…</p>
        ) : (
          <button
            className="btn btn-primary"
            onClick={isRegister ? doRegister : doAuth}
          >
            {isRegister
              ? <><KeyRound size={15} /> Create Passkey</>
              : <><ShieldCheck size={15} /> Authenticate</>}
          </button>
        )}
      </div>
    </div>
  );
};
