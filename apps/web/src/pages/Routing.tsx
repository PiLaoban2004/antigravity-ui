import { useEffect, useState } from 'react';
import { RefreshCw, Save } from 'lucide-react';
import { api } from '../lib/api';
import type { AuthFile, RoutingStrategy } from '@antigravity-ui/shared';

const STRATEGIES: { id: RoutingStrategy; label: string; desc: string }[] = [
  { id: 'round-robin', label: '轮询', desc: '请求依次分配给所有启用账号' },
  { id: 'weighted-round-robin', label: '加权轮询', desc: '按账号权重比例分配请求' },
  { id: 'fill-first', label: '主备填充', desc: '优先用第一个账号，满了再切下一个' },
];

export default function Routing() {
  const [strategy, setStrategy] = useState<RoutingStrategy>('round-robin');
  const [files, setFiles] = useState<AuthFile[]>([]);
  const [msg, setMsg] = useState('');

  const load = async () => {
    try {
      const [s, f] = await Promise.all([api.getStrategy(), api.authFiles()]);
      setStrategy(s.strategy);
      setFiles(f.files);
    } catch (e) {
      setMsg(String(e));
    }
  };

  useEffect(() => {
    load();
  }, []);

  const saveStrategy = async (s: RoutingStrategy) => {
    try {
      await api.patchStrategy(s);
      setStrategy(s);
      setMsg('已保存');
      setTimeout(() => setMsg(''), 1500);
    } catch (e) {
      setMsg(String(e));
    }
  };

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">路由策略</h1>
          <p className="text-zinc-400 text-sm mt-1">多账号请求分配与切换</p>
        </div>
        <button onClick={load} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-sm">
          <RefreshCw className="w-4 h-4" /> 刷新
        </button>
      </div>

      {msg && <div className="mb-4 p-3 rounded-lg bg-zinc-800 border border-zinc-700 text-sm">{msg}</div>}

      <h2 className="text-lg font-medium mb-3">分配策略</h2>
      <div className="grid gap-3 mb-8">
        {STRATEGIES.map(({ id, label, desc }) => (
          <button
            key={id}
            onClick={() => saveStrategy(id)}
            className={`text-left p-4 rounded-xl border transition-colors ${
              strategy === id ? 'border-emerald-600 bg-emerald-950/40' : 'border-zinc-800 bg-zinc-900 hover:border-zinc-700'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-medium">{label}</span>
              {strategy === id && <span className="text-xs text-emerald-400 flex items-center gap-1"><Save className="w-3 h-3" /> 当前</span>}
            </div>
            <div className="text-sm text-zinc-400 mt-1">{desc}</div>
          </button>
        ))}
      </div>

      <h2 className="text-lg font-medium mb-3">账号启用状态与权重</h2>
      <div className="grid gap-2">
        {files.map((f) => (
          <div key={f.id} className="p-4 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${f.disabled ? 'bg-zinc-500' : 'bg-emerald-400'}`} />
              <span className="font-medium truncate">{f.email || f.account}</span>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <label className="flex items-center gap-2 text-xs text-zinc-400" title="加权轮询时的权重">
                权重
                <input
                  type="number"
                  min={1}
                  max={1000000}
                  value={f.weight ?? 1}
                  onChange={async (ev) => {
                    const w = Math.max(1, Math.min(1000000, Number(ev.target.value) || 1));
                    try {
                      await api.patchAuthFields(f.name, { weight: w });
                      setMsg('权重已更新');
                      setTimeout(() => setMsg(''), 1500);
                      await load();
                    } catch (e) {
                      setMsg(String(e));
                    }
                  }}
                  className="w-20 px-2 py-1 rounded bg-zinc-800 border border-zinc-700 text-sm text-zinc-200 outline-none focus:border-zinc-500"
                />
              </label>
              <button
                onClick={async () => {
                  await api.setAuthDisabled(f.name, !f.disabled);
                  await load();
                }}
                className={`text-sm px-3 py-1.5 rounded-lg ${f.disabled ? 'bg-emerald-900 text-emerald-300' : 'bg-zinc-800 text-zinc-300'}`}
              >
                {f.disabled ? '已禁用（点击启用）' : '启用中（点击禁用）'}
              </button>
            </div>
          </div>
        ))}
      </div>
      <p className="text-xs text-zinc-500 mt-3">权重仅在「加权轮询」策略下生效；权重越大分配到的请求越多。</p>
    </div>
  );
}
