import { useEffect, useState, useMemo } from 'react';
import {
  RefreshCw,
  BarChart3,
  Users,
  ScrollText,
  DollarSign,
  Calendar,
  Layers,
  Zap,
  TrendingUp,
  Activity,
  CheckCircle2,
  XCircle,
  Clock,
  ArrowUpRight,
  Sparkles,
  PieChart as PieIcon,
  Filter,
  Flame,
  Coins,
} from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
} from 'recharts';
import { api } from '../lib/api';
import type {
  UsageTimelineResponse,
  UsageTimelineBucket,
  UsagePeriod,
  ModelGroup,
  ProviderGroup,
} from '@antigravity-ui/shared';
import { pollWhileVisible } from '../lib/poll';

const COLORS = [
  '#10b981', // emerald
  '#8b5cf6', // violet
  '#3b82f6', // blue
  '#f59e0b', // amber
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#84cc16', // lime
  '#f97316', // orange
  '#a855f7', // purple
  '#14b8a6', // teal
  '#64748b', // slate
];

const AGENTROUTER_MODELS = [
  'agentrouter-race',
  'claude-opus-4-8',
  'claude-opus-5',
  'deepseek-v4-flash',
  'glm-5.3',
  'gpt-5.6-sol',
];

// Fallback only: the server records which provider served each request and returns it as `group`.
const guessModelGroup = (name: string): ProviderGroup => {
  // WorkBuddy 模型带 realm 前缀，可无歧义识别
  if (name.startsWith('cn:') || name.startsWith('global:')) return 'workbuddy';
  if (AGENTROUTER_MODELS.includes(name)) return 'agentrouter';
  return 'antigravity';
};

type PeriodType = 'today' | '14days' | 'month' | 'all';
type MetricView = 'tokens' | 'calls' | 'cost';

