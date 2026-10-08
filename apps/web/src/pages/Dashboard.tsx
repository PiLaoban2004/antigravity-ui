import { useEffect, useState } from 'react';
import {
  Server,
  Users,
  Boxes,
  GitBranch,
  ShieldAlert,
  Zap,
  Trophy,
  Gauge,
  Flame,
  Clock,
  Layers,
  ArrowUpRight,
  CheckCircle2,
  RefreshCw,
  Cpu,
  Coins,
} from 'lucide-react';
import { api } from '../lib/api';
import type {
  AuthFile,
  HealthStatus,
  AgentRouterStats,
  ModelGroup,
  WorkBuddyStatus,
  WorkBuddyStats,
} from '@antigravity-ui/shared';
import { pollWhileVisible } from '../lib/poll';

export default function Dashboard() {
  const [activeGroup, setActiveGroup] = useState<ModelGroup>('all');
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [files, setFiles] = useState<AuthFile[]>([]);
  const [arStats, setArStats] = useState<AgentRouterStats | null>(null);
  const [wbStatus, setWbStatus] = useState<WorkBuddyStatus | null>(null);
  const [wbStats, setWbStats] = useState<WorkBuddyStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const [h, f, ar, wbs, wbt] = await Promise.allSettled([
        api.health(),
        api.authFiles(),
        api.agentrouterStats(),
        api.workbuddyStatus(),
        api.workbuddyStats(),
      ]);

      if (h.status === 'fulfilled') setHealth(h.value);
      if (f.status === 'fulfilled') setFiles(f.value.files ?? []);
      if (ar.status === 'fulfilled' && ar.value.stats) setArStats(ar.value.stats);
      if (wbs.status === 'fulfilled') setWbStatus(wbs.value);
      if (wbt.status === 'fulfilled') setWbStats(wbt.value);

      setErr('');
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    return pollWhileVisible(load, 5000);
  }, []);

  const antiHealth = health?.groups?.antigravity;
  const arHealth = health?.groups?.agentrouter;
  const wbHealth = health?.groups?.workbuddy;

  const cards = [
    {
      group: 'antigravity',
      label: 'Antigravity 账号',
      value: `${antiHealth?.activeCount ?? 0} / ${antiHealth?.authCount ?? 0}`,
      desc: '活跃 / 录入总数',
      icon: Users,
      color: 'text-sky-400',
      bg: 'bg-sky-500/10 border-sky-500/20',
    },
    {
      group: 'antigravity',
      label: 'Antigravity 路由',
      value: antiHealth?.strategy ?? 'round-robin',
      desc: '1:1 等权轮询负载均衡',
      icon: GitBranch,
      color: 'text-emerald-400',
      bg: 'bg-emerald-500/10 border-emerald-500/20',
    },
    {
      group: 'agentrouter',
      label: 'AgentRouter 竞速池',
      value: '5 模型',
      desc: 'GPT-5.6 / Opus 4.8 / Opus 5 / DeepSeek V4 / GLM-5.3',
      icon: Zap,
      color: 'text-amber-400',
      bg: 'bg-amber-500/10 border-amber-500/20',
    },
    {
      group: 'agentrouter',
      label: 'AgentRouter 请求数',
      value: arStats?.totalRequests ?? 0,
      desc: `已完成 ${arStats?.totalRaces ?? 0} 次竞速对冲`,
      icon: Trophy,
      color: 'text-violet-400',
      bg: 'bg-violet-500/10 border-violet-500/20',
    },
    {
      group: 'workbuddy',
      label: 'WorkBuddy 账号池',
      value: `${wbHealth?.healthy ?? 0} / ${wbHealth?.total ?? 0}`,
      desc: '健康 / 总数 · 国内 + 全球双区',
      icon: Coins,
      color: 'text-sky-400',
      bg: 'bg-sky-500/10 border-sky-500/20',
    },
    {
      group: 'workbuddy',
      label: 'WorkBuddy 请求数',
      value: wbStats?.total?.requests ?? 0,
      desc: `失败 ${wbStats?.total?.failed ?? 0} · ${((wbStats?.total?.total_tokens ?? 0) / 1e6).toFixed(1)}M tokens`,
      icon: Layers,
      color: 'text-cyan-400',
      bg: 'bg-cyan-500/10 border-cyan-500/20',
    },
  ];

  const filteredCards = cards.filter(
    (c) => activeGroup === 'all' || c.group === activeGroup
  );

  const racingModels = [
    { id: 'claude-opus-4-8', name: 'Claude Opus 4.8', color: 'bg-amber-500' },
    { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', color: 'bg-emerald-500' },
    { id: 'glm-5.3', name: 'GLM-5.3', color: 'bg-teal-500' },
    { id: 'claude-opus-5', name: 'Claude Opus 5', color: 'bg-indigo-500' },
    { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol', color: 'bg-sky-500' },
  ];

  return (
    <div className="p-4 sm:p-6 md:p-8 max-w-7xl mx-auto space-y-8">
      {/* 头部标题与分组切换 */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-white">系统总览</h1>
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-zinc-800 text-zinc-300 border border-zinc-700 font-medium">
              三组隔离运行
            </span>
          </div>
          <p className="text-zinc-400 text-sm mt-1">
            监控 Google Antigravity 反代集群、AgentRouter 5 模型极速竞速网关 与 WorkBuddy 积分制账号池
          </p>
        </div>

        <div className="flex items-center gap-3 min-w-0">
          {/* 分组切换 Tabs */}
          <div className="flex p-1 bg-zinc-900 border border-zinc-800 rounded-xl max-w-full min-w-0 overflow-x-auto [&>button]:shrink-0 [&>button]:whitespace-nowrap">
            <button
              onClick={() => setActiveGroup('all')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                activeGroup === 'all'
                  ? 'bg-zinc-800 text-white shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              全部总览
            </button>
            <button
              onClick={() => setActiveGroup('antigravity')}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                activeGroup === 'antigravity'
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              Antigravity 组
            </button>
            <button
              onClick={() => setActiveGroup('agentrouter')}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                activeGroup === 'agentrouter'
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
              AgentRouter 竞速组
            </button>
            <button
              onClick={() => setActiveGroup('workbuddy')}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                activeGroup === 'workbuddy'
                  ? 'bg-sky-500/20 text-sky-300 border border-sky-500/30'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-sky-400" />
              WorkBuddy 积分组
            </button>
          </div>

          <button
            onClick={load}
            disabled={loading}
            className="p-2 rounded-lg bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-zinc-300 text-sm transition-colors"
            title="刷新数据"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {err && (
        <div className="p-4 rounded-xl bg-red-950/50 border border-red-900/50 text-red-300 text-sm flex items-center gap-3">
          <ShieldAlert className="w-5 h-5 text-red-400 shrink-0" />
          <span>{err}</span>
        </div>
      )}

      {/* KPI 卡片 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {filteredCards.map(({ label, value, desc, icon: Icon, color, bg }) => (
          <div key={label} className="p-5 rounded-2xl bg-zinc-900/70 border border-zinc-800/80 backdrop-blur-sm relative overflow-hidden">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-zinc-400 uppercase tracking-wider">{label}</span>
              <div className={`p-2 rounded-xl ${bg}`}>
                <Icon className={`w-4 h-4 ${color}`} />
              </div>
            </div>
            <div className="text-2xl font-bold mt-2 text-white">{value}</div>
            <div className="text-xs text-zinc-500 mt-1">{desc}</div>
          </div>
        ))}
      </div>

      {/* 模块 1：AgentRouter 5-模型竞速状态面板 (当处于 all 或 agentrouter 分组时显示) */}
      {(activeGroup === 'all' || activeGroup === 'agentrouter') && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400">
                <Zap className="w-4 h-4" />
              </div>
              <h2 className="text-lg font-semibold text-white">AgentRouter 5 模型竞速网关 (端口 15721)</h2>
            </div>
            <span className="text-xs text-zinc-500 flex items-center gap-1">
              <Flame className="w-3.5 h-3.5 text-amber-400" />
              TTFT 毫秒首字胜出 · 失败即时 Abort 销毁
            </span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* 左侧：5 模型胜出统计与平均延迟 */}
            <div className="p-6 rounded-2xl bg-zinc-900/60 border border-zinc-800/80 space-y-4">
              <h3 className="text-sm font-medium text-zinc-200 flex items-center justify-between">
                <span>模型胜率与平均延迟</span>
                <span className="text-xs text-zinc-500">累计 {arStats?.totalRaces ?? 0} 轮</span>
              </h3>

              <div className="space-y-3 pt-1">
                {racingModels.map((m) => {
                  const winCount = arStats?.winners?.[m.id] ?? 0;
                  const total = arStats?.totalRaces || 1;
                  const pct = Math.round((winCount / total) * 100);
                  const lat = arStats?.modelLatencies?.[m.id]?.avgMs ?? 0;

                  return (
                    <div key={m.id} className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-zinc-300">{m.name}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-zinc-400">{winCount} 次 ({pct}%)</span>
                          {lat > 0 && (
                            <span className="text-amber-400/90 font-mono text-[11px]">~{lat}ms</span>
                          )}
                        </div>
                      </div>
                      <div className="h-2 w-full bg-zinc-800/80 rounded-full overflow-hidden">
                        <div
                          className={`h-full ${m.color} rounded-full transition-all duration-500`}
                          style={{ width: `${Math.max(pct, winCount > 0 ? 5 : 0)}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="pt-3 border-t border-zinc-800/80 text-xs text-zinc-400 space-y-1.5">
                <div className="flex justify-between">
                  <span>支持协议</span>
                  <span className="text-zinc-200 font-medium">OpenAI / Anthropic 双格式</span>
                </div>
                <div className="flex justify-between">
                  <span>对冲延迟 (Hedge)</span>
                  <span className="text-emerald-400 font-mono">2500ms 自动激活补位</span>
                </div>
              </div>
            </div>

            {/* 右侧：实时竞速流水记录 (Recent Races) */}
            <div className="lg:col-span-2 p-6 rounded-2xl bg-zinc-900/60 border border-zinc-800/80 space-y-4">
              <h3 className="text-sm font-medium text-zinc-200 flex items-center justify-between">
                <span>实时竞速流水 (Live Telemetry)</span>
                <span className="text-xs text-zinc-500">最近 30 条调用</span>
              </h3>

              <div className="overflow-x-auto">
                {(!arStats?.recentRaces || arStats.recentRaces.length === 0) ? (
                  <div className="p-4 sm:p-6 md:p-8 text-center text-zinc-500 text-xs border border-dashed border-zinc-800 rounded-xl">
                    等待请求接入... (可在 DSH、Pi 或 Claude Code 中发送消息测试)
                  </div>
                ) : (
                  <div className="overflow-x-auto -mx-1 px-1">
                  <table className="w-full min-w-[520px] text-left text-xs [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
                    <thead>
                      <tr className="border-b border-zinc-800 text-zinc-500">
                        <th className="pb-2 font-medium">时间</th>
                        <th className="pb-2 font-medium">请求模型</th>
                        <th className="pb-2 font-medium">获胜模型 (Winner)</th>
                        <th className="pb-2 font-medium">首包耗时</th>
                        <th className="pb-2 font-medium">模式</th>
                        <th className="pb-2 font-medium">协议</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/50">
                      {arStats.recentRaces.slice(0, 7).map((r) => (
                        <tr key={r.id} className="hover:bg-zinc-800/30">
                          <td className="py-2.5 text-zinc-400 font-mono text-[11px]">
                            {new Date(r.ts).toLocaleTimeString()}
                          </td>
                          <td className="py-2.5 font-medium text-zinc-300">
                            {r.requestedModel}
                          </td>
                          <td className="py-2.5">
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium">
                              <Trophy className="w-3 h-3 text-amber-400" />
                              {r.winner}
                            </span>
                          </td>
                          <td className="py-2.5 font-mono text-amber-400">
                            {r.latencyMs}ms
                          </td>
                          <td className="py-2.5 text-zinc-400">
                            {r.isStream ? '⚡ 流式' : '📦 完整'}
                          </td>
                          <td className="py-2.5 text-zinc-400 uppercase text-[10px]">
                            {r.protocol}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 模块 3：WorkBuddy 积分制账号池 (当处于 all 或 workbuddy 分组时显示) */}
      {(activeGroup === 'all' || activeGroup === 'workbuddy') && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-sky-500/10 border border-sky-500/20 text-sky-400">
                <Coins className="w-4 h-4" />
              </div>
              <h2 className="text-lg font-semibold text-white">WorkBuddy 账号池 (workbuddy2api · 端口 7863)</h2>
            </div>
            <span className="text-xs text-zinc-500 flex items-center gap-1">
              <Flame className="w-3.5 h-3.5 text-sky-400" />
              积分制 · 国内 / 全球双区隔离调度
            </span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* 账号明细 */}
            <div className="lg:col-span-2 p-6 rounded-2xl bg-zinc-900/60 border border-zinc-800/80 space-y-4">
              <h3 className="text-sm font-medium text-zinc-200 flex items-center justify-between">
                <span>账号池 ({wbStatus?.accounts?.length ?? 0})</span>
                <span className="text-xs text-zinc-500">
                  健康 {wbStatus?.healthy ?? 0} · 冷却 {wbStatus?.cooling ?? 0} · 禁用 {wbStatus?.disabled ?? 0}
                </span>
              </h3>

              {!wbStatus?.accounts?.length ? (
                <div className="p-4 sm:p-6 md:p-8 text-center text-zinc-500 text-xs border border-dashed border-zinc-800 rounded-xl">
                  WorkBuddy 网关未接入，或未配置 ANTI_UI_WORKBUDDY_KEY
                </div>
              ) : (
                <div className="space-y-2.5">
                  {wbStatus.accounts.map((a) => {
                    const bad = a.cooling || a.disabled || a.consecutive_fails >= 3;
                    return (
                      <div
                        key={a.uid}
                        className="flex items-center justify-between gap-3 p-3 rounded-xl bg-zinc-900/80 border border-zinc-800/70"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <span
                            className={`w-2 h-2 rounded-full shrink-0 ${
                              bad ? 'bg-amber-400' : a.in_flight > 0 ? 'bg-sky-400 animate-pulse' : 'bg-emerald-400'
                            }`}
                          />
                          <div className="min-w-0">
                            <div className="text-sm text-zinc-200 font-medium truncate">
                              {a.nickname || a.uid.slice(0, 12)}
                            </div>
                            <div className="text-[11px] text-zinc-500 font-mono truncate">
                              {a.uid.slice(0, 18)}… · 成功 {a.success_count} · 连败 {a.consecutive_fails}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span
                            className={`px-2 py-0.5 rounded-md text-[10px] font-medium border ${
                              a.realm === 'cn'
                                ? 'bg-red-500/10 text-red-300 border-red-500/20'
                                : 'bg-indigo-500/10 text-indigo-300 border-indigo-500/20'
                            }`}
                          >
                            {a.realm === 'cn' ? '国内' : '全球'}
                          </span>
                          <span className="text-xs text-zinc-300 font-mono">积分 {a.credits}</span>
                          {a.in_flight > 0 && <span className="text-[10px] text-sky-400">在途 {a.in_flight}</span>}
                          {a.cooling && <span className="text-[10px] text-amber-400">冷却</span>}
                          {a.disabled && <span className="text-[10px] text-zinc-500">禁用</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* 分区可服务性 + 用量 */}
            <div className="p-6 rounded-2xl bg-zinc-900/60 border border-zinc-800/80 space-y-4">
              <h3 className="text-sm font-medium text-zinc-200">分区可服务性</h3>
              <div className="space-y-2.5 pt-1">
                {Object.entries(wbStatus?.realm_totals ?? {}).map(([realm, t]) => (
                  <div key={realm} className="flex items-center justify-between text-xs">
                    <span className="text-zinc-300">{realm === 'cn' ? '国内节点' : '全球节点'}</span>
                    <span className="text-zinc-400 font-mono">
                      {t.healthy}/{t.total} 健康 · 冷却 {t.cooling}
                    </span>
                  </div>
                ))}
                <div className="flex items-center justify-between text-xs pt-2 border-t border-zinc-800/70">
                  <span className="text-zinc-300">realm 可服务</span>
                  <span className="font-mono space-x-2">
                    <span className={wbHealth?.realmServable?.cn ? 'text-emerald-400' : 'text-red-400'}>
                      cn {wbHealth?.realmServable?.cn ? '✓' : '✗'}
                    </span>
                    <span className={wbHealth?.realmServable?.global ? 'text-emerald-400' : 'text-red-400'}>
                      global {wbHealth?.realmServable?.global ? '✓' : '✗'}
                    </span>
                  </span>
                </div>
              </div>

              <div className="pt-3 border-t border-zinc-800/80 text-xs text-zinc-400 space-y-1.5">
                <div className="flex justify-between">
                  <span>累计请求</span>
                  <span className="text-zinc-200 font-medium">{wbStats?.total?.requests ?? 0}</span>
                </div>
                <div className="flex justify-between">
                  <span>成功率</span>
                  <span className="text-emerald-400 font-mono">
                    {wbStats?.total?.requests
                      ? (((wbStats.total.requests - (wbStats.total.failed ?? 0)) / wbStats.total.requests) * 100).toFixed(1)
                      : '0.0'}
                    %
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>累计 tokens</span>
                  <span className="text-zinc-200 font-mono">
                    {((wbStats?.total?.total_tokens ?? 0) / 1e6).toFixed(1)}M
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>网关运行</span>
                  <span className="text-zinc-300 font-mono">
                    {Math.floor((wbStats?.uptime_sec ?? 0) / 3600)}h
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 模块 2：Antigravity Google OAuth 账号状态 (当处于 all 或 antigravity 分组时显示) */}
      {(activeGroup === 'all' || activeGroup === 'antigravity') && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                <Users className="w-4 h-4" />
              </div>
              <h2 className="text-lg font-semibold text-white">Antigravity Google 账号集群 (端口 8317)</h2>
            </div>
            <span className="text-xs text-zinc-400">
              策略：{antiHealth?.strategy ?? 'round-robin'} · 故障自动切换
            </span>
          </div>

          <div className="grid gap-3">
            {files.length === 0 && (
              <div className="text-zinc-500 text-sm p-4 sm:p-6 md:p-8 text-center border border-dashed border-zinc-800 rounded-2xl">
                暂无 Antigravity 账号
              </div>
            )}
            {files.map((f) => (
              <div
                key={f.id}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-2xl bg-zinc-900/60 border border-zinc-800/80 hover:border-zinc-700/60 transition-colors"
              >
                <div className="flex items-center gap-3.5 min-w-0">
                  <span
                    className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                      f.disabled
                        ? 'bg-zinc-500'
                        : f.status === 'error'
                        ? 'bg-red-500 animate-pulse'
                        : 'bg-emerald-400'
                    }`}
                  />
                  <div>
                    <div className="font-medium text-sm text-zinc-100 flex items-center gap-2">
                      {f.email || f.account}
                      <span className="text-[11px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700/50">
                        {f.provider}
                      </span>
                    </div>
                    <div className="text-xs text-zinc-500 mt-0.5">
                      项目 ID: {f.project_id ?? '默认'} · 状态: {f.disabled ? '已禁用' : f.status === 'error' ? '异常' : '正常'}
                    </div>
                  </div>
                </div>

                <div className="sm:text-right text-xs text-zinc-400 flex items-center justify-between sm:justify-end gap-6 pl-6 sm:pl-0">
                  <div>
                    <div className="text-zinc-200 font-mono font-medium">成功 {f.success}</div>
                    <div className="text-zinc-500">失败 {f.failed}</div>
                  </div>
                  <span
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium ${
                      f.disabled
                        ? 'bg-zinc-800 text-zinc-400'
                        : f.status === 'error'
                        ? 'bg-red-500/20 text-red-300 border border-red-500/30'
                        : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                    }`}
                  >
                    {f.disabled ? '已禁用' : f.status === 'error' ? '不可用' : '在线负载中'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
