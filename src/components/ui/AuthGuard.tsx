import React, { useEffect, useState } from 'react';
import { Shield, ExternalLink } from 'lucide-react';
import { useVpnStore } from '../../store/vpnStore';

interface AuthGuardProps {
  children: React.ReactNode;
}

type AuthState = 'loading' | 'ok' | 'forbidden';

export const AuthGuard: React.FC<AuthGuardProps> = ({ children }) => {
  const [state, setState] = useState<AuthState>('loading');
  const fetchMe = useVpnStore((s) => s.fetchMe);

  useEffect(() => {
    fetchMe().then(() => {
      const user = useVpnStore.getState().user;
      if (user) setState('ok');
      else setState('forbidden');
    });
  }, []);

  const sharedStyles = (
    <style>{`
      .auth-guard {
        display: flex; align-items: center; justify-content: center;
        flex: 1; min-height: 100vh; background: var(--clr-bg); padding: 24px;
      }
      .auth-guard__card {
        display: flex; flex-direction: column; align-items: center;
        gap: 16px; padding: 40px 48px; text-align: center; max-width: 400px;
      }
      .auth-guard__title { font-size: 22px; font-weight: 700; }
      .auth-guard__msg { font-size: 14px; color: var(--clr-text-muted); line-height: 1.6; }
    `}</style>
  );

  if (state === 'loading') {
    return (
      <div className="auth-guard">
        {sharedStyles}
        <div className="auth-guard__card glass">
          <div className="spinner" style={{ width: 32, height: 32, borderWidth: 3 }} />
          <p>Verifying session…</p>
        </div>
      </div>
    );
  }

  if (state === 'forbidden') {
    return (
      <div className="auth-guard">
        {sharedStyles}
        <div className="auth-guard__card glass">
          <Shield size={44} style={{ color: 'var(--clr-red)' }} />
          <h2 className="auth-guard__title">Authentication Required</h2>
          <p className="auth-guard__msg">
            You must be logged into the YunoHost portal to access WG Manager.
          </p>
          <a href="/yunohost/sso/" className="btn btn-primary">
            <ExternalLink size={16} /> Log in via YunoHost Portal
          </a>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};
