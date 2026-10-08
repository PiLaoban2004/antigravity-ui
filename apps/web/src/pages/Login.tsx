import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { api } from '../lib/api';

export default function Login({ onDone }: { onDone: () => void }) {
  const [token, setToken] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      await api.login(token.trim());
      setToken('');
      onDone();
    } catch (e2) {
      const raw = String(e2);
      let msg = raw.replace(/^Error: /, '');
      try {
        const body = JSON.parse(raw.slice(raw.indexOf('{')));
        msg = body.retryAfterSeconds ? `失败次数过多，请 ${body.retryAfterSeconds} 秒后再试` : body.error === 'invalid token' ? '令牌无效' : body.error;
      } catch {
        /* keep raw message */
      }
      setErr(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-black text-zinc-100 flex items-center justify-center px-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 p-6 rounded-2xl bg-zinc-950 border border-zinc-800">
        <div className="flex items-center gap-2">
          <KeyRound className="w-5 h-5 text-emerald-400" />
          <h1 className="font-semibold">远程访问登录</h1>
        </div>
        <p className="text-xs text-zinc-500">输入服务端配置的管理令牌（ANTI_UI_ADMIN_TOKEN）或只读令牌（ANTI_UI_VIEW_TOKEN）。</p>
        <input
          type="password"
          autoFocus
          autoComplete="current-password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="访问令牌"
          className="w-full px-3.5 py-2 rounded-lg bg-zinc-900 border border-zinc-700 text-sm outline-none focus:border-zinc-500"
        />
        {err && <div className="text-xs text-red-400 break-words">{err}</div>}
        <button
          type="submit"
          disabled={busy || !token.trim()}
          className="w-full px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-sm font-medium disabled:opacity-50"
        >
          {busy ? '验证中…' : '登录'}
        </button>
      </form>
    </div>
  );
}
