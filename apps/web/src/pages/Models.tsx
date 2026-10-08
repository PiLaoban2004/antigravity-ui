import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2, Save, RefreshCw, Boxes, Zap, Flame, DollarSign, Cpu, Coins } from 'lucide-react';
import { api } from '../lib/api';
import type { ModelAliasEntry, ModelAliasMap, ProxyModel, ModelGroup } from '@antigravity-ui/shared';

const CHANNELS = ['claude', 'codex', 'openai', 'gemini'];

export default function Models() {
  const [activeGroup, setActiveGroup] = useState<ModelGroup>('all');
  const [map, setMap] = useState<ModelAliasMap>({});
  const [channel, setChannel] = useState('claude');
  const [drafts, setDrafts] = useState<ModelAliasEntry[]>([]);
  const [allModels, setAllModels] = useState<ProxyModel[]>([]);
  const [msg, setMsg] = useState('');
  const [upstreams, setUpstreams] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r, m] = await Promise.all([api.getAliases(), api.models()]);
      setMap(r['oauth-model-alias'] ?? {});
      setAllModels(m.data ?? []);
      {/* 注意：只把 Antigravity 自己的模型作为映射上游候选，
          AgentRouter / WorkBuddy 的模型不参与 8317 的别名映射 */}
      setUpstreams((m.data ?? []).filter((x) => x.group === 'antigravity').map((x) => x.id));
      setMsg('');
    } catch (e) {
      setMsg(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setDrafts((map[channel] ?? []).map((e) => ({ ...e })));
  }, [map, channel]);

  const save = async () => {
    try {
      await api.patchAliases(channel, drafts);
      setMsg('已保存映射配置');
      await load();
      setTimeout(() => setMsg(''), 2000);
    } catch (e) {
      setMsg(String(e));
    }
  };

  const add = () => setDrafts((d) => [...d, { name: upstreams[0] ?? 'gemini-3.7-flash-high', alias: '', forceMapping: true }]);

  const update = (i: number, patch: Partial<ModelAliasEntry>) =>
    setDrafts((d) => d.map((e, idx) => (idx === i ? { ...e, ...patch } : e)));

  const arModels = allModels.filter((m) => m.group === 'agentrouter');
  const wbModels = allModels.filter((m) => m.group === 'workbuddy');
  const wbCn = wbModels.filter((m) => m.realm === 'cn');
  const wbGlobal = wbModels.filter((m) => m.realm === 'global');

  return (
    <div className="p-4 sm:p-6 md:p-8 max-w-7xl mx-auto space-y-8">
      {/* 头部标题与分组切换 */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">模型管理与映射</h1>
          <p className="text-zinc-400 text-sm mt-1">
            管理 Antigravity 上游模型映射、AgentRouter 5 模型竞速池参数 与 WorkBuddy 积分模型目录
          </p>
        </div>

        <div className="flex items-center gap-3 min-w-0">
          {/* 分组切换 */}
          <div className="flex p-1 bg-zinc-900 border border-zinc-800 rounded-xl max-w-full min-w-0 overflow-x-auto [&>button]:shrink-0 [&>button]:whitespace-nowrap">
            <button
              onClick={() => setActiveGroup('all')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                activeGroup === 'all' ? 'bg-zinc-800 text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              全部模型
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
              AgentRouter 竞速池
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
              Antigravity 映射
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
              WorkBuddy 模型目录
            </button>
          </div>

          <button
            onClick={load}
            disabled={loading}
            className="shrink-0 whitespace-nowrap flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-xs font-medium text-zinc-300 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> 刷新
          </button>
        </div>
      </div>

      {msg && (
        <div className="p-4 rounded-xl bg-zinc-900 border border-zinc-700 text-zinc-200 text-sm">
          {msg}
        </div>
      )}

      {/* 模块 1：AgentRouter 5 模型竞速池卡片 (当为 all 或 agentrouter 时显示) */}
      {(activeGroup === 'all' || activeGroup === 'agentrouter') && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-white flex items-center gap-2">
              <Zap className="w-4 h-4 text-amber-400" />
              AgentRouter 5 模型竞速池与计费配置 (端口 15721)
            </h2>
            <span className="text-xs text-zinc-400">
              5 模型并发抢答 · 首包获胜即时 Abort
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {arModels.map((m) => {
              const isRace = m.id === 'agentrouter-race';
              return (
                <div
                  key={m.id}
                  className={`p-5 rounded-2xl border transition-all ${
                    isRace
                      ? 'bg-gradient-to-b from-amber-500/10 to-transparent border-amber-500/30'
                      : 'bg-zinc-900/60 border-zinc-800/80'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div>
                      <div className="font-mono font-semibold text-sm text-zinc-100 flex items-center gap-2">
                        {m.id}
                        {isRace && (
                          <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 text-[10px] font-medium border border-amber-500/30 flex items-center gap-1">
                            <Flame className="w-3 h-3 text-amber-400" /> 竞速模式
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-zinc-400 mt-0.5">{m.provider}</div>
                    </div>
                  </div>

                  <div className="space-y-2 pt-2 border-t border-zinc-800/80 text-xs">
                    <div className="flex justify-between items-center text-zinc-400">
                      <span>支持协议</span>
                      <span className="font-mono text-zinc-200 uppercase text-[11px]">
                        {m.endpoints ? m.endpoints.join(' / ') : 'OpenAI / Anthropic'}
                      </span>
                    </div>

                    {m.pricing && (
                      <div className="flex justify-between items-center text-zinc-400">
                        <span>模型价格 (1M tokens)</span>
                        <span className="font-mono text-amber-400 text-[11px]">
                          提示 ${m.pricing.input.toFixed(2)} · 补全 ${m.pricing.output.toFixed(2)}
                        </span>
                      </div>
                    )}

                    <div className="flex justify-between items-center text-zinc-400">
                      <span>调度逻辑</span>
                      <span className="text-emerald-400 text-[11px]">
                        {isRace ? '0ms 瞬间全量并发' : '主模型优先 + 2.5s 对冲'}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 模块 2：Antigravity 客户端模型别名映射 (当为 all 或 antigravity 时显示) */}
      {(activeGroup === 'all' || activeGroup === 'antigravity') && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-white flex items-center gap-2">
                <Boxes className="w-4 h-4 text-emerald-400" />
                Antigravity 客户端模型映射 (端口 8317)
              </h2>
              <p className="text-xs text-zinc-400 mt-0.5">
                把客户端请求的模型名（如 claude-sonnet-4-6）映射到 Google Gemini 上游（如 gemini-3.7-flash-high）
              </p>
            </div>
          </div>

          <div className="flex gap-2">
            {CHANNELS.map((c) => (
              <button
                key={c}
                onClick={() => setChannel(c)}
                className={`px-4 py-2 rounded-xl text-xs font-medium transition-all ${
                  channel === c
                    ? 'bg-zinc-800 text-white shadow-sm border border-zinc-700'
                    : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
                }`}
              >
                {c.toUpperCase()} 渠道
              </button>
            ))}
          </div>

          <div className="grid gap-2">
            <div className="hidden sm:grid grid-cols-[1fr_1fr_auto] gap-3 px-4 text-xs font-medium text-zinc-500">
              <span>客户端模型名 (Alias)</span>
              <span>映射到的上游模型 (Target)</span>
              <span className="w-10" />
            </div>

            {drafts.length === 0 && (
              <div className="p-6 text-center text-zinc-500 text-xs border border-dashed border-zinc-800 rounded-xl">
                当前渠道暂无显式映射（直接透传）
              </div>
            )}

            {drafts.map((e, i) => (
              <div
                key={i}
                className="grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_1fr_auto] gap-3 items-center p-3 rounded-xl bg-zinc-900/60 border border-zinc-800/80 [&>input]:min-w-0 [&>select]:min-w-0 [&>input]:col-span-2 [&>select]:col-span-1 sm:[&>input]:col-span-1"
              >
                <input
                  data-write
                  value={e.alias}
                  onChange={(ev) => update(i, { alias: ev.target.value })}
                  placeholder="如 claude-sonnet-4-6"
                  className="px-3.5 py-2 rounded-lg bg-zinc-800/80 border border-zinc-700/80 text-xs text-zinc-200 font-mono outline-none focus:border-zinc-500"
                />
                <select
                  data-write
                  value={e.name}
                  onChange={(ev) => update(i, { name: ev.target.value })}
                  className="px-3.5 py-2 rounded-lg bg-zinc-800/80 border border-zinc-700/80 text-xs text-zinc-200 font-mono outline-none focus:border-zinc-500"
                >
                  {upstreams.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
                <button
                  data-write
                  onClick={() => setDrafts((d) => d.filter((_, idx) => idx !== i))}
                  className="p-2 rounded-lg bg-zinc-800/80 hover:bg-red-900/50 text-zinc-400 hover:text-red-300 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              data-write
              onClick={add}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-zinc-200 transition-colors"
            >
              <Plus className="w-4 h-4" /> 添加映射规则
            </button>
            <button
              data-write
              onClick={save}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-medium text-white shadow-sm transition-colors"
            >
              <Save className="w-4 h-4" /> 保存映射
            </button>
          </div>
        </div>
      )}

      {/* 模块 3：WorkBuddy 积分模型目录 (当为 all 或 workbuddy 时显示) */}
      {(activeGroup === 'all' || activeGroup === 'workbuddy') && (
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-white flex items-center gap-2">
              <Coins className="w-4 h-4 text-sky-400" />
              WorkBuddy 积分模型目录 (端口 7863)
            </h2>
            <span className="text-xs text-zinc-400">
              共 {wbModels.length} 个 · 国内 {wbCn.length} · 全球 {wbGlobal.length} · 积分制计费
            </span>
          </div>

          {[
            { key: 'cn', label: '国内节点 (cn:)', list: wbCn, accent: 'text-red-300' },
            { key: 'global', label: '全球节点 (global:)', list: wbGlobal, accent: 'text-indigo-300' },
          ].map(({ key, label, list, accent }) => (
            <div key={key} className="space-y-2">
              <div className={`text-xs font-medium ${accent}`}>
                {label} —— {list.length} 个
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {list.map((m) => (
                  <div key={m.id} className="p-3 rounded-xl bg-zinc-900/60 border border-zinc-800/80">
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-mono text-xs text-zinc-100 break-all">{m.id}</span>
                      {m.credits != null && (
                        <span className="shrink-0 px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-300 border border-sky-500/20 text-[10px] font-mono">
                          {m.credits}
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-zinc-500 mt-1 truncate">
                      {m.name || m.description || m.provider}
                    </div>
                    <div className="text-[10px] text-zinc-600 mt-1 font-mono flex gap-2 flex-wrap">
                      {m.context_length != null && <span>ctx {(m.context_length / 1000).toFixed(0)}k</span>}
                      {m.supports_reasoning && <span className="text-violet-400/70">推理</span>}
                      {m.supports_images && <span className="text-emerald-400/70">视觉</span>}
                      {m.supports_tool_call && <span className="text-sky-400/70">工具</span>}
                      {m.is_default && <span className="text-amber-400/70">默认</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
