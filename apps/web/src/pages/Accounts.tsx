import { useCallback, useEffect, useState } from 'react';
import { Plus, RefreshCw, Power, Trash2, Copy, ExternalLink, Loader2, RotateCcw } from 'lucide-react';
import { api } from '../lib/api';
import type { AuthFile } from '@antigravity-ui/shared';

export default function Accounts() {
  const [files, setFiles] = useState<AuthFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  // OAuth flow state
  const [oauth, setOauth] = useState<{ url: string; state: string } | null>(null);
  const [oauthStatus, setOauthStatus] = useState<'idle' | 'waiting' | 'ok' | 'error'>('idle');
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const f = await api.authFiles();
      setFiles(f.files);
      setErr('');
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // SSE live refresh of account list
  useEffect(() => {
    const es = new EventSource('http://127.0.0.1:4310/api/events');
    es.addEventListener('auth-files', (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data);
        if (Array.isArray(data.files)) setFiles(data.files);
      } catch {
        /* ignore */
      }
    });
    return () => es.close();
  }, []);

  const startAuth = async () => {
    try {
      const r = await api.startAuth();
      setOauth({ url: r.url, state: r.state });
      setOauthStatus('waiting');
      pollStatus(r.state);
    } catch (e) {
      setErr(String(e));
    }
  };

  const pollStatus = async (state: string) => {
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      try {
        const s = await api.authStatus(state);
        if (s.status === 'ok') {
          setOauthStatus('ok');
          setOauth(null);
          await load();
          return;
        }
        if (s.status === 'error') {
          setOauthStatus('error');
          return;
        }
      } catch {
        // keep polling
      }
    }
    setOauthStatus('error');
  };

  const toggle = async (f: AuthFile) => {
    try {
      await api.setAuthDisabled(f.name, !f.disabled);
      await load();
    } catch (e) {
      setErr(String(e));
    }
  };

  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const openUrl = () => {
    if (oauth) window.open(oauth.url, '_blank');
  };

  const resetQuota = async () => {
    try {
      await api.resetQuota();
      await load();
    } catch (e) {
      setErr(String(e));
    }
  };

  const remove = async (f: AuthFile) => {
    if (!window.confirm(`确认删除账号 ${f.email || f.account}？\n该操作会删除其 auth 文件，不可恢复。`)) return;
    try {
      await api.deleteAuth(f.name);
      await load();
    } catch (e) {
      setErr(String(e));
    }
  };

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">账号管理</h1>
          <p className="text-zinc-400 text-sm mt-1">添加、启用/禁用、切换 Antigravity 账号</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-sm">
            <RefreshCw className="w-4 h-4" /> 刷新
          </button>
          <button onClick={startAuth} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-sm font-medium">
            <Plus className="w-4 h-4" /> 添加账号
          </button>
        </div>
      </div>

      {err && <div className="mb-4 p-3 rounded-lg bg-red-950 border border-red-900 text-red-300 text-sm">{err}</div>}

      {oauth && (
        <div className="mb-6 p-5 rounded-xl border border-sky-800 bg-sky-950/40">
          <div className="flex items-center gap-2 mb-2 text-sky-300">
            {oauthStatus === 'waiting' ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />}
            <span className="font-medium">
              {oauthStatus === 'waiting' ? '等待授权完成…' : oauthStatus === 'ok' ? '授权成功' : '授权失败/超时'}
            </span>
          </div>
          <p className="text-sm text-zinc-300 mb-3">在浏览器打开以下链接，用目标 Google 账号登录并授权（建议无痕窗口，避免登错账号）：</p>
          <div className="flex gap-2">
            <code className="flex-1 truncate text-xs px-3 py-2 rounded bg-zinc-900 border border-zinc-800 text-zinc-300">{oauth.url}</code>
            <button onClick={() => copy(oauth.url)} className="px-3 py-2 rounded bg-zinc-800 hover:bg-zinc-700 text-xs flex items-center gap-1">
              {copied ? '已复制' : '复制'} <Copy className="w-3.5 h-3.5" />
            </button>
            <button onClick={openUrl} className="px-3 py-2 rounded bg-zinc-800 hover:bg-zinc-700 text-xs">打开</button>
          </div>
        </div>
      )}

      <div className="grid gap-3">
        {files.length === 0 && !loading && (
          <div className="text-zinc-500 text-sm p-8 text-center border border-dashed border-zinc-800 rounded-xl">还没有账号，点击右上角「添加账号」</div>
        )}
        {files.map((f) => (
          <div key={f.id} className="p-4 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span
                className={`w-2.5 h-2.5 rounded-full ${f.disabled ? 'bg-zinc-500' : f.status === 'error' ? 'bg-red-500' : 'bg-emerald-400'}`}
              />
              <div>
                <div className="font-medium">{f.email || f.account}</div>
                <div className="text-xs text-zinc-500">
                  {f.provider} · {f.project_id ?? '无 project'} · 成功 {f.success} / 失败 {f.failed}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {f.status === 'error' && !f.disabled && (
                <button onClick={resetQuota} title="重置配额/状态" className="p-2 rounded-lg bg-zinc-800 hover:bg-zinc-700">
                  <RotateCcw className="w-4 h-4" />
                </button>
              )}
              <button
                onClick={() => toggle(f)}
                title={f.disabled ? '启用' : '禁用'}
                className={`p-2 rounded-lg ${f.disabled ? 'bg-emerald-900 text-emerald-300 hover:bg-emerald-800' : 'bg-zinc-800 hover:bg-zinc-700'}`}
              >
                <Power className="w-4 h-4" />
              </button>
              <button onClick={() => remove(f)} title="删除账号" className="p-2 rounded-lg bg-zinc-800 hover:bg-red-900 hover:text-red-300">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
