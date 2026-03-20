import React, { useEffect } from 'react';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { useVpnStore } from '../../store/vpnStore';

interface LayoutProps {
  children: React.ReactNode;
}

export const Layout: React.FC<LayoutProps> = ({ children }) => {
  const { startWebSocket, stopWebSocket } = useVpnStore();

  useEffect(() => {
    startWebSocket();
    return () => stopWebSocket();
  }, []);

  return (
    <div className="app-layout">
      <Sidebar />
      <div className="main-content">
        <Header />
        <main className="page">{children}</main>
      </div>
    </div>
  );
};
