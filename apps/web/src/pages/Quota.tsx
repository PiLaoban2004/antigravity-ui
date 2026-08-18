import { useEffect, useState } from 'react';
import { RefreshCw, AlertCircle, Info, ChevronDown, ChevronUp, Clock, CheckCircle2, XCircle } from 'lucide-react';
import { api } from '../lib/api';

function CircleProgress({ percentage, size = 44, strokeWidth = 4, color = '#22c55e' }: { percentage: number; size?: number; strokeWidth?: number; color?: string }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (percentage / 100) * circumference;

  return (
    <div className="relative flex items-center justify-center shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="rotate-[-90deg]">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="#1c1c1f"
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
      <span className="absolute text-[11px] font-medium text-zinc-200">{percentage}%</span>
    </div>
  );
}

export default function Quota() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [creditOverage, setCreditOverage] = useState(false);
  const [showDetails, setShowDetails] = useState(true);
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

  const gemini = data?.summary?.gemini;
  const claude = data?.summary?.claude_gpt;

  return (
    <div className="p-10 max-w-4xl font-sans text-zinc-100">
      {/* Top Header */}
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight text-white">Models & Usage</h1>
          <button
            onClick={load}
            disabled={loading}
            title="刷新配额"
            className="p-1 rounded text-zinc-400 hover:text-white transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>
      <p className="text-zinc-400 text-sm mb-6">Manage your model quota and credits.</p>

      {err && (
        <div className="mb-6 p-4 rounded-xl bg-red-950/60 border border-red-900 text-red-300 text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{err}</span>
        </div>
      )}

      {data && !data.online && (
        <div className="mb-6 p-4 rounded-xl bg-zinc-900 border border-amber-800/80 text-amber-200 text-sm flex items-start gap-3">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-amber-400" />
          <div>
            <div className="font-medium">未检测到正在运行的 Antigravity 客户端</div>
            <div className="text-xs text-zinc-400 mt-1">{data.message || '请打开 Antigravity IDE 客户端以读取实时配额。'}</div>
          </div>
        </div>
      )}

      {/* Plan Section */}
      <div className="mb-6">
        <div className="text-sm font-semibold text-zinc-200 mb-2">Plan</div>
        <div className="p-4 rounded-xl bg-[#141416] border border-[#232326] flex items-center justify-between">
          <div>
            <div className="text-[15px] font-semibold text-white">
              Your Plan: {data?.plan || 'Google AI Pro'}
            </div>
            <div className="text-xs text-zinc-400 mt-0.5">
              {data?.planDescription || 'You can upgrade to a Google AI Ultra plan to receive higher rate limits.'}
            </div>
          </div>
          <button
            onClick={() => window.open('https://antigravity.google/g1-upgrade', '_blank')}
            className="px-4 py-1.5 rounded-lg bg-[#0070f3] hover:bg-[#0060df] text-xs font-semibold text-white transition-colors"
          >
            Upgrade
          </button>
        </div>
      </div>

      {/* Model Credits Section */}
      <div className="mb-6">
        <div className="text-sm font-semibold text-zinc-200 mb-2">Model Credits</div>
        <div className="p-4 rounded-xl bg-[#141416] border border-[#232326]">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-[14px] font-medium text-white">Enable AI Credit Overages</div>
              <div className="text-xs text-zinc-400 mt-1 max-w-xl leading-relaxed">
                When toggled on, Antigravity will use your AI credits to fulfill model requests once you're out of model quota. Antigravity will always use your model quota first before using AI credits.
              </div>
            </div>
            <button
              onClick={() => setCreditOverage(!creditOverage)}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                creditOverage ? 'bg-emerald-500' : 'bg-zinc-700'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                  creditOverage ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </div>
      </div>

      {/* Gemini Models Quota Section */}
      <div className="mb-6">
        <div className="text-sm font-semibold text-zinc-200 mb-2 flex items-center gap-1.5">
          <span>Gemini Models</span>
          <Info className="w-3.5 h-3.5 text-zinc-500 cursor-help" />
        </div>
        <div className="rounded-xl bg-[#141416] border border-[#232326] divide-y divide-[#232326]">
          {/* Weekly Limit */}
          <div className="p-4 flex items-center justify-between">
            <div>
              <div className="text-[14px] font-medium text-white">Weekly Limit Remaining</div>
              <div className="text-xs text-zinc-400 mt-0.5">
                You have used some of your weekly limit, it will fully refresh in {gemini?.weeklyResetEn || '17 hours, 2 minutes'}.
              </div>
            </div>
            <CircleProgress percentage={gemini?.weeklyLimitRemaining ?? 89} color="#22c55e" />
          </div>
          {/* Five Hour Limit */}
          <div className="p-4 flex items-center justify-between">
            <div>
              <div className="text-[14px] font-medium text-white">Five Hour Limit Remaining</div>
              <div className="text-xs text-zinc-400 mt-0.5">
                You have used some of your 5-hour limit, it will fully refresh in {gemini?.fiveHourResetEn || '2 hours, 52 minutes'}.
              </div>
            </div>
            <CircleProgress percentage={gemini?.fiveHourLimitRemaining ?? 79} color="#22c55e" />
          </div>
        </div>
      </div>

      {/* Claude and GPT Models Quota Section */}
      <div className="mb-8">
        <div className="text-sm font-semibold text-zinc-200 mb-2 flex items-center gap-1.5">
          <span>Claude and GPT models</span>
          <Info className="w-3.5 h-3.5 text-zinc-500 cursor-help" />
        </div>
        <div className="rounded-xl bg-[#141416] border border-[#232326] divide-y divide-[#232326]">
          {/* Weekly Limit */}
          <div className="p-4 flex items-center justify-between">
            <div>
              <div className="text-[14px] font-medium text-white">Weekly Limit Remaining</div>
              <div className="text-xs text-zinc-400 mt-0.5">
                You have used some of your weekly limit, it will fully refresh in {claude?.weeklyResetEn || '17 hours, 25 minutes'}.
              </div>
            </div>
            <CircleProgress percentage={claude?.weeklyLimitRemaining ?? 42} color="#16a34a" />
          </div>
          {/* Five Hour Limit */}
          <div className="p-4 flex items-center justify-between">
            <div>
              <div className="text-[14px] font-medium text-white">Five Hour Limit Remaining</div>
              <div className="text-xs text-zinc-400 mt-0.5">
                You have used some of your 5-hour limit, it will fully refresh in {claude?.fiveHourResetEn || 'fully refreshed'}.
              </div>
            </div>
            <CircleProgress percentage={claude?.fiveHourLimitRemaining ?? 100} color="#22c55e" />
          </div>
        </div>
      </div>

      {/* Expandable Model Details Table */}
      <div className="border-t border-zinc-800/80 pt-6">
        <button
          onClick={() => setShowDetails(!showDetails)}
          className="flex items-center justify-between w-full text-left mb-3 group"
        >
          <span className="text-sm font-semibold text-zinc-300 group-hover:text-white transition-colors">
            各个模型详细配额清单 ({models.length})
          </span>
          {showDetails ? <ChevronUp className="w-4 h-4 text-zinc-400" /> : <ChevronDown className="w-4 h-4 text-zinc-400" />}
        </button>

        {showDetails && (
          <>
            <div className="flex gap-1.5 p-1 rounded-lg bg-[#141416] border border-[#232326] w-fit mb-3">
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

            <div className="rounded-xl border border-[#232326] bg-[#141416] overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-zinc-400 border-b border-[#232326] text-xs">
                    <th className="px-4 py-3 font-medium">模型名称</th>
                    <th className="px-4 py-3 font-medium">所属池</th>
                    <th className="px-4 py-3 font-medium">5小时剩余配额</th>
                    <th className="px-4 py-3 font-medium">重置倒计时</th>
                    <th className="px-4 py-3 font-medium text-right">状态</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#232326]">
                  {models.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-6 text-center text-zinc-500 text-xs">
                        暂无模型配额信息
                      </td>
                    </tr>
                  )}
                  {models.map((m: any, idx: number) => {
                    const pct = m.remainingPercentage ?? 100;
                    const barColor = pct > 50 ? 'bg-emerald-500' : pct > 20 ? 'bg-amber-500' : 'bg-red-500';

                    return (
                      <tr key={`${m.modelId}-${idx}`} className="hover:bg-zinc-900/40 transition-colors">
                        <td className="px-4 py-2.5 text-xs text-zinc-200">
                          <div className="font-medium">{m.label}</div>
                          <div className="text-[10px] font-mono text-zinc-500 mt-0.5">{m.modelId}</div>
                        </td>
                        <td className="px-4 py-2.5 text-xs">
                          <span
                            className={`px-2 py-0.5 rounded text-[11px] ${
                              m.group === 'gemini'
                                ? 'bg-emerald-950/40 text-emerald-400 border border-emerald-800/40'
                                : 'bg-violet-950/40 text-violet-400 border border-violet-800/40'
                            }`}
                          >
                            {m.group === 'gemini' ? 'Gemini' : 'Claude / GPT'}
                          </span>
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            <div className="w-20 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                              <div className={`h-full ${barColor} rounded-full transition-all`} style={{ width: `${pct}%` }} />
                            </div>
                            <span className="font-mono text-xs text-zinc-300">{pct}%</span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-zinc-400 flex items-center gap-1.5">
                          <Clock className="w-3 h-3 text-zinc-500" />
                          <span>{m.timeRemainingEn || '—'}</span>
                        </td>
                        <td className="px-4 py-2.5 text-right">
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
          </>
        )}
      </div>
    </div>
  );
}
