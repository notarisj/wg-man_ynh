import React, { useState, useRef, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { RefreshCw, UserCircle, Menu, LogOut } from 'lucide-react';
import { useVpnStore } from '../../store/vpnStore';
import { getLogoutUrl } from '../../lib/api';
import './Header.css';

const PAGE_TITLES: Record<string, { title: string; subtitle: string }> = {
  '/':        { title: 'Dashboard',   subtitle: 'Real-time VPN overview' },
  '/configs': { title: 'Configs',     subtitle: 'Manage WireGuard configurations' },
  '/logs':    { title: 'Logs',        subtitle: 'Monitor activity & events' },
  '/history': { title: 'History',    subtitle: 'Connection history & uptime' },
  '/settings':{ title: 'Settings',   subtitle: 'Application configuration' },
};

interface HeaderProps {
  onMobileMenuToggle: () => void;
}

export const Header: React.FC<HeaderProps> = ({ onMobileMenuToggle }) => {
  const location = useLocation();
  const meta = PAGE_TITLES[location.pathname] ?? PAGE_TITLES['/'];
  const { fetchStatus, fetchConfigs, isLoadingStatus, lastUpdated, user } = useVpnStore();
  const [refreshing, setRefreshing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleLogout = () => {
    window.location.href = getLogoutUrl();
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([fetchStatus(), fetchConfigs()]);
    setTimeout(() => setRefreshing(false), 600);
  };

  const timeStr = lastUpdated
    ? new Date(lastUpdated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : null;

  return (
    <header className="header">
      <div className="header__left">
        <button
          className="btn btn-ghost btn-icon header__mobile-menu"
          onClick={onMobileMenuToggle}
          aria-label="Toggle navigation"
        >
          <Menu size={20} />
        </button>
        <div>
          <h1 className="header__title">{meta.title}</h1>
          <p className="header__subtitle">{meta.subtitle}</p>
        </div>
      </div>
      <div className="header__right">
        {timeStr && (
          <span className="header__last-update">Updated {timeStr}</span>
        )}
        <button
          className={`btn btn-ghost btn-icon header__refresh${refreshing || isLoadingStatus ? ' spinning' : ''}`}
          onClick={handleRefresh}
          aria-label="Refresh status"
          title="Refresh"
        >
          <RefreshCw size={16} />
        </button>
        <div className="header__user" ref={menuRef}>
          <button
            className="header__user-btn"
            onClick={() => setMenuOpen((o) => !o)}
            aria-haspopup="true"
            aria-expanded={menuOpen}
          >
            <UserCircle size={20} className="header__user-icon" />
            {user && <span className="header__username">{user.username}</span>}
          </button>
          {menuOpen && (
            <div className="header__user-menu">
              <button className="header__user-menu-item" onClick={handleLogout}>
                <LogOut size={14} /> Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
