import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Check,
  Copy,
  Eye,
  EyeOff,
  Globe2,
  KeyRound,
  Plus,
  RefreshCw,
  ScrollText,
  ShieldAlert,
  Trash2,
  Activity,
  BookOpen,
} from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, type GatewayInfo, type GatewayKey, type GatewayLogRow, type GatewayStats } from '../lib/api';
import { pollWhileVisible } from '../lib/poll';

type Tab = 'overview' | 'keys' | 'logs' | 'guide';
type Period = 'today' | '24h' | '7d' | '30d';

const PERIODS: Array<[Period, string]> = [
  ['today', '今日'],
  ['24h', '24 小时'],
  ['7d', '7 天'],
  ['30d', '30 天'],
];

const fmt = (n: number) => n.toLocaleString();
const compact = (n: number) => (n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n));
const pct = (a: number, b: number) => (b > 0 ? `${((a / b) * 100).toFixed(1)}%` : '--');
const when = (ms: number | null) => (ms ? new Date(ms).toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '--');

function ago(ms: number | null): string {
  if (!ms) return '从未使用';
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s} 秒前`;
  if (s < 3600) return `${Math.round(s / 60)} 分钟前`;
  if (s < 86400) return `${Math.round(s / 3600)} 小时前`;
  return `${Math.round(s / 86400)} 天前`;
}

const ERROR_LABEL: Record<string, string> = {
  no_key: '未带密钥',
  bad_key: '密钥无效',
  disabled: '密钥已停用',
  expired: '密钥已过期',
  rpm: '超每分钟上限',
  concurrency: '超并发上限',
  daily: '超每日上限',
  global_rpm: '网关繁忙(总速率)',
  global_concurrency: '网关繁忙(总并发)',
  model_not_allowed: '模型不在白名单',
  body_too_large: '请求体过大',
  upstream_unavailable: '上游不可用',
  upstream_stream_error: '流中断',
  client_abort: '客户端断开',
};

function statusClass(r: GatewayLogRow) {
  if (r.error && !['client_abort', 'upstream_stream_error', 'upstream_unavailable'].includes(r.error)) return 'text-amber-400';
  if (r.status >= 400) return 'text-red-400';
  return 'text-emerald-400';
}

function useCopy() {
  const [done, setDone] = useState<string | null>(null);
  const copy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(id);
      setTimeout(() => setDone((d) => (d === id ? null : d)), 1500);
    } catch {
      window.prompt('复制失败,请手动复制:', text);
    }
  };
  return { done, copy };
}

export default function Remote() {
  const [tab, setTab] = useState<Tab>('overview');
  const [info, setInfo] = useState<GatewayInfo | null>(null);

  const loadInfo = useCallback(() => api.remoteInfo().then(setInfo).catch(() => setInfo(null)), []);
  useEffect(() => {
    loadInfo();
    return pollWhileVisible(loadInfo, 15_000);
  }, [loadInfo]);

  const tabs: Array<[Tab, string, typeof Activity]> = [
    ['overview', '概览', Activity],
    ['keys', '密钥', KeyRound],
    ['logs', '访问日志', ScrollText],
    ['guide', '接入说明', BookOpen],
  ];

  return (
    <div className="p-4 sm:p-6 md:p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Globe2 className="w-6 h-6 text-sky-400" /> 远程调用
          </h1>
          <p className="text-sm text-zinc-400 mt-1">给自己的设备提供 API 入口,并记录谁在什么时候调用了什么。账号、额度、路由等仍只在本机管理。</p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border ${
              info?.gatewayUp ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-red-500/30 bg-red-500/10 text-red-300'
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${info?.gatewayUp ? 'bg-emerald-400' : 'bg-red-400'}`} />
            {info ? (info.gatewayUp ? '网关运行中' : '网关未运行') : '读取中…'}
          </span>
          {info?.publicUrl && <span className="font-mono text-zinc-400 truncate max-w-[16rem]">{info.publicUrl}</span>}
        </div>
      </div>

      {info && !info.gatewayUp && (
        <div className="p-3 rounded-xl border border-red-500/30 bg-red-500/5 text-sm text-red-200">
          网关进程没有响应(<span className="font-mono">{info.localUrl}</span>)。在 <span className="font-mono">apps/server</span> 下运行{' '}
          <span className="font-mono">bun run gateway</span>,或按 docs/GATEWAY.md 配置开机自启。
        </div>
      )}

      <div className="inline-flex max-w-full min-w-0 overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900/60 p-1 [&>button]:shrink-0 [&>button]:whitespace-nowrap">
        {tabs.map(([id, label, Icon]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors ${
              tab === id ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      {tab === 'overview' && <Overview />}
      {tab === 'keys' && <Keys />}
      {tab === 'logs' && <Logs />}
      {tab === 'guide' && <Guide info={info} />}
    </div>
  );
}

// ---------------------------------------------------------------- overview

function Card({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="p-4 rounded-2xl bg-zinc-900/70 border border-zinc-800/80 shadow-sm min-w-0">
      <div className="text-xs text-zinc-400 font-medium">{label}</div>
      <div className={`text-2xl font-bold font-mono tracking-tight mt-2 truncate ${tone ?? 'text-zinc-100'}`}>{value}</div>
      {sub && <div className="mt-2 text-[11px] text-zinc-400 font-mono truncate">{sub}</div>}
    </div>
  );
}

function Overview() {
  const [period, setPeriod] = useState<Period>('today');
  const [stats, setStats] = useState<GatewayStats | null>(null);
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    try {
      const [s, k] = await Promise.all([api.remoteStats(period), api.remoteKeys()]);
      setStats(s);
      setKeys(Object.fromEntries(k.keys.map((x) => [x.id, x.name])));
      setErr('');
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    }
  }, [period]);
  useEffect(() => {
    load();
    return pollWhileVisible(load, 15_000);
  }, [load]);

  const chart = useMemo(
    () =>
      (stats?.timeline ?? []).map((b) => {
        const d = new Date(b.t);
        const label = period === 'today' || period === '24h' ? `${String(d.getHours()).padStart(2, '0')}:00` : `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}h`;
        return { label, ok: Math.max(0, b.requests - b.errors), errors: b.errors };
      }),
    [stats, period],
  );

  if (err && !stats) return <div className="text-sm text-red-300">加载失败:{err}</div>;
  if (!stats) return <div className="text-sm text-zinc-500">加载中…</div>;

  const keyName = (id: string | null) => (id === null ? '(无有效密钥)' : keys[id] ?? `已删除 ${id}`);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="inline-flex max-w-full min-w-0 overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900/60 p-1 [&>button]:shrink-0 [&>button]:whitespace-nowrap">
          {PERIODS.map(([id, label]) => (
            <button
              key={id}
              onClick={() => setPeriod(id)}
              className={`px-3 py-1 rounded-lg text-xs ${period === id ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <button onClick={load} className="p-2 rounded-lg border border-zinc-800 text-zinc-400 hover:text-zinc-200" title="刷新">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        <Card label="请求数" value={fmt(stats.total)} sub={`转发 ${fmt(stats.forwarded)}`} />
        <Card label="成功率" value={pct(stats.ok, stats.forwarded)} sub={`上游报错 ${fmt(stats.upstreamErrors)}`} tone={stats.upstreamErrors ? 'text-amber-300' : 'text-emerald-300'} />
        <Card label="被网关拒绝" value={fmt(stats.rejected)} sub="鉴权 / 限流 / 白名单" tone={stats.rejected ? 'text-amber-300' : 'text-zinc-100'} />
        <Card label="延迟 P50 / P95" value={stats.latencyP50 === null ? '--' : `${(stats.latencyP50 / 1000).toFixed(1)}s`} sub={stats.latencyP95 === null ? undefined : `P95 ${(stats.latencyP95 / 1000).toFixed(1)}s`} />
        <Card
          label="Tokens(尽力统计)"
          value={stats.tokenRows ? compact(stats.totalTokens) : '--'}
          sub={`${fmt(stats.tokenRows)}/${fmt(stats.forwarded)} 次返回了用量`}
        />
        <Card label="活跃密钥" value={fmt(stats.activeKeys)} />
      </div>

      <div className="p-4 rounded-2xl bg-zinc-900/70 border border-zinc-800/80">
        <div className="text-sm font-medium text-zinc-300 mb-3">请求趋势(按小时)</div>
        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chart} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: '#a1a1aa', fontSize: 11 }} interval="preserveStartEnd" minTickGap={24} />
              <YAxis tick={{ fill: '#a1a1aa', fontSize: 11 }} allowDecimals={false} />
              <Tooltip contentStyle={{ background: '#18181b', border: '1px solid #3f3f46', borderRadius: 12, fontSize: 12 }} />
              <Bar dataKey="ok" name="成功" stackId="a" fill="#10b981" />
              <Bar dataKey="errors" name="非 2xx" stackId="a" fill="#f59e0b" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Rank
          title="按密钥"
          rows={stats.byKey.map((r) => ({ k: keyName(r.keyId), a: `${fmt(r.requests)} 次`, b: r.rejected ? `拒绝 ${r.rejected}` : r.tokens ? `${compact(r.tokens)} tok` : '', warn: r.rejected > 0, sub: when(r.lastMs) }))}
        />
        <Rank title="按模型" rows={stats.byModel.map((r) => ({ k: r.model, a: `${fmt(r.requests)} 次`, b: r.tokens ? `${compact(r.tokens)} tok` : '' }))} />
        <Rank
          title="来源 IP"
          rows={stats.byIp.map((r) => ({ k: r.ip, a: `${fmt(r.requests)} 次`, b: r.rejected ? `拒绝 ${r.rejected}` : '', warn: r.rejected > 0, sub: `${r.country ?? '--'} · ${when(r.lastMs)}` }))}
        />
        <Rank title="国家 / 地区" rows={stats.byCountry.map((r) => ({ k: r.country, a: `${fmt(r.requests)} 次`, b: '' }))} empty="无(需要经 Cloudflare 隧道才有国家信息)" />
      </div>
    </div>
  );
}

function Rank({ title, rows, empty }: { title: string; rows: Array<{ k: string; a: string; b: string; sub?: string; warn?: boolean }>; empty?: string }) {
  return (
    <div className="p-4 rounded-2xl bg-zinc-900/70 border border-zinc-800/80 min-w-0">
      <div className="text-sm font-medium text-zinc-300 mb-3">{title}</div>
      {rows.length === 0 ? (
        <div className="text-xs text-zinc-500">{empty ?? '暂无数据'}</div>
      ) : (
        <ul className="space-y-2">
          {rows.slice(0, 8).map((r, i) => (
            <li key={i} className="flex items-center justify-between gap-3 text-sm">
              <div className="min-w-0">
                <div className="truncate font-mono text-zinc-200">{r.k}</div>
                {r.sub && <div className="text-[11px] text-zinc-500 truncate">{r.sub}</div>}
              </div>
              <div className="shrink-0 text-right font-mono text-xs">
                <div className="text-zinc-300">{r.a}</div>
                {r.b && <div className={r.warn ? 'text-amber-400' : 'text-zinc-500'}>{r.b}</div>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- keys

const EXPIRY: Array<[string, string, number | null]> = [
  ['never', '永不过期', null],
  ['7', '7 天', 7],
  ['30', '30 天', 30],
  ['90', '90 天', 90],
];

function limitText(k: GatewayKey) {
  const parts = [
    k.rpm ? `${k.rpm}/分钟` : null,
    k.concurrency ? `并发 ${k.concurrency}` : null,
    k.dailyLimit ? `${fmt(k.dailyLimit)}/天` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : '无单密钥限制';
}

function Keys() {
  const [keys, setKeys] = useState<GatewayKey[] | null>(null);
  const [err, setErr] = useState('');
  const [creating, setCreating] = useState(false);
  const [fresh, setFresh] = useState<{ key: string; name: string } | null>(null);
  const { done, copy } = useCopy();
  // Full keys the user has chosen to show; held in memory only and cleared on leaving the tab.
  const [shown, setShown] = useState<Record<string, string>>({});

  const reveal = async (k: GatewayKey) => {
    if (shown[k.id]) return setShown(({ [k.id]: _, ...rest }) => rest);
    try {
      const { key } = await api.remoteRevealKey(k.id);
      setShown((p) => ({ ...p, [k.id]: key }));
    } catch (e: any) {
      window.alert(e?.message ?? String(e));
    }
  };

  const load = useCallback(async () => {
    try {
      setKeys((await api.remoteKeys()).keys);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    }
  }, []);
  useEffect(() => {
    load();
    return pollWhileVisible(load, 15_000);
  }, [load]);

  const toggle = async (k: GatewayKey) => {
    await api.remoteUpdateKey(k.id, { enabled: !k.enabled });
    load();
  };
  const remove = async (k: GatewayKey) => {
    if (!window.confirm(`删除密钥「${k.name}」?使用它的客户端会立即收到 401,此操作不可撤销。`)) return;
    await api.remoteDeleteKey(k.id);
    load();
  };

  return (
    <div className="space-y-4">
      <div className="p-3 rounded-xl border border-amber-500/30 bg-amber-500/5 text-sm text-amber-100/90 flex gap-2">
        <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0 text-amber-400" />
        <div>
          密钥只发给<b>你自己的设备</b>。把同一批 Google 账号经中转提供给多人使用,正是社区里账号被限制的主要原因;网关的限流只能压平突发,不能消除这个风险。
        </div>
      </div>

      {fresh && (
        <div className="p-4 rounded-2xl border border-emerald-500/30 bg-emerald-500/5 space-y-2">
          <div className="text-sm text-emerald-200">密钥「{fresh.name}」已创建。之后可以在下面的列表里点「查看」再次显示。</div>
          <div className="flex items-center gap-2">
            <code className="flex-1 min-w-0 truncate px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-800 font-mono text-xs text-zinc-100 select-all">{fresh.key}</code>
            <button onClick={() => copy('fresh', fresh.key)} className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg border border-zinc-700 text-sm hover:bg-zinc-800">
              {done === 'fresh' ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
              复制
            </button>
            <button onClick={() => setFresh(null)} className="shrink-0 px-3 py-2 rounded-lg border border-zinc-700 text-sm text-zinc-300 hover:bg-zinc-800">
              关闭
            </button>
          </div>
        </div>
      )}

      <div className="flex justify-end">
        <button
          data-write
          onClick={() => setCreating((v) => !v)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-sm font-medium whitespace-nowrap"
        >
          <Plus className="w-4 h-4" /> 新建密钥
        </button>
      </div>

      {creating && (
        <CreateForm
          onCreated={(key, name) => {
            setCreating(false);
            setFresh({ key, name });
            load();
          }}
          onCancel={() => setCreating(false)}
        />
      )}

      {err && !keys && <div className="text-sm text-red-300">加载失败:{err}</div>}
      {keys && keys.length === 0 && <div className="text-sm text-zinc-500 p-6 text-center rounded-2xl border border-dashed border-zinc-800">还没有密钥。网关在没有任何有效密钥时会拒绝所有请求。</div>}
      {keys && keys.length > 0 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-950 overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="text-xs text-zinc-400 border-b border-zinc-800">
              <tr className="[&>th]:text-left [&>th]:font-medium [&>th]:px-4 [&>th]:py-2.5">
                <th>名称</th>
                <th>状态</th>
                <th>限制</th>
                <th>近 24h</th>
                <th>最近使用</th>
                <th />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/70">
              {keys.map((k) => {
                const expired = k.expiresMs !== null && k.expiresMs <= Date.now();
                return (
                  <tr key={k.id} className="[&>td]:px-4 [&>td]:py-3 align-top">
                    <td>
                      <div className="text-zinc-100">{k.name}</div>
                      <div className="font-mono text-[11px] text-zinc-500">{k.prefix}… · {k.id}</div>
                      {k.note && <div className="text-[11px] text-zinc-500 mt-0.5">{k.note}</div>}
                      {shown[k.id] && (
                        <div className="flex items-center gap-1.5 mt-2">
                          <code className="max-w-[16rem] truncate px-2 py-1 rounded bg-zinc-900 border border-zinc-800 font-mono text-[11px] text-zinc-100 select-all">{shown[k.id]}</code>
                          <button onClick={() => copy(k.id, shown[k.id])} className="p-1.5 rounded border border-zinc-700 hover:bg-zinc-800" title="复制">
                            {done === k.id ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      )}
                    </td>
                    <td className="whitespace-nowrap">
                      {expired ? (
                        <Badge tone="red">已过期</Badge>
                      ) : k.enabled ? (
                        <Badge tone="emerald">启用</Badge>
                      ) : (
                        <Badge tone="zinc">已停用</Badge>
                      )}
                      <div className="text-[11px] text-zinc-500 mt-1">{k.expiresMs ? `到期 ${when(k.expiresMs)}` : '永不过期'}</div>
                    </td>
                    <td className="text-xs text-zinc-300">
                      <div>{limitText(k)}</div>
                      <div className="text-zinc-500 mt-0.5">{k.models ? `模型:${k.models.join(', ')}` : '任意模型'}</div>
                    </td>
                    <td className="font-mono">{fmt(k.requests24h)}</td>
                    <td className="text-xs text-zinc-300 whitespace-nowrap">
                      {ago(k.lastUsedMs)}
                      {k.lastIp && <div className="font-mono text-zinc-500">{k.lastIp}</div>}
                    </td>
                    <td className="whitespace-nowrap text-right">
                      <button
                        onClick={() => reveal(k)}
                        disabled={!k.revealable}
                        className="p-2 rounded-lg border border-zinc-700 text-zinc-300 hover:bg-zinc-800 disabled:opacity-40 mr-2 align-middle"
                        title={k.revealable ? (shown[k.id] ? '隐藏' : '查看 / 复制完整密钥') : '这个密钥创建时没有保存副本,无法再查看'}
                      >
                        {shown[k.id] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                      <button data-write onClick={() => toggle(k)} className="px-2.5 py-1.5 rounded-lg border border-zinc-700 text-xs hover:bg-zinc-800 mr-2">
                        {k.enabled ? '停用' : '启用'}
                      </button>
                      <button data-write onClick={() => remove(k)} className="p-2 rounded-lg border border-zinc-700 text-red-300 hover:bg-red-500/10" title="删除">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Badge({ tone, children }: { tone: 'emerald' | 'red' | 'zinc'; children: React.ReactNode }) {
  const cls = {
    emerald: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
    red: 'border-red-500/30 bg-red-500/10 text-red-300',
    zinc: 'border-zinc-700 bg-zinc-800/60 text-zinc-400',
  }[tone];
  return <span className={`inline-block px-2 py-0.5 rounded-full border text-xs ${cls}`}>{children}</span>;
}

function CreateForm({ onCreated, onCancel }: { onCreated: (key: string, name: string) => void; onCancel: () => void }) {
  const [f, setF] = useState({ name: '', note: '', expiry: '30', models: '', rpm: '30', concurrency: '2', daily: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((p) => ({ ...p, [k]: e.target.value }));
  const num = (s: string) => (s.trim() === '' ? null : Number(s));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      const days = EXPIRY.find(([id]) => id === f.expiry)?.[2] ?? null;
      const models = f.models.split(/[\s,]+/).filter(Boolean);
      const res = await api.remoteCreateKey({
        name: f.name,
        note: f.note,
        expiresMs: days ? Date.now() + days * 86_400_000 : null,
        models: models.length ? models : null,
        rpm: num(f.rpm),
        concurrency: num(f.concurrency),
        dailyLimit: num(f.daily),
      });
      onCreated(res.key, res.record.name);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const input = 'w-full px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-sm focus:outline-none focus:border-sky-500';
  const label = 'block text-xs text-zinc-400 mb-1';
  return (
    <form onSubmit={submit} className="p-4 rounded-2xl bg-zinc-900/70 border border-zinc-800/80 space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className={label}>名称(必填,如「我的手机」)</label>
          <input className={input} value={f.name} onChange={set('name')} maxLength={60} required />
        </div>
        <div>
          <label className={label}>备注</label>
          <input className={input} value={f.note} onChange={set('note')} maxLength={200} />
        </div>
        <div>
          <label className={label}>有效期</label>
          <select className={input} value={f.expiry} onChange={set('expiry')}>
            {EXPIRY.map(([id, text]) => (
              <option key={id} value={id}>
                {text}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={label}>模型白名单(逗号分隔,末尾 * 为前缀匹配;留空 = 任意模型)</label>
          <input className={input} value={f.models} onChange={set('models')} placeholder="gemini-*, claude-sonnet-*" />
        </div>
        <div>
          <label className={label}>每分钟请求上限</label>
          <input className={input} type="number" min={1} max={10000} value={f.rpm} onChange={set('rpm')} placeholder="不限" />
        </div>
        <div>
          <label className={label}>并发上限</label>
          <input className={input} type="number" min={1} max={64} value={f.concurrency} onChange={set('concurrency')} placeholder="不限" />
        </div>
        <div>
          <label className={label}>每日请求上限</label>
          <input className={input} type="number" min={1} value={f.daily} onChange={set('daily')} placeholder="不限" />
        </div>
      </div>
      {err && <div className="text-sm text-red-300">{err}</div>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="px-3 py-2 rounded-lg border border-zinc-700 text-sm text-zinc-300 hover:bg-zinc-800">
          取消
        </button>
        <button disabled={busy || !f.name.trim()} className="px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-sm font-medium">
          {busy ? '创建中…' : '创建'}
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------- logs

function Logs() {
  const [rows, setRows] = useState<GatewayLogRow[]>([]);
  const [more, setMore] = useState(true);
  const [outcome, setOutcome] = useState('');
  const [keyId, setKeyId] = useState('');
  const [keys, setKeys] = useState<GatewayKey[]>([]);
  const [err, setErr] = useState('');

  const q = useMemo(() => ({ outcome: outcome || undefined, keyId: keyId || undefined }), [outcome, keyId]);

  const load = useCallback(async () => {
    try {
      const r = await api.remoteLogs({ ...q, limit: 100 });
      setRows(r.rows);
      setMore(r.rows.length === 100);
      setErr('');
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    }
  }, [q]);
  useEffect(() => {
    api.remoteKeys().then((r) => setKeys(r.keys)).catch(() => {});
  }, []);
  useEffect(() => {
    load();
    return pollWhileVisible(load, 10_000);
  }, [load]);

  const loadMore = async () => {
    const last = rows[rows.length - 1];
    if (!last) return;
    const r = await api.remoteLogs({ ...q, limit: 100, beforeId: last.id });
    setRows((p) => [...p, ...r.rows]);
    setMore(r.rows.length === 100);
  };

  const sel = 'px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-sm';
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select className={sel} value={outcome} onChange={(e) => setOutcome(e.target.value)}>
          <option value="">全部结果</option>
          <option value="ok">成功</option>
          <option value="error">上游报错 / 流中断</option>
          <option value="rejected">被网关拒绝</option>
        </select>
        <select className={sel} value={keyId} onChange={(e) => setKeyId(e.target.value)}>
          <option value="">全部密钥</option>
          {keys.map((k) => (
            <option key={k.id} value={k.id}>
              {k.name}
            </option>
          ))}
        </select>
        <button onClick={load} className="p-2 rounded-lg border border-zinc-800 text-zinc-400 hover:text-zinc-200" title="刷新">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>
      {err && <div className="text-sm text-red-300">加载失败:{err}</div>}
      <div className="rounded-xl border border-zinc-800 bg-zinc-950 overflow-x-auto">
        <table className="w-full min-w-[860px] text-xs">
          <thead className="text-zinc-400 border-b border-zinc-800">
            <tr className="[&>th]:text-left [&>th]:font-medium [&>th]:px-3 [&>th]:py-2.5">
              <th>时间</th>
              <th>密钥</th>
              <th>来源</th>
              <th>接口 / 模型</th>
              <th>状态</th>
              <th>耗时</th>
              <th>Tokens</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/70 font-mono">
            {rows.map((r) => (
              <tr key={r.id} className="[&>td]:px-3 [&>td]:py-2 align-top">
                <td className="whitespace-nowrap text-zinc-400">{when(r.tsMs)}</td>
                <td className="font-sans text-zinc-200">{r.keyName ?? (r.keyId ? `已删除 ${r.keyId}` : '--')}</td>
                <td className="whitespace-nowrap">
                  {r.ip}
                  {r.country && <span className="text-zinc-500"> {r.country}</span>}
                </td>
                <td>
                  <div className="text-zinc-300">{r.path}</div>
                  <div className="text-zinc-500">{r.model ?? '--'}{r.stream ? ' · stream' : ''}</div>
                </td>
                <td className={`whitespace-nowrap ${statusClass(r)}`}>
                  {r.status}
                  {r.error && <div className="font-sans text-[11px]">{ERROR_LABEL[r.error] ?? r.error}</div>}
                </td>
                <td className="whitespace-nowrap text-zinc-300">{r.latencyMs >= 1000 ? `${(r.latencyMs / 1000).toFixed(1)}s` : `${r.latencyMs}ms`}</td>
                <td className="whitespace-nowrap text-zinc-300">
                  {r.totalTokens === null ? '--' : fmt(r.totalTokens)}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center font-sans text-zinc-500">
                  暂无记录
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {more && rows.length > 0 && (
        <div className="text-center">
          <button onClick={loadMore} className="px-4 py-2 rounded-lg border border-zinc-700 text-sm text-zinc-300 hover:bg-zinc-800">
            加载更多
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- guide

function Guide({ info }: { info: GatewayInfo | null }) {
  const base = info?.publicUrl ?? 'https://api.example.com';
  const { done, copy } = useCopy();
  const snippets: Array<{ id: string; title: string; hint: string; text: string }> = [
    {
      id: 'curl',
      title: 'curl(OpenAI 兼容)',
      hint: '把密钥放在环境变量 GATEWAY_API_KEY 里,不要写进命令历史。',
      text: `curl ${base}/v1/chat/completions \\\n  -H "Authorization: Bearer $GATEWAY_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"model":"gemini-3.7-flash-high","messages":[{"role":"user","content":"Hello"}]}'`,
    },
    {
      id: 'openai',
      title: 'OpenAI SDK / 通用客户端',
      hint: '大多数工具只需要这两个环境变量。',
      text: `export OPENAI_BASE_URL=${base}/v1\nexport OPENAI_API_KEY=$GATEWAY_API_KEY`,
    },
    {
      id: 'claude',
      title: 'Claude Code',
      hint: '走 /v1/messages。',
      text: `export ANTHROPIC_BASE_URL=${base}\nexport ANTHROPIC_AUTH_TOKEN=$GATEWAY_API_KEY`,
    },
    {
      id: 'codex',
      title: 'Codex',
      hint: '写入 ~/.codex/config.toml,密钥通过 env_key 读取环境变量。',
      text: `model_provider = "remote"\n\n[model_providers.remote]\nname = "Remote Gateway"\nbase_url = "${base}/v1"\nwire_api = "responses"\nenv_key = "GATEWAY_API_KEY"`,
    },
  ];
  return (
    <div className="space-y-4">
      <div className="p-4 rounded-2xl bg-zinc-900/70 border border-zinc-800/80 text-sm text-zinc-300 space-y-1.5">
        <div>
          对外地址:{' '}
          {info?.publicUrl ? (
            <span className="font-mono text-sky-300">{info.publicUrl}</span>
          ) : (
            <span className="text-amber-300">未配置。在 apps/server/.env 设置 ANTI_UI_GATEWAY_PUBLIC_URL 后这里的示例会自动填入。</span>
          )}
        </div>
        <div className="text-xs text-zinc-500 [overflow-wrap:anywhere]">
          只转发模型调用接口(/v1/chat/completions、/v1/completions、/v1/responses、/v1/messages、/v1/models、/v1beta/models/*:generateContent 等),管理接口不会暴露。
          全局上限:每分钟 {info?.globalRpm ?? '--'} 次、并发 {info?.globalConcurrency ?? '--'};访问记录保留 {info?.retentionDays ?? '--'} 天。
        </div>
      </div>
      {snippets.map((s) => (
        <div key={s.id} className="rounded-2xl bg-zinc-900/70 border border-zinc-800/80 overflow-hidden">
          <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-zinc-800">
            <div className="min-w-0">
              <div className="text-sm font-medium text-zinc-200">{s.title}</div>
              <div className="text-[11px] text-zinc-500 truncate">{s.hint}</div>
            </div>
            <button onClick={() => copy(s.id, s.text)} className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-zinc-700 text-xs hover:bg-zinc-800">
              {done === s.id ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              复制
            </button>
          </div>
          <pre className="p-4 text-xs font-mono text-zinc-300 overflow-x-auto">{s.text}</pre>
        </div>
      ))}
    </div>
  );
}
