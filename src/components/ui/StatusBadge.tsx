import React from 'react';
import { ShieldCheck, ShieldOff } from 'lucide-react';


interface StatusBadgeProps {
  connected: boolean;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({
  connected,
  size = 'md',
  showLabel = true,
}) => {
  const sizeMap = { sm: 14, md: 18, lg: 24 };
  const iconSize = sizeMap[size];

  return (
    <span className={`status-badge status-badge--${size} ${connected ? 'status-badge--on' : 'status-badge--off'}`}>
      <span className="status-badge__icon-wrap">
        {connected
          ? <ShieldCheck size={iconSize} />
          : <ShieldOff size={iconSize} />
        }
        {connected && <span className="status-badge__pulse" />}
      </span>
      {showLabel && (
        <span className="status-badge__label">
          {connected ? 'Connected' : 'Disconnected'}
        </span>
      )}
    </span>
  );
};
