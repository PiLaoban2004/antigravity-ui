import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2, Save, RefreshCw } from 'lucide-react';
import { api } from '../lib/api';
import type { ModelAliasEntry, ModelAliasMap } from '@antigravity-ui/shared';

const CHANNELS = ['claude', 'codex', 'openai', 'gemini'];

export default function Models() {
  const [map, setMap] = useState<ModelAliasMap>({});
  const [channel, setChannel] = useState('claude');
  const [drafts, setDrafts] = useState<ModelAliasEntry[]>([]);
  const [msg, setMsg] = useState('');
  const [upstreams, setUpstreams] = useState<string[]>([]);

  const load = useCallback(async () => {
    try {
      const r = await api.getAliases();
      setMap(r['oauth-model-alias'] ?? {});
      const m = await api.models();
      setUpstreams((m.data ?? []).map((x) => x.id));
    } catch (e) {
      setMsg(String(e));
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
      setMsg('已保存');
      await load();
      setTimeout(() => setMsg(''), 1500);
    } catch (e) {
      setMsg(String(e));
    }
  };

  const add = () => setDrafts((d) => [...d, { name: upstreams[0] ?? '', alias: '', forceMapping: true }]);

  const update = (i: number, patch: Partial<ModelAliasEntry>) =>
    setDrafts((d) => d.map((e, idx) => (idx === i ? { ...e, ...patch } : e)));

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">模型映射</h1>
          <p className="text-zinc-400 text-sm mt-1">把客户端请求的模型名（如 claude-sonnet-4-6）映射到 Antigravity 上游（如 gemini-3.7-flash-high）</p>
        </div>
        <button onClick={load} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-sm">
          <RefreshCw className="w-4 h-4" /> 刷新
        </button>
      </div>

      <div className="flex gap-2 mb-5">
        {CHANNELS.map((c) => (
          <button
            key={c}
            onClick={() => setChannel(c)}
            className={`px-4 py-2 rounded-lg text-sm ${channel === c ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:bg-zinc-900'}`}
          >
            {c}
          </button>
        ))}
      </div>

      {msg && <div className="mb-4 p-3 rounded-lg bg-zinc-800 border border-zinc-700 text-sm">{msg}</div>}

      <div className="grid gap-2 mb-4">
        <div className="grid grid-cols-[1fr_1fr_auto] gap-3 px-3 text-xs text-zinc-500">
          <span>客户端模型名（alias）</span>
          <span>上游模型（name）</span>
          <span className="w-16" />
        </div>
        {drafts.map((e, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-3 items-center p-3 rounded-lg bg-zinc-900 border border-zinc-800">
            <input
              value={e.alias}
              onChange={(ev) => update(i, { alias: ev.target.value })}
              placeholder="如 claude-sonnet-4-6"
              className="px-3 py-2 rounded bg-zinc-800 border border-zinc-700 text-sm outline-none focus:border-zinc-500"
            />
            <select
              value={e.name}
              onChange={(ev) => update(i, { name: ev.target.value })}
              className="px-3 py-2 rounded bg-zinc-800 border border-zinc-700 text-sm outline-none focus:border-zinc-500"
            >
              {upstreams.map((u) => (
                <option key={u} value={u}>{u}</option>
              ))}
            </select>
            <button onClick={() => setDrafts((d) => d.filter((_, idx) => idx !== i))} className="p-2 rounded bg-zinc-800 hover:bg-red-900">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <button onClick={add} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-sm">
          <Plus className="w-4 h-4" /> 添加映射
        </button>
        <button onClick={save} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-sm font-medium">
          <Save className="w-4 h-4" /> 保存
        </button>
      </div>
    </div>
  );
}
