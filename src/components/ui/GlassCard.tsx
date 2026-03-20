import React from 'react';

interface GlassCardProps {
  children: React.ReactNode;
  className?: string;
  highlight?: boolean;
  style?: React.CSSProperties;
  onClick?: () => void;
}

export const GlassCard: React.FC<GlassCardProps> = ({
  children,
  className = '',
  highlight = false,
  style,
  onClick,
}) => (
  <div
    className={`glass${highlight ? ' glass-hi' : ''} ${className}`}
    style={style}
    onClick={onClick}
  >
    {children}
  </div>
);
