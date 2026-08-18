import { useEffect, useState } from 'react';
import { Server, Users, Boxes, GitBranch, ShieldAlert } from 'lucide-react';
import { api } from '../lib/api';
import type { AuthFile, HealthStatus } from '@antigravity-ui/shared';

export default function Dashboard() {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [files, setFiles] = useState<AuthFile[]>([]);
  const [err, setErr] = useState('');

  useEffect(() => {
    const load = async () => {
      try {
        const [h, f] = await Promise.all([api.health(), api.authFiles()]);
        setHealth(h);
        setFiles(f.files);
      } catch (e) {
        setErr(String(e));
      }
    };
    load();
  }, []);

  const cards = [
    { label: '账号总数', value: health?.authCount ?? '—', icon: Users, color: 'text-sky-400' },
    { label: '活跃账号', value: health?.activeCount ?? '—', icon: Server, color: 'text-emerald-400' },
    { label: '错误账号', value: health?.errorCount ?? '—', icon: ShieldAlert, color: 'text-red-400' },
    { label: '可用模型', value: health?.models ?? '—', icon: Boxes, color: 'text-violet-400' },
  ];

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">总览</h1>
          <p className="text-zinc-400 text-sm mt-1">反代服务运行状态与账号概览</p>
        </div>
        <span className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-full bg-zinc-900 border border-zinc-800">
          <GitBranch className="w-4 h-4 text-zinc-400" />
          策略：{health?.strategy ?? '—'}
        </span>
      </div>

      {err && <div className="mb-4 p-3 rounded-lg bg-red-950 border border-red-900 text-red-300 text-sm">{err}</div>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {cards.map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="p-5 rounded-xl bg-zinc-900 border border-zinc-800">
            <div className="flex items-center justify-between">
              <span className="text-sm text-zinc-400">{label}</span>
              <Icon className={`w-5 h-5 ${color}`} />
            </div>
            <div className="text-3xl font-semibold mt-2">{value}</div>
          </div>
        ))}
      </div>

      <h2 className="text-lg font-medium mb-3">账号状态</h2>
      <div className="grid gap-3">
        {files.length === 0 && <div className="text-zinc-500 text-sm p-6 text-center border border-dashed border-zinc-800 rounded-xl">暂无账号</div>}
        {files.map((f) => (
          <div key={f.id} className="flex items-center justify-between p-4 rounded-xl bg-zinc-900 border border-zinc-800">
            <div className="flex items-center gap-3">
              <span
                className={`w-2.5 h-2.5 rounded-full ${
                  f.disabled ? 'bg-zinc-500' : f.status === 'error' ? 'bg-red-500' : 'bg-emerald-400'
                }`}
              />
              <div>
                <div className="font-medium">{f.email || f.account}</div>
                <div className="text-xs text-zinc-500">provider: {f.provider} · project: {f.project_id ?? '—'}</div>
              </div>
            </div>
            <div className="text-right text-xs text-zinc-400">
              <div>成功 {f.success} · 失败 {f.failed}</div>
              <div className={f.status === 'error' ? 'text-red-400' : ''}>
                {f.disabled ? '已禁用' : f.status === 'error' ? '错误' : '正常'}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
