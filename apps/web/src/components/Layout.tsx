import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import {
  LayoutDashboard,
  Users,
  Boxes,
  GitBranch,
  Terminal,
  ScrollText,
  Settings,
  Activity,
  Gauge,
  ChartColumn,
} from 'lucide-react';
import { api } from '../lib/api';
import type { HealthStatus } from '@antigravity-ui/shared';

const nav = [
  { to: '/', label: '总览', icon: LayoutDashboard },
  { to: '/accounts', label: '账号', icon: Users },
  { to: '/models', label: '模型映射', icon: Boxes },
  { to: '/routing', label: '路由策略', icon: GitBranch },
  { to: '/clients', label: '客户端配置', icon: Terminal },
  { to: '/availability', label: '可用性测试', icon: Gauge },
  { to: '/usage', label: '模型用量', icon: ChartColumn },
  { to: '/logs', label: '日志', icon: ScrollText },
  { to: '/settings', label: '设置', icon: Settings },
];

export default function Layout() {
  const [health, setHealth] = useState<HealthStatus | null>(null);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const h = await api.health();
        if (alive) setHealth(h);
      } catch {
        if (alive) setHealth(null);
      }
    };
    poll();
    const t = setInterval(poll, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const status = health === null ? 'unknown' : health.ok ? 'online' : 'offline';

  return (
    <div className="flex h-screen">
      <aside className="w-60 shrink-0 border-r border-zinc-800 bg-zinc-950 flex flex-col">
        <div className="px-5 py-4 border-b border-zinc-800 flex items-center gap-2">
          <Activity className="w-5 h-5 text-emerald-400" />
          <span className="font-semibold tracking-tight">Antigravity 反代</span>
        </div>
        <nav className="flex-1 py-3">
          {nav.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-2 mx-2 rounded-lg text-sm transition-colors ${
                  isActive ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900'
                }`
              }
            >
              <Icon className="w-4 h-4" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="px-5 py-4 border-t border-zinc-800 text-xs flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full ${
              status === 'online' ? 'bg-emerald-400' : status === 'offline' ? 'bg-red-500' : 'bg-zinc-500'
            }`}
          />
          <span className="text-zinc-400">
            {status === 'online'
              ? `运行中 · ${health?.activeCount ?? 0}/${health?.authCount ?? 0} 账号`
              : status === 'offline'
                ? '代理离线'
                : '连接中…'}
          </span>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
