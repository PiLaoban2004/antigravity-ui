import { useEffect, useState } from 'react';
import { api } from '../lib/api';

export default function Settings() {
  const [config, setConfig] = useState<any>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    api
      .getConfig()
      .then(setConfig)
      .catch((e) => setErr(String(e)));
  }, []);

  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold mb-1">设置</h1>
      <p className="text-zinc-400 text-sm mb-6">CLIProxyAPI 当前运行配置（只读）</p>

      {err && <div className="mb-4 p-3 rounded-lg bg-red-950 border border-red-900 text-red-300 text-sm">{err}</div>}

      <div className="rounded-xl border border-zinc-800 bg-zinc-950 overflow-hidden">
        <div className="px-4 py-2 border-b border-zinc-800 text-sm text-zinc-400">config</div>
        <pre className="p-4 text-xs text-zinc-300 overflow-x-auto">{config ? JSON.stringify(config, null, 2) : '加载中…'}</pre>
      </div>

      <div className="mt-6 p-4 rounded-xl bg-zinc-900 border border-zinc-800 text-sm text-zinc-400">
        <p className="font-medium text-zinc-300 mb-1">说明</p>
        本控制台仅面向本机（127.0.0.1）使用。管理密钥保存在后端环境变量，不会下发到浏览器。请勿将端口暴露到公网或局域网。
      </div>
    </div>
  );
}
