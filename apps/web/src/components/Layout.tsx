import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
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
  CircleGauge,
  Globe2,
  Zap,
  Coins,
  LogOut,
  Menu,
  X,
} from 'lucide-react';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { pollWhileVisible } from '../lib/poll';
import type { HealthStatus } from '@antigravity-ui/shared';

const nav = [
  { to: '/', label: '总览', icon: LayoutDashboard },
  { to: '/accounts', label: '账号 (Antigravity)', icon: Users },
  { to: '/models', label: '模型管理 & 分组', icon: Boxes },
  { to: '/routing', label: '路由策略', icon: GitBranch },
  { to: '/clients', label: '客户端配置', icon: Terminal },
  { to: '/availability', label: '可用性与竞速测试', icon: Gauge },
  { to: '/quota', label: '额度监控', icon: CircleGauge },
  { to: '/usage', label: '模型用量', icon: ChartColumn },
  { to: '/remote', label: '远程调用', icon: Globe2 },
  { to: '/logs', label: '日志', icon: ScrollText },
  { to: '/settings', label: '设置', icon: Settings },
];

export default function Layout() {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const { remote, role, logout } = useSession();
  // Below md the sidebar is an off-canvas drawer; it closes on navigation, backdrop tap and Escape.
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setMenuOpen(false), [location.pathname]);
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

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
    // /api/health fans out to every gateway: poll slowly, and not at all while the tab is hidden.
    const stop = pollWhileVisible(poll, 15000);
    return () => {
      alive = false;
      stop();
    };
  }, []);

  const antiReachable = health?.groups?.antigravity?.reachable ?? health?.proxyReachable ?? false;
  const arReachable = health?.groups?.agentrouter?.reachable ?? false;
  const wbHealth = health?.groups?.workbuddy;
  const wbReachable = wbHealth?.reachable ?? false;

  return (
    <div className="flex h-dvh bg-black text-zinc-100 antialiased selection:bg-emerald-500/20 selection:text-emerald-300">
      {menuOpen && <div className="fixed inset-0 z-30 bg-black/60 md:hidden" onClick={() => setMenuOpen(false)} aria-hidden />}
      <aside
        id="sidebar"
        className={`fixed inset-y-0 left-0 z-40 w-64 max-w-[85vw] overflow-y-auto pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] transition-transform duration-200 md:static md:z-auto md:max-w-none md:translate-x-0 md:overflow-visible md:pt-0 md:pb-0 shrink-0 border-r border-zinc-800/80 bg-zinc-950 md:bg-zinc-950/80 backdrop-blur-xl flex flex-col justify-between ${
          menuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div>
          <div className="relative px-5 py-4 border-b border-zinc-800/80 flex items-center gap-2.5">
            <button
              onClick={() => setMenuOpen(false)}
              aria-label="关闭菜单"
              className="md:hidden absolute right-2 top-2 p-2 rounded-lg text-zinc-400 hover:bg-zinc-800"
            >
              <X className="w-5 h-5" />
            </button>
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-emerald-500/20 to-sky-500/20 border border-emerald-500/30 flex items-center justify-center">
              <Activity className="w-4 h-4 text-emerald-400" />
            </div>
            <div>
              <div className="font-semibold text-sm tracking-tight text-zinc-100">AI Proxy Gateway</div>
              <div className="text-[11px] text-zinc-500">Antigravity · AgentRouter · WorkBuddy</div>
            </div>
          </div>
          <nav className="py-3 px-2 space-y-1">
            {nav.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                className={({ isActive }) =>
                  `flex items-center gap-2.5 px-3.5 py-2 rounded-lg text-sm font-medium transition-all ${
                    isActive
                      ? 'bg-zinc-800/90 text-white shadow-sm border border-zinc-700/50'
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/60'
                  }`
                }
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{label}</span>
              </NavLink>
            ))}
          </nav>
        </div>

        {/* 底部双分组状态栏 */}
        <div className="p-3 border-t border-zinc-800/80 bg-zinc-950/40 text-[11px] space-y-2">
          {/* Antigravity 状态 */}
          <div className="flex items-center justify-between px-2 py-1.5 rounded-md bg-zinc-900/60 border border-zinc-800/50">
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${antiReachable ? 'bg-emerald-400 animate-pulse' : 'bg-red-500'}`} />
              <span className="text-zinc-300 font-medium">Antigravity</span>
            </div>
            <span className="text-zinc-400">
              {antiReachable ? `${health?.activeCount ?? 0}/${health?.authCount ?? 0} 账号 · 8317` : '离线'}
            </span>
          </div>

          {/* AgentRouter 状态 */}
          <div className="flex items-center justify-between px-2 py-1.5 rounded-md bg-zinc-900/60 border border-zinc-800/50">
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${arReachable ? 'bg-violet-400 animate-pulse' : 'bg-zinc-500'}`} />
              <span className="text-zinc-300 font-medium flex items-center gap-1">
                <Zap className="w-3 h-3 text-amber-400" /> AgentRouter
              </span>
            </div>
            <span className="text-zinc-400">
              {arReachable ? '5模型竞速 · 15721' : '就绪'}
            </span>
          </div>

          {/* WorkBuddy 状态 */}
          <div className="flex items-center justify-between px-2 py-1.5 rounded-md bg-zinc-900/60 border border-zinc-800/50">
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${wbReachable ? 'bg-sky-400 animate-pulse' : 'bg-zinc-500'}`} />
              <span className="text-zinc-300 font-medium flex items-center gap-1">
                <Coins className="w-3 h-3 text-sky-400" /> WorkBuddy
              </span>
            </div>
            <span className="text-zinc-400">
              {wbReachable ? `${wbHealth?.healthy ?? 0}/${wbHealth?.total ?? 0} 账号 · 7863` : '未接入'}
            </span>
          </div>
          {remote && (
            <div className="px-2 pt-1 flex items-center justify-between text-[11px] text-zinc-500">
              <span>{role === 'admin' ? '管理员会话' : '只读会话'}</span>
              <button onClick={logout} className="flex items-center gap-1 hover:text-zinc-200">
                <LogOut className="w-3 h-3" /> 退出
              </button>
            </div>
          )}
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="md:hidden shrink-0 flex items-center gap-3 px-3 h-12 pt-[env(safe-area-inset-top)] box-content border-b border-zinc-800/80 bg-zinc-950">
          <button
            onClick={() => setMenuOpen((o) => !o)}
            aria-label={menuOpen ? '关闭菜单' : '打开菜单'}
            aria-expanded={menuOpen}
            aria-controls="sidebar"
            className="p-2 -ml-1 rounded-lg text-zinc-300 hover:bg-zinc-800"
          >
            {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
          <span className="font-semibold text-sm tracking-tight truncate">AI Proxy Gateway</span>
          <span className="ml-auto flex items-center gap-1.5" title="Antigravity / AgentRouter / WorkBuddy">
            <span className={`w-2 h-2 rounded-full ${antiReachable ? 'bg-emerald-400' : 'bg-red-500'}`} />
            <span className={`w-2 h-2 rounded-full ${arReachable ? 'bg-violet-400' : 'bg-zinc-600'}`} />
            <span className={`w-2 h-2 rounded-full ${wbReachable ? 'bg-sky-400' : 'bg-zinc-600'}`} />
          </span>
        </header>
        <main className="flex-1 overflow-y-auto bg-zinc-950 pb-[env(safe-area-inset-bottom)]" data-readonly={role === 'viewer' ? '' : undefined}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
