import { Navigate, Route, Routes } from 'react-router-dom';
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

export default function App() {
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
        <Route path="/logs" element={<Logs />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
