import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Settings2,
  ScrollText,
  Layers,
  Shield,
  ShieldCheck,
  ShieldOff,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import { useVpnStore } from '../../store/vpnStore';
import './Sidebar.css';

interface NavItem {
  to: string;
  icon: React.ReactNode;
  label: string;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/',        icon: <LayoutDashboard size={20} />, label: 'Dashboard' },
  { to: '/configs', icon: <Layers size={20} />,          label: 'Configs' },
  { to: '/logs',    icon: <ScrollText size={20} />,      label: 'Logs' },
  { to: '/settings',icon: <Settings2 size={20} />,       label: 'Settings' },
];

interface SidebarProps {
  collapsed: boolean;
  mobileOpen: boolean;
  onToggleCollapse: () => void;
  onMobileClose: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  collapsed, mobileOpen, onToggleCollapse, onMobileClose,
}) => {
  const status = useVpnStore((s) => s.status);
  const location = useLocation();

  const statusIcon = status?.connected
    ? <ShieldCheck size={22} className="status-icon connected" />
    : status === null
    ? <Shield size={22} className="status-icon loading" />
    : <ShieldOff size={22} className="status-icon disconnected" />;

  const statusLabel = status?.connected
    ? status.currentConfig ?? 'Connected'
    : 'Disconnected';

  const cls = ['sidebar', collapsed ? 'sidebar--collapsed' : '', mobileOpen ? 'sidebar--mobile-open' : '']
    .filter(Boolean).join(' ');

  return (
    <aside className={cls}>
      {/* Logo / Brand */}
      <div className="sidebar__brand">
        <div className="sidebar__logo">
          <Shield size={24} />
        </div>
        <div className="sidebar__brand-text">
          <span className="sidebar__brand-name">WG Manager</span>
          <span className="sidebar__brand-sub">WireGuard Control</span>
        </div>
      </div>

      {/* Status pill */}
      <div className={`sidebar__status${status?.connected ? ' sidebar__status--ok' : ' sidebar__status--off'}`}>
        <div className="sidebar__status-dot">
          {status?.connected && <span className="pulse-ring" />}
        </div>
        <span className="sidebar__status-label">{statusLabel}</span>
      </div>

      {/* Navigation */}
      <nav className="sidebar__nav">
        {NAV_ITEMS.map(({ to, icon, label }) => {
          const isActive = to === '/'
            ? location.pathname === '/'
            : location.pathname.startsWith(to);
          return (
            <NavLink
              key={to}
              to={to}
              className={`sidebar__nav-item${isActive ? ' sidebar__nav-item--active' : ''}`}
              aria-label={label}
              title={label}
              onClick={onMobileClose}
            >
              <span className="sidebar__nav-icon">{icon}</span>
              <span className="sidebar__nav-label">{label}</span>
            </NavLink>
          );
        })}

        {/* Desktop-only collapse toggle */}
        <button
          className="sidebar__nav-item sidebar__toggle-btn"
          onClick={onToggleCollapse}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand' : 'Collapse'}
        >
          <span className="sidebar__nav-icon">
            {collapsed ? <PanelLeftOpen size={20} /> : <PanelLeftClose size={20} />}
          </span>
          <span className="sidebar__nav-label">Collapse</span>
        </button>
      </nav>

      {/* Footer */}
      <div className="sidebar__footer">
        <div className={`sidebar__status-icon-wrap${status?.connected ? ' ok' : ''}`}>
          {statusIcon}
        </div>
        <div className="sidebar__footer-body">
          <span className="sidebar__footer-text">
            {status?.connected ? 'VPN Active' : 'VPN Inactive'}
          </span>
          <span className="sidebar__version">v{__APP_VERSION__}</span>
        </div>
      </div>
    </aside>
  );
};
