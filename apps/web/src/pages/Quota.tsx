import { useEffect, useState } from 'react';
import { RefreshCw, Sparkles, AlertCircle, ShieldCheck, Clock, Layers, CheckCircle2, XCircle } from 'lucide-react';
import { api } from '../lib/api';

function CircleProgress({ percentage, size = 64, strokeWidth = 6, color = '#10b981' }: { percentage: number; size?: number; strokeWidth?: number; color?: string }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (percentage / 100) * circumference;

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="rotate-[-90deg]">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="#27272a"
          strokeWidth={strokeWidth}
          fill="none"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          fill="none"
          className="transition-all duration-700 ease-out"
        />
      </svg>
      <span className="absolute text-xs font-semibold text-zinc-100">{percentage}%</span>
    </div>
  );
}

export default function Quota() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [filterGroup, setFilterGroup] = useState<'all' | 'gemini' | 'claude_gpt'>('all');
  const [err, setErr] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const q = await api.getQuota();
      setData(q);
      setErr('');
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, []);

  const models = (data?.models ?? []).filter((m: any) => filterGroup === 'all' || m.group === filterGroup);

  return (
    <div className="p-8 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Models & Usage</h1>
          <p className="text-zinc-400 text-sm mt-1">实时监控 Antigravity 官方配额、订阅层级与模型刷新倒计时</p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-sm transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> 刷新
        </button>
      </div>

      {err && (
        <div className="mb-6 p-4 rounded-xl bg-red-950/60 border border-red-900 text-red-300 text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{err}</span>
        </div>
      )}

      {data && !data.online && (
        <div className="mb-6 p-4 rounded-xl bg-amber-950/50 border border-amber-800/80 text-amber-200 text-sm flex items-start gap-3">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-amber-400" />
          <div>
            <div className="font-medium">未检测到正在运行的 Antigravity 客户端</div>
            <div className="text-xs text-amber-300/80 mt-1">{data.message || '请打开 Antigravity IDE 客户端以读取实时配额。'}</div>
          </div>
        </div>
      )}

      {/* Plan Card */}
      <div className="mb-6 p-5 rounded-2xl bg-zinc-900 border border-zinc-800/80 flex items-center justify-between">
        <div>
          <div className="text-xs text-zinc-400 font-medium uppercase tracking-wider">Plan</div>
          <div className="text-lg font-semibold mt-1 flex items-center gap-2">
            <span>Your Plan: {data?.plan || 'Google AI Pro'}</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-sky-950 text-sky-400 border border-sky-800/60 font-normal">
              {data?.email || 'pilaoban2004@gmail.com'}
            </span>
          </div>
          <div className="text-xs text-zinc-400 mt-1">
            {data?.planDescription || 'You can upgrade to a Google AI Ultra plan to receive higher rate limits.'}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="px-3.5 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-xs font-medium text-white transition-colors cursor-default">
            Active Tier
          </span>
        </div>
      </div>

      {/* Model Credits (if available) */}
      {data?.promptCredits && (
        <div className="mb-6 p-5 rounded-2xl bg-zinc-900 border border-zinc-800/80">
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-medium text-zinc-200 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-400" /> Prompt Credits
            </div>
            <span className="text-xs text-zinc-400">
              {data.promptCredits.available.toLocaleString()} / {data.promptCredits.monthly.toLocaleString()}
            </span>
          </div>
          <div className="w-full h-2 rounded-full bg-zinc-800 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-amber-500 to-emerald-400 rounded-full transition-all duration-500"
              style={{ width: `${Math.min(100, Math.max(1, data.promptCredits.remainingPercentage))}%` }}
            />
          </div>
        </div>
      )}

      {/* Quota Summary Cards (Official Styled) */}
      <div className="grid md:grid-cols-2 gap-4 mb-8">
        {/* Gemini Models Summary */}
        <div className="p-5 rounded-2xl bg-zinc-900/90 border border-zinc-800/80 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium text-zinc-200">
              <Layers className="w-4 h-4 text-emerald-400" /> Gemini Models
            </div>
            <div className="text-xs text-zinc-400 mt-2">
              {data?.summary?.gemini?.earliestReset
                ? `将于 ${data.summary.gemini.earliestReset}`
                : '配额处于健康可用状态'}
            </div>
            <div className="text-xs text-zinc-500 mt-1">包含 3.7 Flash, 3.6 Flash, 3.5 Flash, 3.1 Pro 等</div>
          </div>
          <CircleProgress
            percentage={data?.summary?.gemini?.remainingPercentage ?? 100}
            color={
              (data?.summary?.gemini?.remainingPercentage ?? 100) > 50
                ? '#10b981'
                : (data?.summary?.gemini?.remainingPercentage ?? 100) > 20
                ? '#f59e0b'
                : '#ef4444'
            }
          />
        </div>

        {/* Claude and GPT Models Summary */}
        <div className="p-5 rounded-2xl bg-zinc-900/90 border border-zinc-800/80 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium text-zinc-200">
              <ShieldCheck className="w-4 h-4 text-violet-400" /> Claude & GPT Models
            </div>
            <div className="text-xs text-zinc-400 mt-2">
              {data?.summary?.claude_gpt?.earliestReset
                ? `将于 ${data.summary.claude_gpt.earliestReset}`
                : '配额处于健康可用状态'}
            </div>
            <div className="text-xs text-zinc-500 mt-1">包含 Claude Sonnet 4.6, Opus 4.6, GPT-OSS 120B 等</div>
          </div>
          <CircleProgress
            percentage={data?.summary?.claude_gpt?.remainingPercentage ?? 100}
            color={
              (data?.summary?.claude_gpt?.remainingPercentage ?? 100) > 50
                ? '#8b5cf6'
                : (data?.summary?.claude_gpt?.remainingPercentage ?? 100) > 20
                ? '#f59e0b'
                : '#ef4444'
            }
          />
        </div>
      </div>

      {/* Model Detailed Quota Table */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-medium text-zinc-200">所有模型配额明细</h2>
        <div className="flex gap-1.5 p-1 rounded-lg bg-zinc-900 border border-zinc-800">
          {(
            [
              { id: 'all', label: '全部' },
              { id: 'gemini', label: 'Gemini 系列' },
              { id: 'claude_gpt', label: 'Claude / GPT 系列' },
            ] as const
          ).map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setFilterGroup(id)}
              className={`px-3 py-1 rounded text-xs transition-colors ${
                filterGroup === id ? 'bg-zinc-800 text-white font-medium' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-zinc-800 bg-zinc-950 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-zinc-400 border-b border-zinc-800 text-xs">
              <th className="px-4 py-3 font-medium">模型名称</th>
              <th className="px-4 py-3 font-medium">所属分组</th>
              <th className="px-4 py-3 font-medium">剩余配额</th>
              <th className="px-4 py-3 font-medium">重置倒计时</th>
              <th className="px-4 py-3 font-medium text-right">状态</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/60">
            {models.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-zinc-500">
                  暂无模型配额信息
                </td>
              </tr>
            )}
            {models.map((m: any, idx: number) => {
              const pct = m.remainingPercentage ?? 100;
              const barColor = pct > 50 ? 'bg-emerald-500' : pct > 20 ? 'bg-amber-500' : 'bg-red-500';

              return (
                <tr key={`${m.modelId}-${idx}`} className="hover:bg-zinc-900/40 transition-colors">
                  <td className="px-4 py-3 font-medium text-zinc-200">
                    <div>{m.label}</div>
                    <div className="text-[11px] font-mono text-zinc-500 mt-0.5">{m.modelId}</div>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    <span
                      className={`px-2 py-0.5 rounded-md ${
                        m.group === 'gemini'
                          ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-800/50'
                          : 'bg-violet-950/60 text-violet-400 border border-violet-800/50'
                      }`}
                    >
                      {m.group === 'gemini' ? 'Gemini' : 'Claude / GPT'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-24 h-2 rounded-full bg-zinc-800 overflow-hidden">
                        <div className={`h-full ${barColor} rounded-full transition-all`} style={{ width: `${pct}%` }} />
                      </div>
                      <span className="font-mono text-xs font-semibold text-zinc-200">{pct}%</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-zinc-400 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-zinc-500" />
                    <span>{m.timeRemaining || '—'}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {m.isExhausted ? (
                      <span className="inline-flex items-center gap-1 text-xs text-red-400">
                        <XCircle className="w-3.5 h-3.5" /> 已耗尽
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs text-emerald-400">
                        <CheckCircle2 className="w-3.5 h-3.5" /> 可用
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
