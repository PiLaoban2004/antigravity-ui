import { useEffect, useState } from 'react';
import { RefreshCw, BarChart3, Users, ScrollText, DollarSign } from 'lucide-react';
import {
  ResponsiveContainer,
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

const COLORS = ['#8b5cf6', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#14b8a6', '#a855f7', '#eab308', '#64748b'];

export default function Usage() {
  const [models, setModels] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [recent, setRecent] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>({});
  const [cost, setCost] = useState<any>({ total: 0, per_model: [] });
  const [err, setErr] = useState('');

  const load = async () => {
    try {
      const [m, a, r, s, c] = await Promise.all([
        api.usageModels(),
        api.usageAccounts(),
        api.usageRecent(),
        api.usageSummary(),
        api.usageCost(),
      ]);
      setModels(m);
      setAccounts(a);
      setRecent(r);
      setSummary(s);
      setCost(c);
      setErr('');
    } catch (e) {
      setErr(String(e));
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, []);

  const fmt = (n?: number) => (n ?? 0).toLocaleString();
  const maxCalls = Math.max(1, ...models.map((m) => m.calls));

  // chart data
  const pieData = (cost.per_model ?? []).map((m: any) => ({ name: m.model, value: Math.round(m.cost * 10000) / 10000 }));
  const barData = models.map((m) => ({ name: m.model.replace('gemini-', '').replace('-flash', '').replace('-pro', ''), calls: m.calls }));

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">模型用量</h1>
          <p className="text-zinc-400 text-sm mt-1">调用次数、token 消耗与成本估算（每 10 秒刷新）</p>
        </div>
        <button onClick={load} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-sm">
          <RefreshCw className="w-4 h-4" /> 刷新
        </button>
      </div>

      {err && <div className="mb-4 p-3 rounded-lg bg-red-950 border border-red-900 text-red-300 text-sm">{err}</div>}

      {/* summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
        {[
          { label: '总调用次数', value: fmt(summary.total_calls) },
          { label: '总 tokens', value: fmt(summary.total_tokens) },
          { label: '输入 tokens', value: fmt(summary.input_tokens) },
          { label: '输出 tokens', value: fmt(summary.output_tokens) },
        ].map(({ label, value }) => (
          <div key={label} className="p-5 rounded-xl bg-zinc-900 border border-zinc-800">
            <div className="text-sm text-zinc-400">{label}</div>
            <div className="text-2xl font-semibold mt-2">{value}</div>
          </div>
        ))}
        <div className="p-5 rounded-xl bg-zinc-900 border border-emerald-800/50">
          <div className="text-sm text-zinc-400 flex items-center gap-1.5">
            <DollarSign className="w-3.5 h-3.5 text-emerald-400" /> 估算成本
          </div>
          <div className="text-2xl font-semibold mt-2 text-emerald-400">${(cost.total ?? 0).toFixed(4)}</div>
        </div>
      </div>

      {/* charts */}
      <div className="grid lg:grid-cols-2 gap-4 mb-8">
        <div className="p-5 rounded-xl bg-zinc-900 border border-zinc-800">
          <h3 className="text-sm font-medium text-zinc-300 mb-3">消耗分布（按成本 $）</h3>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={85} paddingAngle={2}>
                  {pieData.map((_: any, i: number) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ background: '#18181b', border: '1px solid #3f3f46', borderRadius: 8 }} formatter={(v: any) => `$${Number(v).toFixed(4)}`} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="p-5 rounded-xl bg-zinc-900 border border-zinc-800">
          <h3 className="text-sm font-medium text-zinc-300 mb-3">模型消耗次数</h3>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={barData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis dataKey="name" tick={{ fill: '#a1a1aa', fontSize: 11 }} interval={0} angle={-30} textAnchor="end" height={60} />
                <YAxis tick={{ fill: '#a1a1aa', fontSize: 11 }} allowDecimals={false} />
                <Tooltip contentStyle={{ background: '#18181b', border: '1px solid #3f3f46', borderRadius: 8 }} />
                <Bar dataKey="calls" name="调用次数" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* model usage table */}
      <h2 className="text-lg font-medium mb-3 flex items-center gap-2">
        <BarChart3 className="w-5 h-5 text-violet-400" /> 模型明细
      </h2>
      <div className="rounded-xl border border-zinc-800 bg-zinc-950 overflow-hidden mb-8">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-zinc-400 border-b border-zinc-800">
              <th className="px-4 py-2 font-medium">模型</th>
              <th className="px-4 py-2 font-medium">调用次数</th>
              <th className="px-4 py-2 font-medium">成功/失败</th>
              <th className="px-4 py-2 font-medium">输入 tokens</th>
              <th className="px-4 py-2 font-medium">输出 tokens</th>
              <th className="px-4 py-2 font-medium">平均耗时</th>
              <th className="px-4 py-2 font-medium">估算成本</th>
            </tr>
          </thead>
          <tbody>
            {models.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-zinc-500">暂无用量数据（使用模型后自动统计）</td></tr>
            )}
            {models.map((m) => {
              const cm = (cost.per_model ?? []).find((x: any) => x.model === m.model);
              return (
                <tr key={m.model} className="border-b border-zinc-800/60 hover:bg-zinc-900/50">
                  <td className="px-4 py-2 font-mono text-xs">{m.model}</td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      <div className="w-24 h-2 rounded-full bg-zinc-800 overflow-hidden">
                        <div className="h-full bg-violet-500" style={{ width: `${(m.calls / maxCalls) * 100}%` }} />
                      </div>
                      <span className="font-medium">{fmt(m.calls)}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2">
                    <span className="text-emerald-400">{m.success ?? 0}</span>
                    <span className="text-zinc-600"> / </span>
                    <span className={m.failed ? 'text-red-400' : 'text-zinc-500'}>{m.failed ?? 0}</span>
                  </td>
                  <td className="px-4 py-2 text-zinc-300">{fmt(m.input_tokens)}</td>
                  <td className="px-4 py-2 text-zinc-300">{fmt(m.output_tokens)}</td>
                  <td className="px-4 py-2 text-zinc-400">{m.avg_latency_ms ? `${Math.round(m.avg_latency_ms)}ms` : '—'}</td>
                  <td className="px-4 py-2 text-emerald-400">${(cm?.cost ?? 0).toFixed(4)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* account usage */}
      <h2 className="text-lg font-medium mb-3 flex items-center gap-2">
        <Users className="w-5 h-5 text-sky-400" /> 账号使用统计
      </h2>
      <div className="grid gap-2 mb-8">
        {accounts.length === 0 && <div className="text-zinc-500 text-sm p-6 text-center border border-dashed border-zinc-800 rounded-xl">暂无数据</div>}
        {accounts.map((a) => (
          <div key={a.account} className="p-4 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-between">
            <span className="font-medium">{a.account}</span>
            <div className="flex gap-6 text-sm text-zinc-400">
              <span>调用 {fmt(a.calls)}</span>
              <span>tokens {fmt(a.total_tokens)}</span>
              <span className={a.failed ? 'text-red-400' : 'text-zinc-500'}>失败 {a.failed}</span>
            </div>
          </div>
        ))}
      </div>

      {/* recent requests */}
      <h2 className="text-lg font-medium mb-3 flex items-center gap-2">
        <ScrollText className="w-5 h-5 text-emerald-400" /> 最近请求
      </h2>
      <div className="rounded-xl border border-zinc-800 bg-zinc-950 overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-zinc-400 border-b border-zinc-800">
              <th className="px-4 py-2 font-medium">时间</th>
              <th className="px-4 py-2 font-medium">模型</th>
              <th className="px-4 py-2 font-medium">账号</th>
              <th className="px-4 py-2 font-medium">tokens</th>
              <th className="px-4 py-2 font-medium">耗时</th>
              <th className="px-4 py-2 font-medium">状态</th>
            </tr>
          </thead>
          <tbody>
            {recent.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-zinc-500">暂无记录</td></tr>
            )}
            {recent.map((r) => (
              <tr key={r.id} className="border-b border-zinc-800/60">
                <td className="px-4 py-2 text-zinc-400">{new Date(r.ts).toLocaleTimeString()}</td>
                <td className="px-4 py-2 font-mono">{r.model}</td>
                <td className="px-4 py-2 text-zinc-400">{r.account}</td>
                <td className="px-4 py-2 text-zinc-300">{fmt(r.total_tokens)}</td>
                <td className="px-4 py-2 text-zinc-400">{r.latency_ms}ms</td>
                <td className="px-4 py-2">{r.failed ? <span className="text-red-400">失败</span> : <span className="text-emerald-400">成功</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
