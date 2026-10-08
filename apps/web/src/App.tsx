import { useCallback, useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { UNAUTHORIZED_EVENT, api } from './lib/api';
import { SessionContext, type Role } from './lib/session';
import Login from './pages/Login';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Accounts from './pages/Accounts';
import Models from './pages/Models';
import Routing from './pages/Routing';
import Clients from './pages/Clients';
import Logs from './pages/Logs';
import Settings from './pages/Settings';
import Availability from './pages/Availability';
import Usage from './pages/Usage';
import Remote from './pages/Remote';
import Quota from './pages/Quota';

export default function App() {
  // undefined = still asking the server; null role + remote = must log in
  const [session, setSession] = useState<{ remote: boolean; role: Role | null } | undefined>();

  const refresh = useCallback(() => {
    api
      .session()
      .then(setSession)
      .catch(() => setSession({ remote: false, role: 'admin' })); // server unreachable: let pages show their own errors
  }, []);

  useEffect(() => {
    refresh();
    // A 401 means what we believed about the session is stale (expired, logged out, or the server was switched
    // to remote mode after this page loaded). Ask the server again instead of guessing; many requests fail at
    // once, so collapse them into one lookup.
    let asking = false;
    const onUnauthorized = () => {
      if (asking) return;
      asking = true;
      api
        .session()
        .then(setSession)
        .catch(() => {})
        .finally(() => setTimeout(() => (asking = false), 1000));
    };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, [refresh]);

  if (!session) return <div className="min-h-screen bg-black" />;
  if (session.remote && !session.role) return <Login onDone={refresh} />;

  const logout = () => {
    api.logout().finally(() => setSession({ remote: true, role: null }));
  };

  return (
    <SessionContext.Provider value={{ remote: session.remote, role: session.role ?? 'admin', logout }}>
      <AppRoutes />
    </SessionContext.Provider>
  );
}

function AppRoutes() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/accounts" element={<Accounts />} />
        <Route path="/models" element={<Models />} />
        <Route path="/routing" element={<Routing />} />
        <Route path="/clients" element={<Clients />} />
        <Route path="/availability" element={<Availability />} />
        <Route path="/usage" element={<Usage />} />
        <Route path="/remote" element={<Remote />} />
        <Route path="/quota" element={<Quota />} />
        <Route path="/logs" element={<Logs />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
