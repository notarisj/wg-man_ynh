import React, { useEffect, useState } from 'react';
import { Shield, ExternalLink } from 'lucide-react';
import { useVpnStore } from '../../store/vpnStore';
import { api, getDexLoginUrl, getSsoLoginUrl } from '../../lib/api';

interface AuthGuardProps {
  children: React.ReactNode;
}

type AuthState = 'loading' | 'ok' | 'forbidden';

const AUTH_ERROR_MESSAGES: Record<string, string> = {
  callback_failed:      'OIDC login failed — please try again.',
  not_configured:       'Dex OIDC is not configured on this server.',
  oidc_callback_failed: 'OIDC callback error — please try again.',
  forbidden:            'Access denied — your account is not in an allowed group. Contact your administrator.',
};

export const AuthGuard: React.FC<AuthGuardProps> = ({ children }) => {
  const [state, setState]       = useState<AuthState>('loading');
  const [dexEnabled, setDexEnabled] = useState(false);
  const fetchMe = useVpnStore((s) => s.fetchMe);

  // Read ?auth_error= from the URL and strip it so it doesn't linger
  const [authError] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    const err = params.get('auth_error');
    if (err) {
      params.delete('auth_error');
      const newUrl = window.location.pathname + (params.size ? `?${params}` : '');
      window.history.replaceState(null, '', newUrl);
    }
    return err;
  });

  useEffect(() => {
    fetchMe().then(() => {
      const user = useVpnStore.getState().user;
      if (user) {
        setState('ok');
      } else {
        setState('forbidden');
        // Discover whether the Dex login button should be shown
        api.authConfig().then((r) => {
          if (r.ok) setDexEnabled(r.data.dexEnabled);
        });
      }
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
        gap: 16px; padding: 40px 48px; text-align: center; max-width: 420px; width: 100%;
      }
      .auth-guard__title { font-size: 22px; font-weight: 700; }
      .auth-guard__msg { font-size: 14px; color: var(--clr-text-muted); line-height: 1.6; }
      .auth-guard__actions { display: flex; flex-direction: column; gap: 10px; width: 100%; margin-top: 4px; }
      .auth-guard__error {
        font-size: 13px; color: #f87171;
        background: rgba(248,113,113,.1); border: 1px solid rgba(248,113,113,.3);
        border-radius: 8px; padding: 10px 14px; width: 100%;
      }
      .auth-guard__divider {
        display: flex; align-items: center; gap: 10px;
        font-size: 12px; color: var(--clr-text-dim); width: 100%;
      }
      .auth-guard__divider::before,
      .auth-guard__divider::after { content: ''; flex: 1; height: 1px; background: var(--clr-border); }
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
    const errMsg = authError ? (AUTH_ERROR_MESSAGES[authError] ?? 'Authentication error.') : null;
    return (
      <div className="auth-guard">
        {sharedStyles}
        <div className="auth-guard__card glass">
          <Shield size={44} style={{ color: 'var(--clr-red)' }} />
          <h2 className="auth-guard__title">Sign In Required</h2>
          <p className="auth-guard__msg">
            You must be authenticated to access WG Manager.
          </p>

          {errMsg && <div className="auth-guard__error">{errMsg}</div>}

          <div className="auth-guard__actions">
            <a href={getSsoLoginUrl()} className="btn btn-primary">
              <ExternalLink size={16} /> Sign in via YunoHost Portal
            </a>

            {dexEnabled && (
              <>
                <div className="auth-guard__divider">or</div>
                <a href={getDexLoginUrl()} className="btn btn-secondary">
                  Sign in with Dex (LDAP)
                </a>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};
