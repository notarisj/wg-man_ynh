import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Layout } from './components/layout/Layout';
import { AuthGuard } from './components/ui/AuthGuard';
import { AppPasskeyGate } from './components/ui/AppPasskeyGate';
import { Dashboard } from './pages/Dashboard';
import { Configs } from './pages/Configs';
import { Logs } from './pages/Logs';
import { Settings } from './pages/Settings';
import { History } from './pages/History';
import './index.css';

// Remove App.css - we use the design system from index.css
export default function App() {
  return (
    // import.meta.env.BASE_URL is set by Vite's `base` config (injected at build time)
    // This allows the app to be installed at any sub-path (e.g. /wg-man/)
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <AuthGuard>
        <AppPasskeyGate>
          <Layout>
            <Routes>
              <Route path="/"        element={<Dashboard />} />
              <Route path="/configs" element={<Configs />} />
              <Route path="/logs"    element={<Logs />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/history"  element={<History />} />
              {/* Fallback */}
              <Route path="*"        element={<Dashboard />} />
            </Routes>
          </Layout>
        </AppPasskeyGate>
      </AuthGuard>
    </BrowserRouter>
  );
}
