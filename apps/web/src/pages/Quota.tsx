import { useEffect, useState, useCallback } from 'react';
import { RefreshCw, AlertCircle, Info, ChevronDown, ChevronUp, Clock, CheckCircle2, XCircle, User, ExternalLink, ShieldAlert, Power } from 'lucide-react';
import { api } from '../lib/api';
import { pollWhileVisible } from '../lib/poll';

function CircleProgress({ percentage, size = 44, strokeWidth = 4, color = '#22c55e', label }: { percentage: number | null; size?: number; strokeWidth?: number; color?: string; label?: string }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - ((percentage ?? 0) / 100) * circumference;

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
          stroke={percentage === 0 || percentage === null ? '#3f3f46' : color}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          fill="none"
          className="transition-all duration-700 ease-out"
        />
      </svg>
      <span className="absolute text-[11px] font-medium text-zinc-200">
        {label || (percentage === null ? '--' : `${percentage}%`)}
      </span>
    </div>
  );
}

function agoZh(iso?: string): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(t)) return '';
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins} 分钟前`;
  return `${Math.floor(mins / 60)} 小时 ${mins % 60} 分钟前`;
}

export default function Quota() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [selectedEmail, setSelectedEmail] = useState<string>('');
  const [creditOverage, setCreditOverage] = useState(false);
  const [showDetails, setShowDetails] = useState(true);
  const [filterGroup, setFilterGroup] = useState<'all' | 'gemini' | 'claude_gpt'>('all');
  const [err, setErr] = useState('');

  const load = useCallback(async (email?: string) => {
    setLoading(true);
    try {
      const q = await api.getQuota(email || undefined);
      setData(q);
      if (!selectedEmail && q.selectedAccount) {
        setSelectedEmail(q.selectedAccount);
      }
      setErr('');
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }, [selectedEmail]);

  useEffect(() => {
    load(selectedEmail);
    return pollWhileVisible(() => load(selectedEmail), 30000);
  }, [load, selectedEmail]);

  const handleSwitchAccount = (email: string) => {
    setSelectedEmail(email);
    load(email);
  };

  const models = (data?.models ?? []).filter((m: any) => filterGroup === 'all' || m.group === filterGroup);
  const gemini = data?.summary?.gemini;
  const claude = data?.summary?.claude_gpt;
  const accounts: any[] = data?.accounts ?? [];

  // `null` from the server means "unknown", which is deliberately not rendered as 100%.
  const unknownNote = data?.isCached
    ? '缓存中的该额度窗口已重置，数值已过期。在 Antigravity IDE 中登录该账号并打开本页可获取最新额度。'
    : '该账号不是本机 Antigravity IDE 当前登录的账号，无法读取真实额度。';

  const isCurrentDisabled = data?.accountState === 'disabled';
  const isCurrentError = data?.accountState === 'error';
  const isCurrentCooldown = data?.accountState === 'cooldown' || Boolean(data?.cooldowns && data.cooldowns.length > 0);

  return (
    <div className="p-4 sm:p-6 md:p-10 max-w-4xl font-sans text-zinc-100">
      {/* Top Header */}
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight text-white">Models & Usage</h1>
          <button
            onClick={() => load(selectedEmail)}
            disabled={loading}
            title="刷新配额"
            className="p-1 rounded text-zinc-400 hover:text-white transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>
      <p className="text-zinc-400 text-sm mb-6">Manage your model quota and credits across accounts.</p>

      {/* Account Switcher Bar */}
      {accounts.length > 0 && (
        <div className="mb-6">
          <div className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <User className="w-3.5 h-3.5" /> 点击切换查看各账号额度
          </div>
          <div className="flex flex-wrap gap-2">
            {accounts.map((a) => {
              const isSelected = (selectedEmail || data?.selectedAccount) === a.email;
              const isErr = a.status === 'error';
              const isDis = a.disabled;
              const hasCooldown = a.cooldowns && a.cooldowns.length > 0;

              return (
                <button
                  key={a.email}
                  onClick={() => handleSwitchAccount(a.email)}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-medium border transition-all ${
                    isSelected
                      ? 'bg-zinc-800 text-white border-zinc-500 shadow-md ring-1 ring-zinc-500'
                      : 'bg-[#141416] text-zinc-400 border-[#232326] hover:border-zinc-700 hover:text-zinc-200'
                  }`}
                >
                  <span
                    className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                      isDis
                        ? 'bg-zinc-600'
                        : isErr
                        ? 'bg-red-500'
                        : hasCooldown
                        ? 'bg-amber-400'
                        : 'bg-emerald-400'
                    }`}
                  />
                  <span className="font-mono">{a.email}</span>
                  {a.isCurrentIde && (
                    <span className="text-[10px] px-1.5 py-0.2 rounded bg-sky-950 text-sky-400 border border-sky-800/40">
                      IDE
                    </span>
                  )}
                  {hasCooldown && (
                    <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-950 text-amber-400 border border-amber-800/40">
                      429 冷却
                    </span>
                  )}
                  {isDis && (
                    <span className="text-[10px] px-1.5 py-0.2 rounded bg-zinc-800 text-zinc-400">
                      已禁用
                    </span>
                  )}
                  {isErr && (
                    <span className="text-[10px] px-1.5 py-0.2 rounded bg-red-950 text-red-400 border border-red-800/40">
                      需验证
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {err && (
        <div className="mb-6 p-4 rounded-xl bg-red-950/60 border border-red-900 text-red-300 text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{err}</span>
        </div>
      )}

      {/* Account Cooldown Notice Banner */}
      {isCurrentCooldown && (
        <div className="mb-6 p-4 rounded-xl bg-amber-950/40 border border-amber-800/80 text-amber-200 text-sm flex items-start gap-3">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-amber-400" />
          <div>
            <div className="font-semibold text-amber-300">该账号上游已触发 Google 429 配额用尽（冷却中）</div>
            <div className="text-xs text-amber-200/80 mt-1">
              CLIProxyAPI 反代网关已捕获 Google 429 限流保护信号，预计剩余冷却时间：{data?.cooldownZh || gemini?.fiveHourResetZh || '数小时'}。网关在此期间已执行保护性熔断，倒计时结束后将自动恢复该账号请求分流。
            </div>
          </div>
        </div>
      )}

      {/* Account State Notice Banner */}
      {isCurrentDisabled && (
        <div className="mb-6 p-4 rounded-xl bg-zinc-900 border border-zinc-700 text-zinc-300 text-sm flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Power className="w-4 h-4 text-zinc-400" />
            <div>
              <span className="font-medium text-white">该账号当前已在反代路由池中被设为「禁用」</span>
              <div className="text-xs text-zinc-400 mt-0.5">请求不会路由到该账号。如需恢复使用，请前往「路由策略」页面启用。</div>
            </div>
          </div>
          <span className="px-2.5 py-1 rounded bg-zinc-800 text-xs text-zinc-300 shrink-0">已禁用</span>
        </div>
      )}

      {data?.validationUrl && (
        <div className="mb-6 p-4 rounded-xl bg-amber-950/40 border border-amber-800/80 text-amber-200 text-sm flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <ShieldAlert className="w-5 h-5 shrink-0 mt-0.5 text-amber-400" />
            <div>
              <div className="font-semibold text-amber-300">该账号需要完成 Google 激活验证</div>
              <div className="text-xs text-amber-200/80 mt-1">
                Google 识别到此新账号尚未激活 Gemini Code Assist，需要完成首次安全验证后才开放 API 调用。
              </div>
            </div>
          </div>
          <button
            onClick={() => window.open(data.validationUrl, '_blank')}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-xs font-semibold text-white shrink-0 transition-colors"
          >
            前往 Google 验证 <ExternalLink className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Plan Section */}
      <div className="mb-6">
        <div className="text-sm font-semibold text-zinc-200 mb-2 flex items-center justify-between">
          <span>Plan</span>
          {data?.isCached && (
            <span className="text-[11px] text-zinc-400 font-normal">
              缓存数据 · 记录于 {agoZh(data.cachedAt)}
            </span>
          )}
        </div>
        <div className="p-4 rounded-xl bg-[#141416] border border-[#232326] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[15px] font-semibold text-white flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span>Your Plan: {data?.plan || '套餐未知'}</span>
              <span className="text-xs font-normal text-zinc-400 font-mono break-all">({data?.selectedAccount || data?.email})</span>
            </div>
            {data?.planDescription && <div className="text-xs text-zinc-400 mt-0.5">{data.planDescription}</div>}
          </div>
          <button
            onClick={() => window.open('https://antigravity.google/g1-upgrade', '_blank')}
            className="shrink-0 self-start sm:self-auto px-4 py-1.5 rounded-lg bg-[#0070f3] hover:bg-[#0060df] text-xs font-semibold text-white transition-colors"
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
                {isCurrentDisabled
                  ? '账号已在反代路由中禁用'
                  : isCurrentError
                  ? '账号状态异常 / 尚未完成验证'
                  : isCurrentCooldown
                  ? `上游 429 冷却中，预计恢复时间：${data?.cooldownZh || gemini?.weeklyResetZh || '2 小时'}`
                  : gemini?.weeklyLimitRemaining == null
                  ? unknownNote
                  : `You have used some of your weekly limit, it will fully refresh in ${gemini?.weeklyResetEn || 'fully refreshed'}.`}
              </div>
            </div>
            <CircleProgress
              percentage={gemini?.weeklyLimitRemaining ?? (isCurrentDisabled || isCurrentError || isCurrentCooldown ? 0 : null)}
              color={isCurrentDisabled || isCurrentError ? '#52525b' : isCurrentCooldown ? '#f59e0b' : '#22c55e'}
            />
          </div>
          {/* Five Hour Limit */}
          <div className="p-4 flex items-center justify-between">
            <div>
              <div className="text-[14px] font-medium text-white">Five Hour Limit Remaining</div>
              <div className="text-xs text-zinc-400 mt-0.5">
                {isCurrentDisabled
                  ? '账号已在反代路由中禁用'
                  : isCurrentError
                  ? '账号状态异常 / 尚未完成验证'
                  : isCurrentCooldown
                  ? `5小时配额用尽，冷却重置倒计时：${data?.cooldownZh || gemini?.fiveHourResetZh || '2 小时'}`
                  : gemini?.fiveHourLimitRemaining == null
                  ? unknownNote
                  : `You have used some of your 5-hour limit, it will fully refresh in ${gemini?.fiveHourResetEn || 'fully refreshed'}.`}
              </div>
            </div>
            <CircleProgress
              percentage={gemini?.fiveHourLimitRemaining ?? (isCurrentDisabled || isCurrentError || isCurrentCooldown ? 0 : null)}
              color={isCurrentDisabled || isCurrentError ? '#52525b' : isCurrentCooldown ? '#f59e0b' : '#22c55e'}
            />
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
                {isCurrentDisabled
                  ? '账号已在反代路由中禁用'
                  : isCurrentError
                  ? '账号状态异常 / 尚未完成验证'
                  : claude?.weeklyLimitRemaining == null
                  ? unknownNote
                  : `You have used some of your weekly limit, it will fully refresh in ${claude?.weeklyResetEn || 'fully refreshed'}.`}
              </div>
            </div>
            <CircleProgress
              percentage={claude?.weeklyLimitRemaining ?? (isCurrentDisabled || isCurrentError ? 0 : null)}
              color={isCurrentDisabled || isCurrentError ? '#52525b' : '#16a34a'}
            />
          </div>
          {/* Five Hour Limit */}
          <div className="p-4 flex items-center justify-between">
            <div>
              <div className="text-[14px] font-medium text-white">Five Hour Limit Remaining</div>
              <div className="text-xs text-zinc-400 mt-0.5">
                {isCurrentDisabled
                  ? '账号已在反代路由中禁用'
                  : isCurrentError
                  ? '账号状态异常 / 尚未完成验证'
                  : claude?.fiveHourLimitRemaining == null
                  ? unknownNote
                  : `You have used some of your 5-hour limit, it will fully refresh in ${claude?.fiveHourResetEn || 'fully refreshed'}.`}
              </div>
            </div>
            <CircleProgress
              percentage={claude?.fiveHourLimitRemaining ?? (isCurrentDisabled || isCurrentError ? 0 : null)}
              color={isCurrentDisabled || isCurrentError ? '#52525b' : '#22c55e'}
            />
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
            当前账号模型状态清单 ({models.length})
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

            <div className="rounded-xl border border-[#232326] bg-[#141416] overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="text-left text-zinc-400 border-b border-[#232326] text-xs">
                    <th className="px-4 py-3 font-medium">模型名称</th>
                    <th className="px-4 py-3 font-medium">所属池</th>
                    <th className="px-4 py-3 font-medium">5小时剩余配额</th>
                    <th className="px-4 py-3 font-medium">重置倒计时 / 状态</th>
                    <th className="px-4 py-3 font-medium text-right">可用性</th>
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
                    const pct: number | null = m.remainingPercentage ?? null;
                    const barColor = isCurrentDisabled || pct === null ? 'bg-zinc-700' : pct > 50 ? 'bg-emerald-500' : pct > 20 ? 'bg-amber-500' : 'bg-red-500';

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
                              <div className={`h-full ${barColor} rounded-full transition-all`} style={{ width: `${pct ?? 0}%` }} />
                            </div>
                            <span className="font-mono text-xs text-zinc-300">
                              {isCurrentDisabled || pct === null ? '--' : `${pct}%`}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-zinc-400 flex items-center gap-1.5">
                          <Clock className="w-3 h-3 text-zinc-500" />
                          <span>{m.timeRemainingEn || m.timeRemainingZh || '—'}</span>
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          {isCurrentDisabled ? (
                            <span className="inline-flex items-center gap-1 text-xs text-zinc-500">
                              已禁用
                            </span>
                          ) : m.isExhausted ? (
                            <span className="inline-flex items-center gap-1 text-xs text-red-400">
                              <XCircle className="w-3.5 h-3.5" /> {isCurrentError ? '需验证' : '已耗尽'}
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
