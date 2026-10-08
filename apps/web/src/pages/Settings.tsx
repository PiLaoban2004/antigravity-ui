import { useEffect, useState } from 'react';
import { api, type AuditEntry } from '../lib/api';
import { useSession } from '../lib/session';

export default function Settings() {
  const [config, setConfig] = useState<any>(null);
  const [err, setErr] = useState('');
  const { remote, role } = useSession();
  const [audit, setAudit] = useState<AuditEntry[]>([]);

  useEffect(() => {
    api
      .getConfig()
      .then(setConfig)
      .catch((e) => setErr(String(e)));
  }, []);

  useEffect(() => {
    if (remote && role === 'admin') api.audit(100).then((r) => setAudit(r.rows)).catch(() => {});
  }, [remote, role]);

  return (
    <div className="p-4 sm:p-6 md:p-8">
      <h1 className="text-2xl font-semibold mb-1">设置</h1>
      <p className="text-zinc-400 text-sm mb-6">CLIProxyAPI 当前运行配置（只读）</p>

      {err && <div className="mb-4 p-3 rounded-lg bg-red-950 border border-red-900 text-red-300 text-sm">{err}</div>}

      <div className="rounded-xl border border-zinc-800 bg-zinc-950 overflow-hidden">
        <div className="px-4 py-2 border-b border-zinc-800 text-sm text-zinc-400">config</div>
        <pre className="p-4 text-xs text-zinc-300 overflow-x-auto">{config ? JSON.stringify(config, null, 2) : '加载中…'}</pre>
      </div>

      <div className="mt-6 p-4 rounded-xl bg-zinc-900 border border-zinc-800 text-sm text-zinc-400">
        <p className="font-medium text-zinc-300 mb-1">说明</p>
        {remote
          ? '远程模式已开启：所有请求需要令牌。管理密钥保存在后端环境变量，不会下发到浏览器。请只通过 Tailscale / Cloudflare Access 等隧道访问，不要直接暴露端口。'
          : '本控制台默认仅面向本机（127.0.0.1）使用。管理密钥保存在后端环境变量，不会下发到浏览器。如需远程访问，请参考 README 的「远程访问」一节。'}
      </div>

      {remote && role === 'admin' && (
        <div className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950 overflow-hidden">
          <div className="px-4 py-2 border-b border-zinc-800 text-sm text-zinc-400">最近的写操作与登录（审计）</div>
          <table className="w-full text-xs">
            <thead className="text-zinc-500 text-left">
              <tr>
                <th className="px-4 py-2">时间</th>
                <th className="px-2 py-2">角色</th>
                <th className="px-2 py-2">来源 IP</th>
                <th className="px-2 py-2">请求</th>
                <th className="px-2 py-2">状态</th>
              </tr>
            </thead>
            <tbody className="text-zinc-300 font-mono">
              {audit.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-4 text-center text-zinc-500">暂无记录</td>
                </tr>
              )}
              {audit.map((a, i) => (
                <tr key={i} className="border-t border-zinc-900">
                  <td className="px-4 py-1.5">{new Date(a.ts).toLocaleString()}</td>
                  <td className="px-2 py-1.5">{a.role}</td>
                  <td className="px-2 py-1.5">{a.ip}</td>
                  <td className="px-2 py-1.5">{a.method} {a.path}</td>
                  <td className={`px-2 py-1.5 ${a.status >= 400 ? 'text-red-400' : 'text-emerald-400'}`}>{a.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
