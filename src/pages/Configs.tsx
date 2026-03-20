import React, { useEffect, useState } from 'react';
import { Layers, CheckCircle2, Circle, RotateCcw, ServerCrash, AlertCircle } from 'lucide-react';
import { useVpnStore } from '../store/vpnStore';
import { GlassCard } from '../components/ui/GlassCard';
import './Configs.css';

export const Configs: React.FC = () => {
  const { configs, fetchConfigs, switchConfig, isSwitching, isLoadingConfigs, error } = useVpnStore();
  const [switchedMsg, setSwitchedMsg] = useState<string | null>(null);
  const [switchError, setSwitchError] = useState<string | null>(null);

  useEffect(() => { fetchConfigs(); }, []);

  const handleSwitch = async (name: string) => {
    setSwitchError(null);
    const ok = await switchConfig(name);
    if (ok) {
      setSwitchedMsg(`Switched to ${name}`);
      setTimeout(() => setSwitchedMsg(null), 3500);
    } else {
      const msg = error ?? 'Failed to switch config';
      setSwitchError(msg);
      setTimeout(() => setSwitchError(null), 5000);
    }
  };

  return (
    <div className="configs-page animate-fade-in">
      {/* Page header */}
      <div className="configs-page__topbar">
        <div>
          <p className="configs-page__count">
            {configs.length} configuration{configs.length !== 1 ? 's' : ''} found
          </p>
        </div>
        <button
          id="btn-refresh-configs"
          className="btn btn-ghost"
          onClick={() => fetchConfigs()}
          disabled={isLoadingConfigs}
        >
          {isLoadingConfigs ? <span className="spinner spinner-sm" /> : <RotateCcw size={15} />}
          Refresh
        </button>
      </div>

      {/* Success toast */}
      {switchedMsg && (
        <div className="configs-page__toast">
          <CheckCircle2 size={15} /> {switchedMsg}
        </div>
      )}

      {/* Error toast */}
      {switchError && (
        <div className="configs-page__toast configs-page__toast--error">
          <AlertCircle size={15} /> {switchError}
        </div>
      )}

      {/* Config grid */}
      {isLoadingConfigs && configs.length === 0 ? (
        <div className="configs-page__grid">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="skeleton" style={{ height: 140, borderRadius: 12 }} />
          ))}
        </div>
      ) : configs.length === 0 ? (
        <GlassCard className="configs-page__empty">
          <ServerCrash size={36} />
          <p>No WireGuard configs found matching the pattern.</p>
        </GlassCard>
      ) : (
        <div className="configs-page__grid">
          {configs.map((cfg) => {
            const isActive = cfg.isActive;
            const isBusy = isSwitching === cfg.name;
            return (
              <GlassCard
                key={cfg.name}
                className={`config-card${isActive ? ' config-card--active' : ''}`}
              >
                {isActive && <div className="config-card__active-glow" />}
                <div className="config-card__header">
                  <div className="config-card__title-row">
                    <div className="config-card__icon">
                      {isActive
                        ? <CheckCircle2 size={18} className="config-card__icon--active" />
                        : <Circle size={18} className="config-card__icon--inactive" />
                      }
                    </div>
                    <div>
                      <div className="config-card__name">{cfg.name}</div>
                      {cfg.comment && (
                        <div className="config-card__comment">{cfg.comment}</div>
                      )}
                    </div>
                    {isActive && (
                      <span className="config-card__badge">Active</span>
                    )}
                  </div>
                </div>

                <div className="config-card__meta">
                  <div className="config-card__meta-row">
                    <span className="config-card__meta-label">Address</span>
                    <span className="config-card__meta-val mono">{cfg.address ?? '—'}</span>
                  </div>
                  <div className="config-card__meta-row">
                    <span className="config-card__meta-label">Endpoint</span>
                    <span className="config-card__meta-val mono">{cfg.endpoint ?? '—'}</span>
                  </div>
                </div>

                <div className="config-card__footer">
                  {isActive ? (
                    <button className="btn btn-ghost btn-sm" disabled>
                      <CheckCircle2 size={14} /> Currently Active
                    </button>
                  ) : (
                    <button
                      id={`btn-switch-${cfg.name}`}
                      className="btn btn-primary btn-sm"
                      onClick={() => handleSwitch(cfg.name)}
                      disabled={!!isSwitching}
                    >
                      {isBusy ? <span className="spinner spinner-sm" /> : <Layers size={14} />}
                      {isBusy ? 'Switching…' : 'Switch to This'}
                    </button>
                  )}
                </div>
              </GlassCard>
            );
          })}
        </div>
      )}
    </div>
  );
};