export default function Usage() {
  const [activeGroup, setActiveGroup] = useState<ModelGroup>('all');
  const [period, setPeriod] = useState<PeriodType>('today');
  const [metricView, setMetricView] = useState<MetricView>('tokens');
  const [timelineData, setTimelineData] = useState<UsageTimelineResponse | null>(null);
  const [models, setModels] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [recent, setRecent] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>({});
  const [cost, setCost] = useState<any>({ total: 0, per_model: [] });
  const [loading, setLoading] = useState(false);
  const [selectedBucketKey, setSelectedBucketKey] = useState<string | null>(null);
  const [sortField, setSortField] = useState<'calls' | 'total_tokens' | 'cost' | 'avg_latency_ms'>('calls');
  const [sortAsc, setSortAsc] = useState(false);
  const [err, setErr] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const [m, a, r, s, c, tl] = await Promise.all([
        api.usageModels(),
        api.usageAccounts(),
        api.usageRecent(),
        api.usageSummary(),
        api.usageCost(),
        api.usageTimeline(period),
      ]);
      setModels(m ?? []);
      setAccounts(a ?? []);
      setRecent(r ?? []);
      setSummary(s ?? {});
      setCost(c ?? { total: 0, per_model: [] });
      setTimelineData(tl);
      setErr('');
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    return pollWhileVisible(load, 10000);
  }, [period]);

  const fmt = (n?: number) => (n ?? 0).toLocaleString();
  const fmtCompact = (n?: number) => {
    const val = n ?? 0;
    if (val >= 1e9) return (val / 1e9).toFixed(2) + 'B';
    if (val >= 1e6) return (val / 1e6).toFixed(2) + 'M';
    if (val >= 1e3) return (val / 1e3).toFixed(1) + 'k';
    return val.toString();
  };

  // Period-aware and group-aware Model Breakdown Data
  const periodModels = useMemo(() => {
    let baseList: any[] = [];
    if (period === 'all' || !timelineData || !timelineData.totals?.per_model?.length) {
      baseList = models.map((m) => {
        const cm = (cost.per_model ?? []).find((x: any) => x.model === m.model);
        return {
          ...m,
          group: m.group ?? guessModelGroup(m.model),
          cost: cm?.cost ?? 0,
        };
      });
    } else {
      baseList = timelineData.totals.per_model.map((pm) => {
        const allModel = models.find((m) => m.model === pm.model);
        return {
          ...pm,
          group: pm.group ?? guessModelGroup(pm.model || ''),
          avg_latency_ms: allModel?.avg_latency_ms ?? 0,
        };
      });
    }

    if (activeGroup === 'all') return baseList;
    return baseList.filter((m) => m.group === activeGroup);
  }, [period, timelineData, models, cost, activeGroup]);

  // Active statistics based on selected period & group filter
  const displayStats = useMemo(() => {
    const totalCalls = periodModels.reduce((acc, m) => acc + (m.calls ?? 0), 0);
    const totalTokens = periodModels.reduce((acc, m) => acc + (m.total_tokens ?? 0), 0);
    const inputTokens = periodModels.reduce((acc, m) => acc + (m.input_tokens ?? 0), 0);
    const outputTokens = periodModels.reduce((acc, m) => acc + (m.output_tokens ?? 0), 0);
    const reasoningTokens = periodModels.reduce((acc, m) => acc + (m.reasoning_tokens ?? 0), 0);
    const totalCost = periodModels.reduce((acc, m) => acc + (m.cost ?? 0), 0);
    const success = periodModels.reduce((acc, m) => acc + (m.success ?? (m.failed ? 0 : m.calls)), 0);
    const failed = periodModels.reduce((acc, m) => acc + (m.failed ?? 0), 0);

    return {
      calls: totalCalls,
      tokens: totalTokens,
      inputTokens,
      outputTokens,
      reasoningTokens,
      cost: totalCost,
      success,
      failed,
    };
  }, [periodModels]);

  // Timeline chart data formatting (group filtered)
  const chartData = useMemo(() => {
    if (!timelineData || !timelineData.data) return [];
    return timelineData.data.map((b: UsageTimelineBucket) => {
      let bCalls = 0;
      let bSuccess = 0;
      let bFailed = 0;
      let bTokens = 0;
      let bInputTokens = 0;
      let bOutputTokens = 0;
      let bReasoningTokens = 0;
      let bCost = 0;

      if (activeGroup === 'all') {
        bCalls = b.calls;
        bSuccess = b.success;
        bFailed = b.failed;
        bTokens = b.total_tokens;
        bInputTokens = b.input_tokens;
        bOutputTokens = b.output_tokens;
        bReasoningTokens = b.reasoning_tokens;
        bCost = b.cost;
      } else {
        // Scoped by group
        Object.entries(b.models || {}).forEach(([mName, mb]) => {
          if ((mb.group ?? guessModelGroup(mName)) === activeGroup) {
            bCalls += mb.calls ?? 0;
            bSuccess += mb.success ?? 0;
            bFailed += mb.failed ?? 0;
            bTokens += mb.total_tokens ?? 0;
            bInputTokens += mb.input_tokens ?? 0;
            bOutputTokens += mb.output_tokens ?? 0;
            bReasoningTokens += mb.reasoning_tokens ?? 0;
            bCost += mb.cost ?? 0;
          }
        });
      }

      return {
        key: b.key,
        label: b.label,
        calls: bCalls,
        success: bSuccess,
        failed: bFailed,
        tokens: bTokens,
        inputTokens: bInputTokens,
        outputTokens: bOutputTokens,
        reasoningTokens: bReasoningTokens,
        cost: Number(bCost.toFixed(4)),
      };
    });
  }, [timelineData, activeGroup]);

  // Selected bucket details (drill-down)
  const selectedBucket = useMemo(() => {
    if (!selectedBucketKey || !timelineData) return null;
    return timelineData.data.find((b) => b.key === selectedBucketKey) || null;
  }, [selectedBucketKey, timelineData]);

  // Pie chart data (period & group aware)
  const pieData = useMemo(() => {
    return periodModels
      .filter((m) => (m.cost ?? 0) > 0 || (m.calls ?? 0) > 0)
      .map((m) => ({
        name: m.model,
        group: m.group,
        value: Math.round((m.cost ?? 0) * 10000) / 10000,
        calls: m.calls ?? 0,
        tokens: m.total_tokens ?? 0,
      }));
  }, [periodModels]);

  // Sorted model breakdown table data
  const sortedModels = useMemo(() => {
    return [...periodModels].sort((a, b) => {
      let valA = a[sortField] ?? 0;
      let valB = b[sortField] ?? 0;
      return sortAsc ? valA - valB : valB - valA;
    });
  }, [periodModels, sortField, sortAsc]);

  const handleSort = (field: typeof sortField) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(false);
    }
  };

  const periodLabelMap = {
    today: '当日',
    '14days': '近 14 日',
    month: '本月',
    all: '全部汇总',
  };

  return (
    <div className="p-4 sm:p-6 md:p-8 max-w-7xl mx-auto space-y-8 animate-in fade-in duration-300">
      {/* 头部标题与控制栏 */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-2 border-b border-zinc-800/80">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-emerald-500/20 to-teal-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.15)]">
              <TrendingUp className="w-4 h-4" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
                模型用量与成本中心
              </h1>
              <p className="text-zinc-400 text-xs mt-0.5">
                实时统计 Antigravity 与 AgentRouter 模型消耗、Token 分布与费用支出
              </p>
            </div>
          </div>
        </div>

        {/* 顶部筛选区：周期切换 + 模型分组切换 */}
        <div className="flex flex-wrap items-center gap-3">
          {/* 模型分组切换 */}
          <div className="flex p-1 bg-zinc-950 rounded-xl border border-zinc-800 text-xs max-w-full min-w-0 overflow-x-auto [&>button]:shrink-0 [&>button]:whitespace-nowrap">
            <button
              onClick={() => setActiveGroup('all')}
              className={`px-3 py-1.5 rounded-lg font-medium transition-all ${
                activeGroup === 'all'
                  ? 'bg-zinc-800 text-white shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              全部模型
            </button>
            <button
              onClick={() => setActiveGroup('antigravity')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition-all ${
                activeGroup === 'antigravity'
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              Antigravity
            </button>
            <button
              onClick={() => setActiveGroup('agentrouter')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition-all ${
                activeGroup === 'agentrouter'
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
              AgentRouter
            </button>
            <button
              onClick={() => setActiveGroup('workbuddy')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition-all ${
                activeGroup === 'workbuddy'
                  ? 'bg-sky-500/20 text-sky-300 border border-sky-500/30'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-sky-400" />
              WorkBuddy
            </button>
          </div>

          {/* 周期切换 */}
          <div className="flex p-1 bg-zinc-950 rounded-xl border border-zinc-800 text-xs">
            {(['today', '14days', 'month', 'all'] as PeriodType[]).map((p) => (
              <button
                key={p}
                onClick={() => {
                  setPeriod(p);
                  setSelectedBucketKey(null);
                }}
                className={`px-3 py-1.5 rounded-lg font-medium transition-all duration-150 active:scale-95 ${
                  period === p
                    ? 'bg-emerald-600 text-white shadow-sm font-semibold'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/60'
                }`}
              >
                {periodLabelMap[p]}
              </button>
            ))}
          </div>

          <button
            onClick={load}
            disabled={loading}
            className="p-2 rounded-xl bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-zinc-300 text-sm transition-colors"
            title="刷新数据"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {err && (
        <div className="p-4 rounded-xl bg-red-950/50 border border-red-900/50 text-red-300 text-sm">
          {err}
        </div>
      )}

      {activeGroup === 'workbuddy' && (
        <div className="p-4 rounded-xl bg-sky-950/30 border border-sky-900/50 text-sky-200/90 text-xs flex items-start gap-3">
          <Coins className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <div className="font-medium text-sky-200">WorkBuddy 的统计口径与本页不同</div>
            <div className="text-sky-200/70 leading-relaxed">
              本页数据来自各客户端上报到 UI 的 <span className="font-mono">/api/usage/record</span>。
              WorkBuddy 请求直达 <span className="font-mono">127.0.0.1:7863</span> 网关、不经过这里，因此下方列表通常为空。
              它的真实累计数据（请求数 / 成功率 / tokens）请看
              <span className="text-sky-300"> 总览页的 WorkBuddy 卡片</span>，
              数据源是网关自身的 <span className="font-mono">/v1/stats</span>。
            </div>
          </div>
        </div>
      )}

      {/* KPI 卡片组 */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3.5">
        {/* 调用次数卡片 */}
        <div className="p-4 rounded-2xl bg-zinc-900/70 border border-zinc-800/80 shadow-sm group">
          <div className="flex items-center justify-between text-xs text-zinc-400">
            <span className="font-medium">{periodLabelMap[period]}调用</span>
            <div className="w-6 h-6 rounded-lg bg-violet-500/10 border border-violet-500/20 flex items-center justify-center text-violet-400">
              <Zap className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="text-2xl font-bold font-mono tracking-tight text-zinc-100 mt-2">
            {fmt(displayStats.calls)}
          </div>
          <div className="mt-2 text-[11px] flex items-center gap-1.5 text-zinc-400 font-mono">
            <span className="text-emerald-400 flex items-center gap-0.5">
              <CheckCircle2 className="w-3 h-3" /> {fmt(displayStats.success)}
            </span>
            <span>/</span>
            <span className={displayStats.failed ? 'text-red-400' : 'text-zinc-500'}>
              {fmt(displayStats.failed)} 失败
            </span>
          </div>
        </div>

        {/* Total Tokens 卡片 */}
        <div className="p-4 rounded-2xl bg-zinc-900/70 border border-zinc-800/80 shadow-sm group">
          <div className="flex items-center justify-between text-xs text-zinc-400">
            <span className="font-medium">{periodLabelMap[period]} Tokens</span>
            <div className="w-6 h-6 rounded-lg bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-400">
              <BarChart3 className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="text-2xl font-bold font-mono tracking-tight text-zinc-100 mt-2" title={`${fmt(displayStats.tokens)} tokens`}>
            {fmtCompact(displayStats.tokens)}
          </div>
          <div className="mt-2 text-[11px] text-zinc-400 font-mono truncate">
            {fmt(displayStats.tokens)}
          </div>
        </div>

        {/* Input Tokens 卡片 */}
        <div className="p-4 rounded-2xl bg-zinc-900/70 border border-zinc-800/80 shadow-sm group">
          <div className="flex items-center justify-between text-xs text-zinc-400">
            <span className="font-medium">输入 Tokens</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 font-mono">Prompt</span>
          </div>
          <div className="text-2xl font-bold font-mono tracking-tight text-zinc-100 mt-2">
            {fmtCompact(displayStats.inputTokens)}
          </div>
          <div className="mt-2 text-[11px] text-zinc-400 font-mono">
            占比 {displayStats.tokens > 0 ? ((displayStats.inputTokens / displayStats.tokens) * 100).toFixed(1) : 0}%
          </div>
        </div>

        {/* Output & Reasoning Tokens 卡片 */}
        <div className="p-4 rounded-2xl bg-zinc-900/70 border border-zinc-800/80 shadow-sm group">
          <div className="flex items-center justify-between text-xs text-zinc-400">
            <span className="font-medium">输出 / 思考 Tokens</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 font-mono">Output</span>
          </div>
          <div className="text-2xl font-bold font-mono tracking-tight text-zinc-100 mt-2">
            {fmtCompact(displayStats.outputTokens + displayStats.reasoningTokens)}
          </div>
          <div className="mt-2 text-[11px] text-zinc-400 font-mono">
            生成: {fmtCompact(displayStats.outputTokens)} | 思考: {fmtCompact(displayStats.reasoningTokens)}
          </div>
        </div>

        {/* 费用支出卡片 */}
        <div className="p-4 rounded-2xl bg-gradient-to-b from-emerald-950/30 to-zinc-900/70 border border-emerald-500/40 shadow-sm group">
          <div className="flex items-center justify-between text-xs text-emerald-400">
            <span className="font-medium flex items-center gap-1">
              <DollarSign className="w-3.5 h-3.5" /> {periodLabelMap[period]}支出预估
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono">USD</span>
          </div>
          <div className="text-2xl font-bold font-mono tracking-tight text-emerald-400 mt-2">
            ${displayStats.cost.toFixed(4)}
          </div>
          <div className="mt-2 text-[11px] text-emerald-400/80 font-mono flex items-center gap-1">
            <ArrowUpRight className="w-3 h-3" />
            <span>按模型单价实时换算</span>
          </div>
        </div>
      </div>

      {/* 趋势折线图 / 面积图 */}
      <div className="p-5 rounded-2xl bg-zinc-900/70 border border-zinc-800/80 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-zinc-100 flex items-center gap-2">
              <Activity className="w-4 h-4 text-emerald-400" />
              <span>用量趋势走向</span>
              <span className="text-xs text-zinc-400 font-normal">
                （{periodLabelMap[period]} · {activeGroup === 'all' ? '全部模型' : activeGroup === 'agentrouter' ? 'AgentRouter' : activeGroup === 'workbuddy' ? 'WorkBuddy' : 'Antigravity'}）
              </span>
            </h2>
          </div>

          <div className="flex items-center gap-1 p-1 bg-zinc-950 rounded-xl border border-zinc-800 text-xs max-w-full min-w-0 overflow-x-auto [&>button]:shrink-0 [&>button]:whitespace-nowrap">
            {[
              { id: 'tokens', label: 'Token 消耗', icon: BarChart3 },
              { id: 'calls', label: '调用次数', icon: Zap },
              { id: 'cost', label: '费用支出 ($)', icon: DollarSign },
            ].map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setMetricView(id as MetricView)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition-all ${
                  metricView === id
                    ? 'bg-zinc-800 text-emerald-400 shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -15, bottom: 0 }}>
              <defs>
                <linearGradient id="colorTokens" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
                </linearGradient>
                <linearGradient id="colorCalls" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0.0} />
                </linearGradient>
                <linearGradient id="colorCost" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: '#a1a1aa', fontSize: 11 }} />
              <YAxis tick={{ fill: '#a1a1aa', fontSize: 11 }} tickFormatter={(v) => fmtCompact(v)} />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload || !payload.length) return null;
                  const d = payload[0].payload;
                  return (
                    <div className="p-3.5 rounded-xl bg-zinc-900 border border-zinc-700 shadow-2xl text-xs space-y-1.5 font-mono">
                      <div className="font-semibold text-zinc-200 border-b border-zinc-800 pb-1 flex justify-between">
                        <span>{label}</span>
                        <span className="text-zinc-500">{d.key}</span>
                      </div>
                      <div className="text-zinc-300 flex justify-between gap-4">
                        <span>调用次数:</span>
                        <span className="text-violet-400 font-bold">{fmt(d.calls)} 次</span>
                      </div>
                      <div className="text-zinc-300 flex justify-between gap-4">
                        <span>Token 消耗:</span>
                        <span className="text-emerald-400 font-bold">{fmt(d.tokens)}</span>
                      </div>
                      <div className="text-zinc-300 flex justify-between gap-4">
                        <span>费用支出:</span>
                        <span className="text-amber-400 font-bold">${d.cost?.toFixed(4)}</span>
                      </div>
                    </div>
                  );
                }}
              />
              {metricView === 'tokens' && (
                <Area
                  type="monotone"
                  dataKey="tokens"
                  name="Token 消耗"
                  stroke="#10b981"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#colorTokens)"
                />
              )}
              {metricView === 'calls' && (
                <Area
                  type="monotone"
                  dataKey="calls"
                  name="调用次数"
                  stroke="#8b5cf6"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#colorCalls)"
                />
              )}
              {metricView === 'cost' && (
                <Area
                  type="monotone"
                  dataKey="cost"
                  name="费用支出 ($)"
                  stroke="#f59e0b"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#colorCost)"
                />
              )}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 分布图表栅格：饼图与排行榜 */}
      <div className="grid lg:grid-cols-2 gap-4">
        {/* 成本分布环形饼图 (Donut Chart) - 带模型名称与占比的悬浮提示 */}
        <div className="p-5 rounded-2xl bg-zinc-900/70 border border-zinc-800/80 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
              <PieIcon className="w-4 h-4 text-emerald-400" />
              <span>{periodLabelMap[period]}成本分布 ($)</span>
            </h3>
            <span className="text-xs text-zinc-400 font-mono">
              总计 ${displayStats.cost.toFixed(4)}
            </span>
          </div>

          <div className="h-72 relative">
            {pieData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-zinc-500 text-xs">
                所选周期暂无消耗记录
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="45%"
                    innerRadius={55}
                    outerRadius={85}
                    paddingAngle={3}
                  >
                    {pieData.map((_: any, i: number) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  {/* 自定义 Tooltip：悬浮清晰显示【模型名字】+【费用】+【占比】+【分组】 */}
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload || !payload.length) return null;
                      const item = payload[0];
                      const val = Number(item.value || 0);
                      const totalCost = displayStats.cost || 1;
                      const pct = ((val / totalCost) * 100).toFixed(2);
                      const modelGroup = item.payload?.group || guessModelGroup(String(item.name ?? ''));

                      return (
                        <div className="p-3.5 rounded-xl bg-zinc-900/95 border border-zinc-700/80 shadow-2xl text-xs space-y-1.5 backdrop-blur-md">
                          <div className="flex items-center justify-between gap-3 border-b border-zinc-800 pb-1.5">
                            <div className="flex items-center gap-2 font-mono font-semibold text-zinc-100">
                              <span
                                className="w-2.5 h-2.5 rounded-full"
                                style={{ backgroundColor: item.payload?.fill || '#10b981' }}
                              />
                              <span>{item.name}</span>
                            </div>
                            <span
                              className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                                modelGroup === 'agentrouter'
                                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                  : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                              }`}
                            >
                              {modelGroup === 'agentrouter' ? 'AgentRouter' : 'Antigravity'}
                            </span>
                          </div>

                          <div className="space-y-1 pt-0.5 text-zinc-300 font-mono">
                            <div className="flex justify-between gap-4">
                              <span className="text-zinc-400">费用支出:</span>
                              <span className="text-emerald-400 font-bold">${val.toFixed(4)}</span>
                            </div>
                            <div className="flex justify-between gap-4">
                              <span className="text-zinc-400">费用占比:</span>
                              <span className="text-amber-400 font-bold">{pct}%</span>
                            </div>
                            <div className="flex justify-between gap-4">
                              <span className="text-zinc-400">调用次数:</span>
                              <span className="text-zinc-200">{fmt(item.payload?.calls)} 次</span>
                            </div>
                          </div>
                        </div>
                      );
                    }}
                  />
                  <Legend
                    wrapperStyle={{ fontSize: 11, paddingTop: 10 }}
                    formatter={(name) => (
                      <span className="text-zinc-300 text-[11px] font-mono">{name}</span>
                    )}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* 模型调用排行柱状图 (Bar Chart) - 带模型完整名称 */}
        <div className="p-5 rounded-2xl bg-zinc-900/70 border border-zinc-800/80 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-violet-400" />
              <span>{periodLabelMap[period]}模型调用排行</span>
            </h3>
            <span className="text-xs text-zinc-400 font-mono">
              共 {periodModels.filter((m) => m.calls > 0).length} 个活跃模型
            </span>
          </div>

          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={periodModels.map((m) => ({
                  fullName: m.model,
                  name: m.model.length > 18 ? m.model.slice(0, 16) + '…' : m.model,
                  calls: m.calls,
                  cost: m.cost,
                  group: m.group,
                }))}
                margin={{ top: 10, right: 10, left: -20, bottom: 25 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                <XAxis
                  dataKey="name"
                  tick={{ fill: '#a1a1aa', fontSize: 10 }}
                  interval={0}
                  angle={-25}
                  textAnchor="end"
                />
                <YAxis tick={{ fill: '#a1a1aa', fontSize: 10 }} allowDecimals={false} />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload || !payload.length) return null;
                    const d = payload[0].payload;
                    return (
                      <div className="p-3 rounded-xl bg-zinc-900 border border-zinc-700 shadow-2xl text-xs space-y-1 font-mono">
                        <div className="font-bold text-zinc-100 border-b border-zinc-800 pb-1">
                          {d.fullName}
                        </div>
                        <div className="text-zinc-300 flex justify-between gap-3">
                          <span>调用次数:</span>
                          <span className="text-violet-400 font-bold">{fmt(d.calls)} 次</span>
                        </div>
                        <div className="text-zinc-300 flex justify-between gap-3">
                          <span>费用支出:</span>
                          <span className="text-emerald-400 font-bold">${d.cost?.toFixed(4)}</span>
                        </div>
                      </div>
                    );
                  }}
                />
                <Bar dataKey="calls" fill="#8b5cf6" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* 独立明细模型列表（不合并记录，区分 Antigravity 与 AgentRouter 分组） */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-white flex items-center gap-2">
              <Layers className="w-4 h-4 text-emerald-400" />
              <span>模型用量与成本明细列表</span>
            </h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              各模型独立记录、不合并展示；可点击表头进行升降序排列
            </p>
          </div>

          <span className="text-xs text-zinc-400 font-mono">
            展示 {sortedModels.length} 个模型
          </span>
        </div>

        <div className="rounded-2xl border border-zinc-800/80 bg-zinc-900/50 overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-zinc-800/80 bg-zinc-950/60 text-zinc-400 font-medium">
                  <th className="py-3.5 px-4">模型标识 (Model)</th>
                  <th className="py-3.5 px-4">所属分组</th>
                  <th
                    className="py-3.5 px-4 cursor-pointer hover:text-zinc-200"
                    onClick={() => handleSort('calls')}
                  >
                    调用量 (成功/失败) {sortField === 'calls' && (sortAsc ? '▲' : '▼')}
                  </th>
                  <th
                    className="py-3.5 px-4 cursor-pointer hover:text-zinc-200"
                    onClick={() => handleSort('total_tokens')}
                  >
                    总 Tokens {sortField === 'total_tokens' && (sortAsc ? '▲' : '▼')}
                  </th>
                  <th className="py-3.5 px-4">输入 (Prompt)</th>
                  <th className="py-3.5 px-4">生成 / 思考 Tokens</th>
                  <th
                    className="py-3.5 px-4 cursor-pointer hover:text-zinc-200 text-right"
                    onClick={() => handleSort('cost')}
                  >
                    费用支出 ($) {sortField === 'cost' && (sortAsc ? '▲' : '▼')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/50">
                {sortedModels.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-4 sm:p-6 md:p-8 text-center text-zinc-500">
                      暂无模型使用记录
                    </td>
                  </tr>
                ) : (
                  sortedModels.map((m) => {
                    const isAR = m.group === 'agentrouter';
                    const isWB = m.group === 'workbuddy';
                    return (
                      <tr key={m.model} className="hover:bg-zinc-800/30 transition-colors">
                        <td className="py-3.5 px-4 font-mono font-medium text-zinc-100 flex items-center gap-2">
                          <span>{m.model}</span>
                        </td>
                        <td className="py-3.5 px-4">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                              isAR
                                ? 'bg-amber-500/10 text-amber-300 border border-amber-500/20'
                                : isWB
                                ? 'bg-sky-500/10 text-sky-300 border border-sky-500/20'
                                : 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20'
                            }`}
                          >
                            {isAR ? '⚡ AgentRouter' : isWB ? '🪙 WorkBuddy' : '🟢 Antigravity'}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 font-mono">
                          <span className="text-zinc-200 font-semibold">{fmt(m.calls)}</span>
                          <span className="text-zinc-500 text-[11px] ml-1.5">
                            ({fmt(m.success ?? m.calls)} / {fmt(m.failed ?? 0)})
                          </span>
                        </td>
                        <td className="py-3.5 px-4 font-mono text-emerald-400 font-semibold">
                          {fmt(m.total_tokens)}
                        </td>
                        <td className="py-3.5 px-4 font-mono text-zinc-400">
                          {fmt(m.input_tokens)}
                        </td>
                        <td className="py-3.5 px-4 font-mono text-zinc-400">
                          <span className="text-zinc-300">{fmt(m.output_tokens)}</span>
                          {m.reasoning_tokens > 0 && (
                            <span className="text-indigo-400 ml-1 text-[11px]">
                              (+{fmt(m.reasoning_tokens)} 思考)
                            </span>
                          )}
                        </td>
                        <td className="py-3.5 px-4 font-mono font-bold text-right text-emerald-400">
                          ${(m.cost ?? 0).toFixed(4)}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
