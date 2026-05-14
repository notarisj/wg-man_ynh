import React, { useEffect, useRef, useState } from 'react';
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
  History,
  Terminal,
  Puzzle,
  Wifi,
  Film,
  Tv,
  ChevronDown,
} from 'lucide-react';
import { useVpnStore } from '../../store/vpnStore';
import { usePluginStore } from '../../store/pluginStore';
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
  { to: '/scripts', icon: <Terminal size={20} />,        label: 'Scripts' },
  { to: '/history', icon: <History size={20} />,         label: 'History' },
];

const SETTINGS_ITEM: NavItem = { to: '/settings', icon: <Settings2 size={20} />, label: 'Settings' };

interface SidebarProps {
  collapsed: boolean;
  mobileOpen: boolean;
  onToggleCollapse: () => void;
  onMobileClose: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  collapsed, mobileOpen, onToggleCollapse, onMobileClose,
}) => {
  const status  = useVpnStore((s) => s.status);
  const plugins = usePluginStore((s) => s.plugins);

  useEffect(() => {
    usePluginStore.getState().fetchPlugins();
  }, []);

  const [pluginsExpanded, setPluginsExpanded] = useState(
    () => localStorage.getItem('plugins-sidebar-expanded') !== 'false',
  );

  const location = useLocation();

  // Auto-expand when navigating to a plugin sub-page
  useEffect(() => {
    if (location.pathname.startsWith('/plugins/')) setPluginsExpanded(true);
  }, [location.pathname]);

  const togglePlugins = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setPluginsExpanded((v) => {
      const next = !v;
      localStorage.setItem('plugins-sidebar-expanded', String(next));
      return next;
    });
  };

  const hasEnabledPlugins = !!plugins && Object.values(plugins).some((p) => p.enabled);
  const sidebarRef = useRef<HTMLElement>(null);

  // Disable transitions during window resize so the sidebar snaps to its
  // correct width instead of animating from the mobile-forced width.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const handleResize = () => {
      const el = sidebarRef.current;
      if (!el) return;
      el.classList.add('sidebar--no-transition');
      clearTimeout(timer);
      timer = setTimeout(() => el.classList.remove('sidebar--no-transition'), 50);
    };
    window.addEventListener('resize', handleResize);
    return () => { window.removeEventListener('resize', handleResize); clearTimeout(timer); };
  }, []);

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
    <aside ref={sidebarRef} className={cls}>
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

        {/* Plugins section */}
        <div className="sidebar__nav-group">
          <div className="sidebar__nav-group-header">
            <NavLink
              to="/plugins"
              className={({ isActive }) =>
                `sidebar__nav-item${isActive && location.pathname === '/plugins' ? ' sidebar__nav-item--active' : ''}`
              }
              aria-label="Plugins"
              title="Plugins"
              onClick={onMobileClose}
            >
              <span className="sidebar__nav-icon"><Puzzle size={20} /></span>
              <span className="sidebar__nav-label">Plugins</span>
            </NavLink>
            {hasEnabledPlugins && (
              <button
                className={`sidebar__plugins-toggle${pluginsExpanded ? ' expanded' : ''}`}
                onClick={togglePlugins}
                aria-label={pluginsExpanded ? 'Collapse plugins' : 'Expand plugins'}
                title={pluginsExpanded ? 'Collapse plugins' : 'Expand plugins'}
              >
                <ChevronDown size={14} />
              </button>
            )}
          </div>
          <div className={`sidebar__nav-group-body${pluginsExpanded && hasEnabledPlugins ? ' expanded' : ''}`}>
            {plugins?.qbittorrent?.enabled && (
              <NavLink
                to="/plugins/qbittorrent"
                className={({ isActive }) =>
                  `sidebar__nav-item sidebar__nav-item--sub${isActive ? ' sidebar__nav-item--active' : ''}`
                }
                aria-label="qBittorrent"
                title="qBittorrent"
                onClick={onMobileClose}
              >
                <span className="sidebar__nav-icon"><Wifi size={17} /></span>
                <span className="sidebar__nav-label">qBittorrent</span>
              </NavLink>
            )}
            {plugins?.radarr?.enabled && (
              <NavLink
                to="/plugins/radarr"
                className={({ isActive }) =>
                  `sidebar__nav-item sidebar__nav-item--sub${isActive ? ' sidebar__nav-item--active' : ''}`
                }
                aria-label="Radarr"
                title="Radarr"
                onClick={onMobileClose}
              >
                <span className="sidebar__nav-icon"><Film size={17} /></span>
                <span className="sidebar__nav-label">Radarr</span>
              </NavLink>
            )}
            {plugins?.sonarr?.enabled && (
              <NavLink
                to="/plugins/sonarr"
                className={({ isActive }) =>
                  `sidebar__nav-item sidebar__nav-item--sub${isActive ? ' sidebar__nav-item--active' : ''}`
                }
                aria-label="Sonarr"
                title="Sonarr"
                onClick={onMobileClose}
              >
                <span className="sidebar__nav-icon"><Tv size={17} /></span>
                <span className="sidebar__nav-label">Sonarr</span>
              </NavLink>
            )}
          </div>
        </div>

        <NavLink
          to={SETTINGS_ITEM.to}
          className={({ isActive }) =>
            `sidebar__nav-item${isActive ? ' sidebar__nav-item--active' : ''}`
          }
          aria-label={SETTINGS_ITEM.label}
          title={SETTINGS_ITEM.label}
          onClick={onMobileClose}
        >
          <span className="sidebar__nav-icon">{SETTINGS_ITEM.icon}</span>
          <span className="sidebar__nav-label">{SETTINGS_ITEM.label}</span>
        </NavLink>

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
