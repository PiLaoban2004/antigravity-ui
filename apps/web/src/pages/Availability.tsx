import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Zap,
  KeyRound,
  Boxes,
  Play,
  Trophy,
  Flame,
  Filter,
  Coins,
} from 'lucide-react';
import { api } from '../lib/api';
import type { AuthFile, ProxyModel, ModelGroup, ProviderGroup } from '@antigravity-ui/shared';

interface ModelTest {
  id: string;
  group: ProviderGroup;
  state: 'idle' | 'running' | 'ok' | 'fail';
  latency?: number;
  reply?: string;
  winner?: string;
  error?: string;
}

interface CredTest {
  state: 'idle' | 'running' | 'ok' | 'fail';
  detail?: string;
}

export default function Availability() {
  const [activeGroup, setActiveGroup] = useState<ModelGroup>('all');
  const [files, setFiles] = useState<AuthFile[]>([]);
  const [modelsList, setModelsList] = useState<ProxyModel[]>([]);
  const [modelTests, setModelTests] = useState<Record<string, ModelTest>>({});
  const [credTests, setCredTests] = useState<Record<string, CredTest>>({});
  const [err, setErr] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const [f, m] = await Promise.all([api.authFiles(), api.models()]);
        setFiles(f.files ?? []);
        setModelsList(m.data ?? []);
      } catch (e) {
        setErr(String(e));
      }
    })();
  }, []);

  const filteredModels = modelsList.filter(
    (m) => activeGroup === 'all' || m.group === activeGroup
  );

  const testModel = async (m: ProxyModel) => {
    const group = m.group || 'antigravity';
    setModelTests((s) => ({
      ...s,
      [m.id]: { id: m.id, group, state: 'running' },
    }));

    try {
      const r = await api.testModel(m.id, group);
      setModelTests((s) => ({
        ...s,
        [m.id]: {
          id: m.id,
          group,
          state: r.ok ? 'ok' : 'fail',
          latency: r.latency_ms,
          reply: r.reply,
          winner: r.winner,
          error: r.error,
        },
      }));
    } catch (e) {
      setModelTests((s) => ({
        ...s,
        [m.id]: { id: m.id, group, state: 'fail', error: String(e) },
      }));
    }
  };

  const testAllFiltered = async () => {
    // Each test is a real completion through the gateway to the upstream: it spends quota and is visible to the provider.
    if (!window.confirm(`将对 ${filteredModels.length} 个模型各发起一次真实调用，会消耗真实额度。继续？`)) return;
    for (const m of filteredModels) {
      await testModel(m);
    }
  };

  const testCred = async (f: AuthFile) => {
    const idx = (f as any).auth_index;
    setCredTests((s) => ({ ...s, [f.id]: { state: 'running' } }));
    try {
      const r = await api.testAuthCred(idx);
      if (r.status_code === 200 || r.status === 200) {
        let detail = 'OAuth Token 状态有效';
        try {
          const b = JSON.parse(r.body);
          if (b.exp) detail += ` · 过期 ${new Date(Number(b.exp) * 1000).toLocaleTimeString()}`;
        } catch {}
        setCredTests((s) => ({ ...s, [f.id]: { state: 'ok', detail } }));
      } else {
        setCredTests((s) => ({
          ...s,
          [f.id]: { state: 'fail', detail: `HTTP ${r.status_code ?? r.status}` },
        }));
      }
    } catch (e) {
      setCredTests((s) => ({ ...s, [f.id]: { state: 'fail', detail: String(e) } }));
    }
  };

  return (
    <div className="p-4 sm:p-6 md:p-8 max-w-7xl mx-auto space-y-8">
      {/* 标题与分组栏 */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">可用性与竞速测试</h1>
          <p className="text-zinc-400 text-sm mt-1">
            实时向网关发起请求，测试 Antigravity 凭证、AgentRouter 5 模型竞速 与 WorkBuddy 积分制模型响应
          </p>
        </div>

        {/* 分组切换 */}
        <div className="flex p-1 bg-zinc-900 border border-zinc-800 rounded-xl max-w-full min-w-0 overflow-x-auto [&>button]:shrink-0 [&>button]:whitespace-nowrap">
          <button
            onClick={() => setActiveGroup('all')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
              activeGroup === 'all' ? 'bg-zinc-800 text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            全部模型 ({modelsList.length})
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
            Antigravity
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
            AgentRouter (竞速)
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
            WorkBuddy (积分)
          </button>
        </div>
      </div>

      {err && (
        <div className="p-4 rounded-xl bg-red-950/50 border border-red-900/50 text-red-300 text-sm">
          {err}
        </div>
      )}

      {/* 模块 1：Antigravity 凭证测试 (仅在 all 或 antigravity 时显示) */}
      {(activeGroup === 'all' || activeGroup === 'antigravity') && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-white flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-sky-400" />
              Google OAuth 账号凭证测试 (Antigravity 8317)
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {files.map((f) => {
              const t = credTests[f.id] ?? { state: 'idle' };
              return (
                <div
                  key={f.id}
                  className="p-4 rounded-xl bg-zinc-900/60 border border-zinc-800/80 flex items-center justify-between"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {t.state === 'running' ? (
                      <Loader2 className="w-5 h-5 text-sky-400 animate-spin shrink-0" />
                    ) : t.state === 'ok' ? (
                      <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                    ) : t.state === 'fail' ? (
                      <XCircle className="w-5 h-5 text-red-400 shrink-0" />
                    ) : (
                      <span className="w-5 h-5 rounded-full border border-zinc-700 shrink-0" />
                    )}
                    <div className="min-w-0">
                      <div className="font-medium text-sm text-zinc-200 truncate">{f.email || f.account}</div>
                      <div className="text-xs text-zinc-500">
                        {t.detail ? t.detail : `Provider: ${f.provider}`}
                      </div>
                    </div>
                  </div>
                  <button
                    data-write
                    onClick={() => testCred(f)}
                    disabled={t.state === 'running'}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-zinc-200 disabled:opacity-50 shrink-0"
                  >
                    <Zap className="w-3 h-3 text-sky-400" /> 测凭证
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 模块 2：模型真实调用测试 */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-white flex items-center gap-2">
            <Boxes className="w-4 h-4 text-violet-400" />
            模型可用性与竞速测试 (真实网关调用)
          </h2>
          <button
            data-write
            onClick={testAllFiltered}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium shadow-sm transition-colors"
          >
            <Play className="w-3.5 h-3.5" />
            一键测试当前分组 ({filteredModels.length})
          </button>
        </div>

        <div className="grid gap-3">
          {filteredModels.length === 0 && (
            <div className="p-4 sm:p-6 md:p-8 text-center text-zinc-500 text-xs border border-dashed border-zinc-800 rounded-xl">
              暂无符合条件的模型
            </div>
          )}

          {filteredModels.map((m) => {
            const t = modelTests[m.id] ?? { id: m.id, group: m.group || 'antigravity', state: 'idle' };
            const isAgentRouter = m.group === 'agentrouter';
            const isWorkBuddy = m.group === 'workbuddy';
            const isRace = m.id === 'agentrouter-race';

            return (
              <div
                key={m.id}
                className="p-4 rounded-xl bg-zinc-900/60 border border-zinc-800/80 hover:border-zinc-700/80 transition-all flex flex-col lg:flex-row lg:items-center justify-between gap-4"
              >
                <div className="flex items-start gap-3.5 min-w-0">
                  <div className="mt-0.5 shrink-0">
                    {t.state === 'running' ? (
                      <Loader2 className="w-5 h-5 text-violet-400 animate-spin" />
                    ) : t.state === 'ok' ? (
                      <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                    ) : t.state === 'fail' ? (
                      <XCircle className="w-5 h-5 text-red-400" />
                    ) : (
                      <span className="w-5 h-5 rounded-full border border-zinc-700 flex items-center justify-center text-[10px] text-zinc-500 font-mono">
                        ·
                      </span>
                    )}
                  </div>

                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-sm font-medium text-zinc-100">{m.id}</span>
                      {isAgentRouter ? (
                        <span className="px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/20 text-[10px] font-medium flex items-center gap-1">
                          <Flame className="w-3 h-3 text-amber-400" />
                          {isRace ? '🏎️ 5模型并发竞速' : '⚡ AgentRouter (对冲保底)'}
                        </span>
                      ) : isWorkBuddy ? (
                        <span className="px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-300 border border-sky-500/20 text-[10px] font-medium flex items-center gap-1">
                          <Coins className="w-3 h-3 text-sky-400" />
                          {m.realm === 'cn' ? 'WorkBuddy 国内' : 'WorkBuddy 全球'}
                          {m.credits != null && <span className="text-sky-400/80">· {m.credits} 积分</span>}
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 text-[10px] font-medium">
                          Google Antigravity
                        </span>
                      )}

                      {m.endpoints && (
                        <span className="text-[10px] text-zinc-500 font-mono">
                          [{m.endpoints.join(', ')}]
                        </span>
                      )}
                    </div>

                    <div className="text-xs text-zinc-400 flex items-center gap-2 flex-wrap">
                      {t.state === 'ok' && (
                        <>
                          <span className="text-amber-400 font-mono font-medium">
                            {t.latency}ms
                          </span>
                          {t.winner && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 text-[11px]">
                              <Trophy className="w-3 h-3 text-amber-400" /> 获胜模型: {t.winner}
                            </span>
                          )}
                          {t.reply && <span className="text-zinc-500 truncate">回复: 「{t.reply}」</span>}
                        </>
                      )}
                      {t.state === 'fail' && (
                        <span className="text-red-400">{t.error || '调用超时或服务未响应'}</span>
                      )}
                      {t.state === 'idle' && (
                        <span className="text-zinc-500">
                          {isAgentRouter ? '通过端口 15721 竞速代理测试' : '通过端口 8317 Antigravity 反代测试'}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0 self-end md:self-center">
                  <button
                    data-write
                    onClick={() => testModel(m)}
                    disabled={t.state === 'running'}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-zinc-200 transition-colors disabled:opacity-50"
                  >
                    <Zap className="w-3.5 h-3.5 text-amber-400" />
                    {isRace ? '竞速实测' : '测试'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
