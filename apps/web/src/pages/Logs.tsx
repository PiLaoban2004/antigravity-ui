import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { api } from '../lib/api';

export default function Logs() {
  const [logs, setLogs] = useState<string>('');
  const [err, setErr] = useState('');

  const load = async () => {
    try {
      const r: any = await api.getLogs();
      if (Array.isArray(r)) {
        setLogs(r.map((l: any) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n'));
      } else if (typeof r === 'string') {
        setLogs(r);
      } else if (r && Array.isArray(r.lines)) {
        setLogs(r.lines.join('\n'));
      } else {
        setLogs(JSON.stringify(r, null, 2));
      }
      setErr('');
    } catch (e) {
      const msg = String(e);
      setErr(msg.includes('logging to file disabled') || msg.includes('400') ? '代理日志功能未开启（可在 CLIProxyAPI 配置中开启 logging-to-file）' : msg);
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">日志</h1>
          <p className="text-zinc-400 text-sm mt-1">代理请求与错误日志（每 5 秒刷新）</p>
        </div>
        <button onClick={load} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-sm">
          <RefreshCw className="w-4 h-4" /> 刷新
        </button>
      </div>

      {err && <div className="mb-4 p-3 rounded-lg bg-red-950 border border-red-900 text-red-300 text-sm">{err}</div>}

      <pre className="p-4 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-zinc-300 overflow-x-auto whitespace-pre-wrap min-h-[300px]">
        {logs || '（无日志）'}
      </pre>
    </div>
  );
}
