import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, XCircle, Loader2, Zap, KeyRound, Boxes, Play } from 'lucide-react';
import { api } from '../lib/api';
import type { AuthFile } from '@antigravity-ui/shared';

interface ModelTest {
  id: string;
  state: 'idle' | 'running' | 'ok' | 'fail';
  latency?: number;
  reply?: string;
  error?: string;
}

interface CredTest {
  state: 'idle' | 'running' | 'ok' | 'fail';
  detail?: string;
}

export default function Availability() {
  const [files, setFiles] = useState<AuthFile[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [modelTests, setModelTests] = useState<Record<string, ModelTest>>({});
  const [credTests, setCredTests] = useState<Record<string, CredTest>>({});
  const [err, setErr] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const [f, m] = await Promise.all([api.authFiles(), api.models()]);
        setFiles(f.files);
        setModels((m.data ?? []).map((x) => x.id));
      } catch (e) {
        setErr(String(e));
      }
    })();
  }, []);

  const testModel = async (id: string) => {
    setModelTests((s) => ({ ...s, [id]: { id, state: 'running' } }));
    try {
      const r = await api.testModel(id);
      setModelTests((s) => ({
        ...s,
        [id]: r.ok
          ? { id, state: 'ok', latency: r.latency_ms, reply: r.reply }
          : { id, state: 'fail', latency: r.latency_ms, error: r.error },
      }));
    } catch (e) {
      setModelTests((s) => ({ ...s, [id]: { id, state: 'fail', error: String(e) } }));
    }
  };

  const testAllModels = async () => {
    for (const id of models) {
      await testModel(id);
    }
  };

  const testCred = async (f: AuthFile) => {
    const idx = (f as any).auth_index;
    setCredTests((s) => ({ ...s, [f.id]: { state: 'running' } }));
    try {
      const r = await api.testAuthCred(idx);
      if (r.status_code === 200 || r.status === 200) {
        let detail = 'token 有效';
        try {
          const b = JSON.parse(r.body);
          if (b.exp) detail += ` · 过期 ${new Date(Number(b.exp) * 1000).toLocaleString()}`;
        } catch {}
        setCredTests((s) => ({ ...s, [f.id]: { state: 'ok', detail } }));
      } else {
        setCredTests((s) => ({ ...s, [f.id]: { state: 'fail', detail: `HTTP ${r.status_code ?? r.status}` } }));
      }
    } catch (e) {
      setCredTests((s) => ({ ...s, [f.id]: { state: 'fail', detail: String(e) } }));
    }
  };

  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold mb-1">可用性测试</h1>
      <p className="text-zinc-400 text-sm mb-6">验证账号凭证与模型是否真实可用</p>

      {err && <div className="mb-4 p-3 rounded-lg bg-red-950 border border-red-900 text-red-300 text-sm">{err}</div>}

      {/* Account credential test */}
      <h2 className="text-lg font-medium mb-3 flex items-center gap-2">
        <KeyRound className="w-5 h-5 text-sky-400" /> 账号凭证测试
      </h2>
      <div className="grid gap-2 mb-8">
        {files.map((f) => {
          const t = credTests[f.id] ?? { state: 'idle' };
          return (
            <div key={f.id} className="p-4 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-between">
              <div className="flex items-center gap-3">
                {t.state === 'running' ? (
                  <Loader2 className="w-5 h-5 text-sky-400 animate-spin" />
                ) : t.state === 'ok' ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                ) : t.state === 'fail' ? (
                  <XCircle className="w-5 h-5 text-red-400" />
                ) : (
                  <span className="w-5 h-5 rounded-full border border-zinc-700" />
                )}
                <div>
                  <div className="font-medium">{f.email || f.account}</div>
                  {t.detail && <div className="text-xs text-zinc-500">{t.detail}</div>}
                </div>
              </div>
              <button
                onClick={() => testCred(f)}
                disabled={t.state === 'running'}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-sm disabled:opacity-50"
              >
                <Zap className="w-3.5 h-3.5" /> 测凭证
              </button>
            </div>
          );
        })}
      </div>

      {/* Model availability test */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-medium flex items-center gap-2">
          <Boxes className="w-5 h-5 text-violet-400" /> 模型可用性测试（经反代真实请求）
        </h2>
        <button onClick={testAllModels} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-sm font-medium">
          <Play className="w-3.5 h-3.5" /> 全部测试
        </button>
      </div>
      <div className="grid gap-2">
        {models.map((id) => {
          const t = modelTests[id] ?? { state: 'idle' };
          return (
            <div key={id} className="p-3 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-between">
              <div className="flex items-center gap-3 min-w-0">
                {t.state === 'running' ? (
                  <Loader2 className="w-5 h-5 text-violet-400 animate-spin shrink-0" />
                ) : t.state === 'ok' ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                ) : t.state === 'fail' ? (
                  <XCircle className="w-5 h-5 text-red-400 shrink-0" />
                ) : (
                  <span className="w-5 h-5 rounded-full border border-zinc-700 shrink-0" />
                )}
                <div className="min-w-0">
                  <div className="font-mono text-sm truncate">{id}</div>
                  <div className="text-xs text-zinc-500">
                    {t.state === 'ok' && `${t.latency}ms${t.reply ? ` · 回复「${t.reply}」` : ''}`}
                    {t.state === 'fail' && (t.error || '失败')}
                  </div>
                </div>
              </div>
              <button
                onClick={() => testModel(id)}
                disabled={t.state === 'running'}
                className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-sm disabled:opacity-50 shrink-0"
              >
                测试
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
