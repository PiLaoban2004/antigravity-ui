import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import { AGENTROUTER_MODELS, inferGroup, isProviderGroup, isWorkBuddyModel } from './groups';
import { fetchLiveSnapshots } from './language-server';
import { priceFor } from './pricing';
import { insertUsageRows, openUsageDb, parseUsageRecord, pruneUsage, queryTimeline, type UsageInput } from './usage-db';
import { createAuth, loadRemoteConfig } from './auth';
import { createStaticHandler } from './static';
import { createAuditMiddleware, ensureAuditSchema, recentAudit, recordAudit } from './audit';
import { createCallGate } from './limits';
import { createKey, deleteKey, listKeys, parseKeyInput, revealKey, updateKey } from './gateway/keys';
import { loadMasterKey } from './gateway/secret';
import { queryGatewayLogs, queryGatewayStats, requestsLast24h, type LogQuery } from './gateway/stats';
import { Broadcaster, TtlCache, responseCache } from './shared-cache';
import { apiSecurityHeaders, createLocalGuard, isDirectLocalRequest, isMgmtAllowed, redactSecrets } from './security';
import {
  QUOTA_CACHE_MAX_AGE_MS,
  QUOTA_CACHE_VERSION,
  buildQuotaGroup,
  formatCountdownEn,
  formatCountdownZh,
  fractionToPct,
  freshenQuotaSnapshot,
} from './quota';

const PROXY_URL = (process.env.ANTI_UI_PROXY_URL ?? 'http://127.0.0.1:8317').replace(/\/$/, '');
const AGENTROUTER_PROXY_URL = (process.env.ANTI_UI_AGENTROUTER_URL ?? 'http://127.0.0.1:15721').replace(/\/$/, '');
// WorkBuddy 本地网关（workbuddy2api，Go）—— 独立进程，自带 /healthz、/status、/v1/stats
const WORKBUDDY_URL = (process.env.ANTI_UI_WORKBUDDY_URL ?? 'http://127.0.0.1:7863').replace(/\/$/, '');
const WORKBUDDY_KEY = process.env.ANTI_UI_WORKBUDDY_KEY ?? '';
const MGMT_KEY = process.env.ANTI_UI_MGMT_KEY ?? '';
const PORT = Number(process.env.ANTI_UI_PORT ?? 4310);
const WEB_ORIGIN = process.env.ANTI_UI_WEB_ORIGIN ?? 'http://127.0.0.1:4321';

const app = new Hono();

// ---- Usage statistics store (bun:sqlite; schema + migrations live in usage-db.ts) ----
const db = openUsageDb('usage.sqlite');

// The gateway's usage queue is drained destructively, so rows it hands over must not be lost if the
// insert fails: keep them here and retry together with the next batch.
let pendingUsage: UsageInput[] = [];
const MAX_PENDING_USAGE = 5000;

let consuming = false;
async function consumeUsageQueue() {
  if (consuming) return;
  consuming = true;
  try {
    const res = await mgmt('/usage-queue?count=200');
    const data: any = res.ok ? await res.json() : [];
    const fetched: UsageInput[] = (Array.isArray(data) ? data : []).map((r: any) => {
      const t = r.tokens ?? {};
      return {
        ts: r.timestamp ?? new Date().toISOString(),
        model: r.model ?? 'unknown',
        account: r.source ?? r.account ?? 'unknown',
        input_tokens: t.input_tokens ?? 0,
        output_tokens: t.output_tokens ?? 0,
        reasoning_tokens: t.reasoning_tokens ?? 0,
        total_tokens: t.total_tokens ?? 0,
        latency_ms: r.latency_ms ?? 0,
        failed: Boolean(r.failed),
        group: 'antigravity', // everything in CLIProxyAPI's queue was served by CLIProxyAPI
      };
    });
    const batch = [...pendingUsage, ...fetched];
    if (!batch.length) return;
    try {
      insertUsageRows(db, batch);
      pendingUsage = [];
      console.log(`[usage] consumed ${batch.length} records`);
    } catch (e) {
      pendingUsage = batch.slice(-MAX_PENDING_USAGE);
      console.error(`[usage] insert failed, keeping ${pendingUsage.length} rows for retry:`, e);
    }
  } catch {
    // gateway unreachable; retry next tick
  } finally {
    consuming = false;
  }
}

// Remote mode (ANTI_UI_REMOTE=1) adds token auth and lets a tunnel's hostname through; default is loopback-only.
const remote = loadRemoteConfig(process.env);
const auth = createAuth(remote);

const BIND_HOST = process.env.ANTI_UI_BIND_HOST ?? '127.0.0.1';
if (!['127.0.0.1', 'localhost', '::1'].includes(BIND_HOST) && !remote.enabled) {
  throw new Error(`ANTI_UI_BIND_HOST=${BIND_HOST} exposes the dashboard beyond this machine; set ANTI_UI_REMOTE=1 (with tokens) first`);
}

const WEB_ORIGINS = [
  ...new Set([
    WEB_ORIGIN,
    'http://127.0.0.1:4321',
    'http://localhost:4321',
    ...remote.webOrigins,
    ...remote.allowedHosts.map((h) => `https://${h}`),
  ]),
];

// Order matters: guard (Host/Origin) -> cors (answers preflight) -> auth (credentials, roles).
app.use('/api/*', apiSecurityHeaders);
app.use('/api/*', createLocalGuard({ port: PORT, webOrigins: WEB_ORIGINS, allowedHosts: remote.allowedHosts }));
app.use(
  '/api/*',
  cors({
    origin: WEB_ORIGINS,
    credentials: true,
    allowHeaders: ['Content-Type', 'Authorization', 'X-Record-Key'],
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  }),
);
ensureAuditSchema(db);
if (remote.enabled) app.use('/api/*', createAuditMiddleware(db, auth)); // before auth so refused logins are recorded too
app.use('/api/*', auth.middleware);
auth.registerRoutes(app);

app.get('/api/audit', (c) => {
  if (auth.roleOf(c) !== 'admin') return c.json({ error: 'admin role required' }, 403);
  return c.json({ remote: remote.enabled, rows: recentAudit(db, Number(c.req.query('limit') ?? 100)) });
});

// ---- Remote API gateway management (keys + access stats). The gateway itself is a separate process
// (src/gateway/index.ts) that shares usage.sqlite; this only edits its keys and reads its log. ----
// Encrypts the stored copy of each key so the dashboard can show it again (master key: env or a 0600 file next to the db).
const GATEWAY_MASTER_KEY = loadMasterKey(process.env, '.gateway-secret');
const GATEWAY_PORT = Number(process.env.ANTI_UI_GATEWAY_PORT ?? 4311);
const GATEWAY_PUBLIC_URL = (process.env.ANTI_UI_GATEWAY_PUBLIC_URL ?? '').replace(/\/$/, '');

app.get('/api/remote/info', async (c) => {
  let gatewayUp = false;
  try {
    gatewayUp = (await fetch(`http://127.0.0.1:${GATEWAY_PORT}/healthz`, { signal: AbortSignal.timeout(1500) })).ok;
  } catch {
    /* not running */
  }
  return c.json({
    publicUrl: GATEWAY_PUBLIC_URL || null,
    localUrl: `http://127.0.0.1:${GATEWAY_PORT}`,
    gatewayUp,
    globalRpm: Number(process.env.ANTI_UI_GATEWAY_GLOBAL_RPM ?? 120),
    globalConcurrency: Number(process.env.ANTI_UI_GATEWAY_GLOBAL_CONCURRENCY ?? 4),
    retentionDays: Number(process.env.ANTI_UI_GATEWAY_RETENTION_DAYS ?? 90),
  });
});

app.get('/api/remote/keys', (c) => {
  const last24h = requestsLast24h(db);
  return c.json({ keys: listKeys(db).map((k) => ({ ...k, requests24h: last24h[k.id] ?? 0 })) });
});

app.post('/api/remote/keys', async (c) => {
  const parsed = parseKeyInput(await c.req.json().catch(() => null), { partial: false });
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const { key, record } = createKey(db, parsed.value as any, Date.now(), GATEWAY_MASTER_KEY);
  return c.json({ key, record: { ...record, requests24h: 0 } }, 201);
});

// Shows the full key again. Admin only (a viewer must not be able to read credentials) and written to the audit log,
// since a GET is otherwise not audited.
app.get('/api/remote/keys/:id/secret', (c) => {
  if (auth.roleOf(c) !== 'admin') return c.json({ error: 'admin role required' }, 403);
  const id = c.req.param('id');
  const key = revealKey(db, id, GATEWAY_MASTER_KEY);
  recordAudit(db, { ts: Date.now(), role: 'admin', ip: auth.clientIp(c), ua: c.req.header('user-agent') ?? '', method: 'GET', path: `/api/remote/keys/${id.slice(0, 20)}/secret`, status: key ? 200 : 404 });
  return key ? c.json({ key }) : c.json({ error: 'this key cannot be shown (it was created before keys were stored)' }, 404);
});

app.patch('/api/remote/keys/:id', async (c) => {
  const parsed = parseKeyInput(await c.req.json().catch(() => null), { partial: true });
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const rec = updateKey(db, c.req.param('id'), parsed.value);
  return rec ? c.json({ record: rec }) : c.json({ error: 'not found' }, 404);
});

app.delete('/api/remote/keys/:id', (c) => (deleteKey(db, c.req.param('id')) ? c.json({ ok: true }) : c.json({ error: 'not found' }, 404)));

app.get('/api/remote/stats', (c) => {
  const period = c.req.query('period') ?? 'today';
  const now = Date.now();
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const since = period === '30d' ? now - 30 * 86_400_000 : period === '7d' ? now - 7 * 86_400_000 : period === '24h' ? now - 86_400_000 : midnight.getTime();
  return c.json(queryGatewayStats(db, since, now + 1));
});

app.get('/api/remote/logs', (c) => {
  const q: LogQuery = { limit: Number(c.req.query('limit') ?? 100) };
  const before = Number(c.req.query('beforeId'));
  if (Number.isInteger(before) && before > 0) q.beforeId = before;
  const outcome = c.req.query('outcome');
  if (outcome === 'ok' || outcome === 'error' || outcome === 'rejected') q.outcome = outcome;
  if (c.req.query('keyId')) q.keyId = c.req.query('keyId')!.slice(0, 40);
  if (c.req.query('model')) q.model = c.req.query('model')!.slice(0, 100);
  return c.json({ rows: queryGatewayLogs(db, q) });
});

// Calls that spend real upstream quota (or act with an account's OAuth token) get a circuit breaker.
// Generous for the "test everything" button, tight against a runaway loop.
app.use('/api/test/model', createCallGate({ max: 120, windowMs: 60_000, concurrency: 3 }));
app.use('/api/auth/test', createCallGate({ max: 30, windowMs: 60_000, concurrency: 2 }));

// Upstream-facing work is shared between viewers: N open browsers cost what one does.
const shared = new TtlCache();
/** CLIProxyAPI's auth-file list, fetched at most once per 2s however many viewers/pages ask. */
const getAuthFiles = () =>
  shared.get('auth-files', 2000, async () => {
    const res = await mgmt('/auth-files');
    if (!res.ok) throw new Error(`auth-files ${res.status}`);
    const data: any = await res.json();
    return (data.files ?? []) as any[];
  });
app.use('/api/health', responseCache(shared, 5_000)); // fans out to every gateway
app.use('/api/quota', responseCache(shared, 20_000)); // ends in language_server RPCs, which in turn reach Google

/** Forward any call to the CLIProxyAPI Management API, injecting the secret. */
async function mgmt(path: string, init?: RequestInit): Promise<Response> {
  const url = `${PROXY_URL}/v0/management${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${MGMT_KEY}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  return res;
}

/** Forward any call to the WorkBuddy gateway, injecting its own bearer key. */
async function wbFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${WORKBUDDY_URL}${path}`, {
    ...init,
    headers: {
      ...(WORKBUDDY_KEY ? { Authorization: `Bearer ${WORKBUDDY_KEY}` } : {}),
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
}

// ---- Management proxy: allowlisted (method, path) pairs only, see security.ts ----
app.all('/api/mgmt/*', async (c) => {
  const path = c.req.path.replace('/api/mgmt', '');
  if (!isMgmtAllowed(c.req.method, path)) {
    return c.json({ error: `management endpoint not allowed: ${c.req.method} ${path}` }, 403);
  }
  // A login from a new device/IP is the classic trigger for account review, and remote OAuth is unreliable anyway.
  if (remote.enabled && path === '/antigravity-auth-url' && !isDirectLocalRequest(c)) {
    return c.json({ error: 'OAuth sign-in is only available from the machine running the dashboard (open http://127.0.0.1:' + PORT + ' there)' }, 403);
  }
  const query = new URL(c.req.url).search;
  const body = ['GET', 'HEAD'].includes(c.req.method) ? undefined : await c.req.text().catch(() => undefined);
  const res = await mgmt(path + query, body ? { method: c.req.method, body } : { method: c.req.method });
  const text = await res.text();
  if (c.req.method !== 'GET') shared.invalidate(); // account state changed: do not serve a stale list/health/quota
  // The config page only displays this; never hand API keys / management secrets to the browser.
  if (path === '/config' && res.ok) {
    try {
      return c.json(redactSecrets(JSON.parse(text)) as any);
    } catch {
      /* not JSON: fall through and return as-is */
    }
  }
  return new Response(text, { status: res.status, headers: { 'Content-Type': 'application/json' } });
});

// ---- Credential check: fixed tokeninfo call made server-side, so the browser never needs the generic /api-call ----
app.post('/api/auth/test', async (c) => {
  const { auth_index } = await c.req.json().catch(() => ({} as any));
  if (typeof auth_index !== 'string' || !/^[\w.-]{1,128}$/.test(auth_index)) {
    return c.json({ error: 'valid auth_index required' }, 400);
  }
  try {
    const res = await mgmt('/api-call', {
      method: 'POST',
      body: JSON.stringify({
        method: 'GET',
        url: 'https://oauth2.googleapis.com/tokeninfo',
        auth_index,
        header: { Authorization: 'Bearer $TOKEN$' },
      }),
    });
    const text = await res.text();
    return new Response(text, { status: res.status, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return c.json({ error: String(e) }, 502);
  }
});

// ---- Proxy /v1/models (Unified Model list with Antigravity & AgentRouter groups) ----
app.get('/api/models', async (c) => {
  const [antiRes, arRes, wbRes] = await Promise.allSettled([
    fetch(`${PROXY_URL}/v1/models`),
    fetch(`${AGENTROUTER_PROXY_URL}/v1/models`),
    wbFetch('/v1/models'),
  ]);

  let antiModels: any[] = [];
  if (antiRes.status === 'fulfilled' && antiRes.value.ok) {
    const j: any = await antiRes.value.json().catch(() => ({}));
    antiModels = (j.data ?? []).map((m: any) => ({
      ...m,
      group: 'antigravity',
      provider: 'Google Antigravity',
      endpoints: ['openai'],
      pricing: priceFor(m.id, 'antigravity'),
    }));
  }

  let arModels: any[] = [];
  if (arRes.status === 'fulfilled' && arRes.value.ok) {
    const j: any = await arRes.value.json().catch(() => ({}));
    arModels = (j.data ?? []).map((m: any) => ({
      ...m,
      group: 'agentrouter',
      provider: m.id === 'agentrouter-race' ? 'AgentRouter (5-Model Racing 竞速)' : 'AgentRouter',
      endpoints: m.id === 'gpt-5.6-sol' ? ['openai'] : ['openai', 'anthropic'],
      pricing: priceFor(m.id, 'agentrouter'),
    }));
  }

  // WorkBuddy：积分制（非美元计费），pricing 记 0；credits 倍率透传给 UI 展示
  let wbModels: any[] = [];
  if (wbRes.status === 'fulfilled' && wbRes.value.ok) {
    const j: any = await wbRes.value.json().catch(() => ({}));
    wbModels = (j.data ?? []).map((m: any) => {
      const realm = String(m.id).startsWith('cn:') ? 'cn' : 'global';
      return {
        ...m,
        group: 'workbuddy',
        realm,
        provider: realm === 'cn' ? 'WorkBuddy · 国内节点' : 'WorkBuddy · 全球节点',
        endpoints: ['openai'],
        pricing: { input: 0, output: 0 },
      };
    });
  }

  return c.json({
    object: 'list',
    data: [...antiModels, ...arModels, ...wbModels],
    groups: ['antigravity', 'agentrouter', 'workbuddy'],
    success: true,
  });
});

// ---- AgentRouter Dedicated Stats API ----
app.get('/api/agentrouter/stats', async (c) => {
  try {
    const res = await fetch(`${AGENTROUTER_PROXY_URL}/stats`);
    if (res.ok) {
      const data = await res.json();
      return c.json(data);
    }
    return c.json({ ok: false, error: `HTTP ${res.status}` }, res.status as any);
  } catch (e) {
    return c.json({ ok: false, error: String(e) }, 502);
  }
});

// ---- WorkBuddy Dedicated API（账号池 / 用量 / 账号管理，独立 bearer） ----
app.get('/api/workbuddy/status', async (c) => {
  try {
    const res = await wbFetch('/status');
    const text = await res.text();
    return new Response(text, { status: res.status, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return c.json({ ok: false, error: String(e) }, 502);
  }
});

app.get('/api/workbuddy/stats', async (c) => {
  try {
    const res = await wbFetch('/v1/stats');
    const text = await res.text();
    return new Response(text, { status: res.status, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return c.json({ ok: false, error: String(e) }, 502);
  }
});

// 账号管理写操作：disable / enable / revive（转发到网关 /admin/accounts/{uid}/{action}）
app.post('/api/workbuddy/accounts/:uid/:action', async (c) => {
  const uid = c.req.param('uid');
  const action = c.req.param('action');
  if (!['disable', 'enable', 'revive'].includes(action)) {
    return c.json({ ok: false, error: `unsupported action: ${action}` }, 400);
  }
  try {
    const body = await c.req.text().catch(() => '');
    const res = await wbFetch(`/admin/accounts/${encodeURIComponent(uid)}/${action}`, {
      method: 'POST',
      body: body && body.length ? body : '{}',
    });
    const text = await res.text();
    shared.invalidate(); // pool state changed: drop cached health
    return new Response(text, { status: res.status, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return c.json({ ok: false, error: String(e) }, 502);
  }
});

// ---- Test a model's real availability through the corresponding proxy ----
app.post('/api/test/model', async (c) => {
  const { model, group } = await c.req.json().catch(() => ({} as any));
  if (!model) return c.json({ error: 'model required' }, 400);

  const isAgentRouter = group === 'agentrouter' || AGENTROUTER_MODELS.includes(model);
  const isWorkBuddy = group === 'workbuddy' || isWorkBuddyModel(model);
  const targetBaseUrl = isWorkBuddy ? WORKBUDDY_URL : isAgentRouter ? AGENTROUTER_PROXY_URL : PROXY_URL;
  const targetGroup = isWorkBuddy ? 'workbuddy' : isAgentRouter ? 'agentrouter' : 'antigravity';
  const probeHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
  // WorkBuddy 网关全接口强制 Bearer 鉴权（/healthz 除外）
  if (isWorkBuddy && WORKBUDDY_KEY) probeHeaders.Authorization = `Bearer ${WORKBUDDY_KEY}`;
  const start = Date.now();

  try {
    const res = await fetch(`${targetBaseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: probeHeaders,
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
        max_tokens: 15,
      }),
    });
    const text = await res.text();
    let reply = '';
    let winner = undefined;
    try {
      const j = JSON.parse(text);
      reply = j.choices?.[0]?.message?.content ?? '';
      winner = j.model;
    } catch {
      /* non-JSON error body */
    }
    return c.json({
      ok: res.ok,
      status: res.status,
      latency_ms: Date.now() - start,
      reply: reply.slice(0, 80),
      winner,
      group: targetGroup,
      error: res.ok ? undefined : text.slice(0, 200),
    });
  } catch (e) {
    return c.json({
      ok: false,
      latency_ms: Date.now() - start,
      group: targetGroup,
      error: String(e),
    });
  }
});

// ---- Usage statistics endpoints ----
app.get('/api/usage/models', (c) => {
  const rows = db
    .query(
      `SELECT model,
              COALESCE(MAX(grp), 'antigravity') AS "group",
              COUNT(*) AS calls,
              SUM(CASE WHEN failed = 0 THEN 1 ELSE 0 END) AS success,
              SUM(CASE WHEN failed = 1 THEN 1 ELSE 0 END) AS failed,
              SUM(input_tokens) AS input_tokens,
              SUM(output_tokens) AS output_tokens,
              SUM(reasoning_tokens) AS reasoning_tokens,
              SUM(total_tokens) AS total_tokens,
              ROUND(AVG(latency_ms)) AS avg_latency_ms
       FROM usage GROUP BY model ORDER BY calls DESC`,
    )
    .all();
  return c.json(rows);
});

app.get('/api/usage/accounts', (c) => {
  const rows = db
    .query(
      `SELECT account,
              COUNT(*) AS calls,
              SUM(total_tokens) AS total_tokens,
              SUM(CASE WHEN failed = 1 THEN 1 ELSE 0 END) AS failed
       FROM usage GROUP BY account ORDER BY calls DESC`,
    )
    .all();
  return c.json(rows);
});

app.get('/api/usage/recent', (c) => {
  const rows = db.query(`SELECT * FROM usage ORDER BY id DESC LIMIT 50`).all();
  return c.json(rows);
});

app.get('/api/usage/summary', (c) => {
  const s: any = db
    .query(
      `SELECT COUNT(*) AS total_calls,
              SUM(total_tokens) AS total_tokens,
              SUM(input_tokens) AS input_tokens,
              SUM(output_tokens) AS output_tokens,
              SUM(reasoning_tokens) AS reasoning_tokens
       FROM usage`,
    )
    .get();
  return c.json(s ?? {});
});

// ---- Antigravity Native Quota Detection & Caching ----
// Quota snapshots are cached PER ACCOUNT. The local Antigravity IDE is only ever
// signed into one account at a time, so a single shared cache file would serve
// that account's quota under a different account's name. Key by email instead.
function quotaCachePathFor(email: string) {
  return `quota_cache_${email.replace(/[^a-zA-Z0-9._@-]/g, '_')}.json`;
}

async function saveQuotaCache(data: any, email: string) {
  if (!email) return;
  const toSave = { ...data, cacheVersion: QUOTA_CACHE_VERSION, cachedAt: new Date().toISOString(), cachedFor: email };
  try {
    await Bun.write(quotaCachePathFor(email), JSON.stringify(toSave, null, 2));
  } catch (e) {
    console.warn(`[quota] failed to write cache for ${email}:`, e);
  }
}

async function loadQuotaCache(email: string): Promise<any | null> {
  if (!email) return null;
  try {
    const file = Bun.file(quotaCachePathFor(email));
    if (!(await file.exists())) return null;
    const data = await file.json();
    // Only trust a snapshot recorded for this account, in the current format (older ones stored
    // pre-formatted countdown strings with no reset timestamps, so they cannot be re-aged).
    if (data?.cacheVersion !== QUOTA_CACHE_VERSION || data.cachedFor !== email) return null;
    const ageMs = Date.now() - new Date(data.cachedAt).getTime();
    if (!(ageMs >= 0 && ageMs <= QUOTA_CACHE_MAX_AGE_MS)) return null;
    return data;
  } catch {
    return null;
  }
}

/** Which quota pool a model id belongs to (Claude / GPT-OSS share one, Gemini has its own). */
function quotaGroupOf(modelIdOrLabel: string): 'claude_gpt' | 'gemini' {
  const s = modelIdOrLabel.toLowerCase();
  return s.includes('claude') || s.includes('gpt') ? 'claude_gpt' : 'gemini';
}

/** Used only when the gateway's /v1/models is unreachable. */
const FALLBACK_QUOTA_MODELS = [
  { label: 'Gemini 3.8 Flash (High)', modelId: 'gemini-3.8-flash-high' },
  { label: 'Gemini 3.7 Flash (High)', modelId: 'gemini-3.7-flash-high' },
  { label: 'Gemini 3.6 Flash (High)', modelId: 'gemini-3.6-flash-high' },
  { label: 'Gemini 3.1 Pro (Low)', modelId: 'gemini-3.1-pro-low' },
  { label: 'Claude Sonnet 4.6 (Thinking)', modelId: 'claude-sonnet-4-6' },
  { label: 'Claude Opus 4.6 (Thinking)', modelId: 'claude-opus-4-6' },
  { label: 'GPT-OSS 120B (Medium)', modelId: 'gpt-oss-120b' },
];

/** Models the gateway actually serves, so the per-account list is not a hand-maintained copy. */
async function listGatewayQuotaModels(): Promise<Array<{ label: string; modelId: string }>> {
  try {
    const res = await fetch(`${PROXY_URL}/v1/models`, { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      const j: any = await res.json();
      const ids: string[] = (j.data ?? []).map((m: any) => m?.id).filter((id: any) => typeof id === 'string');
      if (ids.length) return ids.map((id) => ({ label: id, modelId: id }));
    }
  } catch {
    /* fall back below */
  }
  return FALLBACK_QUOTA_MODELS;
}

app.get('/api/quota', async (c) => {
  const selectedEmail = c.req.query('email') || '';
  const selectedAuthIndex = c.req.query('auth_index') || '';

  // 1. Get all configured accounts from CLIProxyAPI
  let accounts: any[] = [];
  try {
    accounts = await getAuthFiles();
  } catch {
    // fallback
  }

  // 2. Live data from every running Antigravity language server (one per signed-in account)
  const live = await fetchLiveSnapshots();
  const liveByEmail = new Map(live.map((l) => [l.email, l]));

  // 3. Match active account: the one asked for, else the first signed in to an IDE, else the first configured
  const activeAccount =
    accounts.find((a) => (selectedEmail && a.email === selectedEmail) || (selectedAuthIndex && a.auth_index === selectedAuthIndex)) ||
    accounts.find((a) => liveByEmail.has(a.email)) ||
    accounts[0];

  const targetEmail = activeAccount?.email || live[0]?.email || '未知账号';
  const liveSnap = liveByEmail.get(targetEmail);

  const accountsView = accounts.map((a) => ({
    email: a.email,
    auth_index: a.auth_index,
    status: a.status,
    disabled: a.disabled,
    isCurrentIde: liveByEmail.has(a.email),
    cooldowns: a.cooldowns || [],
  }));

  // Cooldowns from CLIProxyAPI (real 429 quota exhaustion signals!)
  const now = Date.now();
  const cooldowns: any[] = activeAccount?.cooldowns || [];
  const hasCooldown = cooldowns.length > 0;
  const maxCooldownSec = hasCooldown ? Math.max(...cooldowns.map((cd: any) => cd.remaining_seconds || 0), 0) : 0;
  const cooldownMs = maxCooldownSec * 1000;
  const cooldownZh = formatCountdownZh(cooldownMs);
  const cooldownEn = formatCountdownEn(cooldownMs);
  const cooldownEndsAt = hasCooldown ? new Date(now + cooldownMs).toISOString() : null;
  const cooldownFields = { cooldowns, cooldownZh, cooldownEn, cooldownEndsAt };
  const cooldownKeys = new Set<string>(cooldowns.map((cd: any) => cd.model_key).filter(Boolean));
  // CLIProxyAPI cools Gemini per account, so any cooldown covers every Gemini model.
  const modelCooling = (modelId: string) =>
    hasCooldown && (cooldownKeys.size === 0 || cooldownKeys.has(modelId) || quotaGroupOf(modelId) === 'gemini');
  // The IDE reports opaque model ids (MODEL_PLACEHOLDER_*) that never match a cooldown's model_key, so go by pool.
  const groupCooling = (g: 'gemini' | 'claude_gpt') =>
    hasCooldown && (cooldownKeys.size === 0 || g === 'gemini' || [...cooldownKeys].some((k) => quotaGroupOf(k) === g));

  // 4. Live data from the IDE signed in as the target account
  if (liveSnap) {
    const localData = liveSnap.status;
    const localQuotaSummary = liveSnap.quotaSummary;
    const userStatus = localData?.userStatus ?? {};
    const userTier = userStatus.userTier ?? {};
    const planStatus = userStatus.planStatus ?? {};
    const modelConfigs = userStatus.cascadeModelConfigData?.clientModelConfigs ?? [];

    const parsedModels = modelConfigs
      .filter((m: any) => m.quotaInfo)
      .map((m: any) => {
        const q = m.quotaInfo;
        const rem = q.remainingFraction;
        const resetMs = q.resetTime ? Math.max(0, new Date(q.resetTime).getTime() - now) : 0;
        const label = m.label ?? '未知模型';

        return {
          label,
          modelId: m.modelOrAlias?.model ?? '',
          group: quotaGroupOf(label),
          remainingFraction: rem,
          remainingPercentage: fractionToPct(rem) ?? 0,
          resetTime: q.resetTime,
          timeRemainingZh: formatCountdownZh(resetMs),
          timeRemainingEn: formatCountdownEn(resetMs),
          isExhausted: rem === undefined || rem <= 0,
        };
      });
    const firstModel = (g: 'gemini' | 'claude_gpt') => parsedModels.find((m: any) => m.group === g);

    // Parse authoritative groups from RetrieveUserQuotaSummary
    const summaryGroups = localQuotaSummary?.response?.groups || [];
    const geminiGroup = summaryGroups.find((g: any) => g.displayName?.toLowerCase().includes('gemini'));
    const claudeGroup = summaryGroups.find(
      (g: any) => g.displayName?.toLowerCase().includes('claude') || g.displayName?.toLowerCase().includes('gpt'),
    );
    const bucket = (g: any, id: string, window: string) =>
      g?.buckets?.find((b: any) => b.bucketId === id || b.window === window);

    // A window the IDE did not report stays `null` (unknown); it is never defaulted to 100%.
    const fiveHour = (b: any, g: 'gemini' | 'claude_gpt') =>
      b?.remainingFraction !== undefined
        ? { fraction: b.remainingFraction, resetAt: b.resetTime }
        : { fraction: firstModel(g)?.remainingFraction, resetAt: b?.resetTime ?? firstModel(g)?.resetTime };
    const weekly = (b: any) => ({ fraction: b?.remainingFraction, resetAt: b?.resetTime });

    const geminiWeeklyBucket = bucket(geminiGroup, 'gemini-weekly', 'weekly');
    const gemini5hBucket = bucket(geminiGroup, 'gemini-5h', '5h');
    const claudeWeeklyBucket = bucket(claudeGroup, '3p-weekly', 'weekly');
    const claude5hBucket = bucket(claudeGroup, '3p-5h', '5h');

    const availableCredits = planStatus.availablePromptCredits;
    const monthlyCredits = planStatus.planInfo?.monthlyPromptCredits;

    const result = {
      online: true,
      source: 'local_ide',
      accountState: 'active',
      selectedAccount: targetEmail,
      accounts: accountsView,
      plan: userTier.name ?? null,
      planDescription: userTier.upgradeSubscriptionText ?? null,
      email: targetEmail,
      promptCredits:
        monthlyCredits > 0 && availableCredits !== undefined
          ? {
              available: availableCredits,
              monthly: monthlyCredits,
              remainingPercentage: Math.round((availableCredits / monthlyCredits) * 1000) / 10,
            }
          : null,
      summary: {
        gemini: buildQuotaGroup('Gemini Models', fiveHour(gemini5hBucket, 'gemini'), weekly(geminiWeeklyBucket), now),
        claude_gpt: buildQuotaGroup(
          'Claude and GPT models',
          fiveHour(claude5hBucket, 'claude_gpt'),
          weekly(claudeWeeklyBucket),
          now,
        ),
      },
      models: parsedModels,
    };

    // The cached copy is the IDE's own view only: a 429 cooldown is volatile gateway state, so it is
    // overlaid on the response below and never written to disk.
    void saveQuotaCache(result, targetEmail);

    if (!hasCooldown) return c.json(result);
    return c.json({
      ...result,
      accountState: 'cooldown',
      ...cooldownFields,
      models: result.models.map((m: any) =>
        groupCooling(m.group)
          ? {
              ...m,
              isExhausted: true,
              timeRemainingZh: `${cooldownZh} (429 冷却中)`,
              timeRemainingEn: `${cooldownEn} (429 cooldown)`,
            }
          : m,
      ),
    });
  }

  // 5. Account is not signed in to a local IDE, or is in a non-active state
  const isDisabled = Boolean(activeAccount?.disabled);
  const statusMsg = activeAccount?.status_message || '';
  const statusText = typeof statusMsg === 'string' ? statusMsg : JSON.stringify(statusMsg);
  const isNeedsVerify = activeAccount?.status === 'error' && statusText.includes('Verify your account');
  const isTokenExpired = activeAccount?.status === 'error' && statusText.toLowerCase().includes('token expired');
  const isOtherError = activeAccount?.status === 'error' && !isNeedsVerify && !isTokenExpired;

  let validationUrl = '';
  if (statusMsg) {
    try {
      const parsedMsg = typeof statusMsg === 'string' ? JSON.parse(statusMsg) : statusMsg;
      const details = parsedMsg?.error?.details ?? [];
      for (const d of details) {
        if (d.metadata?.validation_url) validationUrl = d.metadata.validation_url;
        const links = d.links ?? [];
        for (const l of links) {
          if (l.url && l.url.includes('google.com')) validationUrl = l.url;
        }
      }
    } catch {}
  }
  if (!validationUrl && isNeedsVerify) {
    validationUrl = 'https://developers.google.com/gemini-code-assist';
  }

  // Serve a cached snapshot only if it was recorded for THIS account and not in cooldown.
  // It is re-aged first: countdowns follow the clock, and windows that have since reset lose their stale %.
  if (!isDisabled && !isNeedsVerify && !isTokenExpired && !hasCooldown) {
    const cached = await loadQuotaCache(targetEmail);
    if (cached) {
      return c.json({
        ...freshenQuotaSnapshot(cached, now),
        isCached: true,
        online: true,
        source: 'cached_offline',
        selectedAccount: targetEmail,
        accounts: accountsView,
      });
    }
  }

  const isUnavailable = isDisabled || isNeedsVerify || isTokenExpired || isOtherError;

  const accountStatusLabel = isDisabled
    ? '已在反代路由中禁用'
    : isTokenExpired
    ? 'Token 已过期 (需重新登录)'
    : isNeedsVerify
    ? '需在 Google 完成账号验证'
    : isOtherError
    ? `异常: ${typeof statusMsg === 'string' ? statusMsg : '请检查账号凭证'}`
    : hasCooldown
    ? `429 配额用尽冷却中 (剩余 ${cooldownZh})`
    : '云端就绪待命 (网关动态路由)';

  // The plan tier of an account that is not signed into the local IDE is unknown; do not guess one.
  const accountPlanName = isDisabled
    ? 'Google AI (已禁用)'
    : isNeedsVerify
    ? 'Google AI (需要完成验证)'
    : isTokenExpired
    ? 'Google AI (Token 已过期)'
    : hasCooldown
    ? 'Google AI (429 冷却中)'
    : 'Google AI (套餐未知)';

  const accountPlanDesc = isDisabled
    ? '该账号当前已被手动设为禁用状态。如需恢复该账号的模型请求分流，请在「路由策略」页面开启。'
    : isTokenExpired
    ? '该账号 Google OAuth 凭据已失效，CLIProxyAPI 无法刷新 Access Token。请重新进行 OAuth 授权。'
    : isNeedsVerify
    ? '该 Google 账号尚未完成 Google Gemini Code Assist 首次安全验证，Google 暂时拦截了调用。'
    : hasCooldown
    ? `该账号上游已触发 Google 429 频率/配额限制，CLIProxyAPI 已自动将该账号置于熔断保护中，预计剩余冷却时间：${cooldownZh}。到期后将自动恢复请求分流。`
    : '该账号已授权接入反代池，但不是本机 Antigravity IDE 当前登录的账号，无法读取真实额度。在 IDE 中登录该账号并打开本页后，额度会被记录下来。';

  // Only states we actually know are reported as numbers (0 = unavailable now); a healthy account is `null` (unknown).
  const models = (await listGatewayQuotaModels()).map((m) => {
    const group = quotaGroupOf(m.modelId);
    const cooling = modelCooling(m.modelId);
    const isExhausted = isUnavailable || cooling;
    const timeZh = cooling
      ? `${cooldownZh} (429 冷却中)`
      : isDisabled
      ? '账号已在路由池中禁用'
      : isTokenExpired
      ? 'Token 已失效'
      : isNeedsVerify
      ? '需要在 Google 页面完成验证'
      : '额度未知';
    const timeEn = cooling
      ? `${cooldownEn} (429 cooldown)`
      : isDisabled
      ? 'Account disabled'
      : isTokenExpired
      ? 'Token expired'
      : isNeedsVerify
      ? 'Needs verification'
      : 'Quota unknown';

    return {
      label: m.label,
      modelId: m.modelId,
      group,
      remainingFraction: isExhausted ? 0 : null,
      remainingPercentage: isExhausted ? 0 : null,
      timeRemainingEn: timeEn,
      timeRemainingZh: timeZh,
      isExhausted,
      statusText: accountStatusLabel,
    };
  });

  const down = (g: 'gemini' | 'claude_gpt') => {
    const cooling = groupCooling(g);
    return { fraction: isUnavailable || cooling ? 0 : null, resetAt: cooling ? cooldownEndsAt : null };
  };
  const geminiWindow = down('gemini');
  const claudeWindow = down('claude_gpt');

  return c.json({
    online: !isUnavailable,
    source: hasCooldown ? 'gateway_cooldown' : 'remote_account',
    accountState: isDisabled ? 'disabled' : isNeedsVerify || isTokenExpired || isOtherError ? 'error' : hasCooldown ? 'cooldown' : 'active',
    selectedAccount: targetEmail,
    ...cooldownFields,
    accounts: accountsView,
    plan: accountPlanName,
    planDescription: accountPlanDesc,
    email: targetEmail,
    validationUrl,
    promptCredits: null,
    summary: {
      gemini: buildQuotaGroup('Gemini Models', geminiWindow, geminiWindow, now),
      claude_gpt: buildQuotaGroup('Claude and GPT models', claudeWindow, claudeWindow, now),
    },
    models,
  });
});

// ---- Usage timeline / cost endpoints (aggregation lives in usage-db.ts) ----
app.get('/api/usage/timeline', (c) => {
  return c.json(queryTimeline(db, c.req.query('period') || '14days'));
});

app.get('/api/usage/cost', (c) => {
  const rows: any[] = db
    .query(
      `SELECT model,
              COALESCE(MAX(grp), 'antigravity') AS grp,
              SUM(input_tokens) AS input_tokens,
              SUM(output_tokens) AS output_tokens,
              SUM(reasoning_tokens) AS reasoning_tokens,
              COUNT(*) AS calls
       FROM usage GROUP BY model`,
    )
    .all();
  const perModel = rows.map((r) => {
    // priceFor() already treats WorkBuddy (credit-based) as free, so it cannot inflate the cost charts.
    const p = priceFor(r.model, isProviderGroup(r.grp) ? r.grp : 'antigravity');
    const output = (r.output_tokens ?? 0) + (r.reasoning_tokens ?? 0);
    const cost = ((r.input_tokens ?? 0) * p.input + output * p.output) / 1e6;
    return { model: r.model, group: r.grp, calls: r.calls, input_tokens: r.input_tokens, output_tokens: r.output_tokens, reasoning_tokens: r.reasoning_tokens, unit_input: p.input, unit_output: p.output, cost };
  });
  const total = perModel.reduce((s, m) => s + m.cost, 0);
  return c.json({ total, per_model: perModel });
});
// ---- Health aggregate (with Antigravity & AgentRouter groups) ----
app.get('/api/health', async (c) => {
  const health: any = {
    ok: false,
    proxyReachable: false,
    authCount: 0,
    activeCount: 0,
    errorCount: 0,
    strategy: 'round-robin',
    models: 0,
    groups: {
      antigravity: {
        ok: false,
        reachable: false,
        port: 8317,
        authCount: 0,
        activeCount: 0,
        errorCount: 0,
        strategy: 'round-robin',
        models: 0,
      },
      agentrouter: {
        ok: false,
        reachable: false,
        port: 15721,
        hasApiKey: false,
        supportedModels: AGENTROUTER_MODELS,
        stats: null,
      },
      workbuddy: {
        ok: false,
        reachable: false,
        port: 7863,
        healthy: 0,
        cooling: 0,
        disabled: 0,
        total: 0,
        realmServable: null as null | Record<string, boolean>,
        realmTotals: null as any,
        models: 0,
      },
    },
  };

  try {
    const [authRes, stratRes, modelsRes, arStatsRes, wbStatusRes, wbHealthRes] = await Promise.allSettled([
      mgmt('/auth-files'),
      mgmt('/routing/strategy'),
      fetch(`${PROXY_URL}/v1/models`),
      fetch(`${AGENTROUTER_PROXY_URL}/stats`),
      wbFetch('/status'),
      wbFetch('/healthz'),
    ]);

    if (authRes.status === 'fulfilled' && authRes.value.ok) {
      health.proxyReachable = true;
      health.groups.antigravity.reachable = true;
      health.groups.antigravity.ok = true;
      const data: any = await authRes.value.json().catch(() => ({}));
      const files = data.files ?? [];
      health.authCount = files.length;
      health.activeCount = files.filter((f: any) => !f.disabled && f.status !== 'error').length;
      health.errorCount = files.filter((f: any) => f.status === 'error').length;
      health.groups.antigravity.authCount = health.authCount;
      health.groups.antigravity.activeCount = health.activeCount;
      health.groups.antigravity.errorCount = health.errorCount;
    }

    if (stratRes.status === 'fulfilled' && stratRes.value.ok) {
      const s: any = await stratRes.value.json().catch(() => ({}));
      health.strategy = s.strategy ?? health.strategy;
      health.groups.antigravity.strategy = health.strategy;
    }

    if (modelsRes.status === 'fulfilled' && modelsRes.value.ok) {
      const m: any = await modelsRes.value.json().catch(() => ({}));
      health.models = m.data?.length ?? 0;
      health.groups.antigravity.models = health.models;
    }

    if (arStatsRes.status === 'fulfilled' && arStatsRes.value.ok) {
      const arData: any = await arStatsRes.value.json().catch(() => ({}));
      health.groups.agentrouter.ok = true;
      health.groups.agentrouter.reachable = true;
      health.groups.agentrouter.hasApiKey = arData.hasApiKey ?? false;
      health.groups.agentrouter.stats = arData.stats;
      health.agentrouter = health.groups.agentrouter;
    }

    // WorkBuddy：/healthz 免鉴权给存活与 realm 可服务性，/status 给账号池明细
    const wbHealth: any =
      wbHealthRes.status === 'fulfilled' && wbHealthRes.value.ok
        ? await wbHealthRes.value.json().catch(() => null)
        : null;
    const wbStatus: any =
      wbStatusRes.status === 'fulfilled' && wbStatusRes.value.ok
        ? await wbStatusRes.value.json().catch(() => null)
        : null;

    if (wbHealth || wbStatus) {
      const wb = health.groups.workbuddy;
      wb.reachable = true;
      wb.healthy = wbHealth?.healthy ?? wbStatus?.healthy ?? 0;
      wb.total = wbHealth?.total ?? wbStatus?.total ?? 0;
      wb.cooling = wbStatus?.cooling ?? 0;
      wb.disabled = wbStatus?.disabled ?? 0;
      wb.realmServable = wbHealth?.realm_servable ?? null;
      wb.realmTotals = wbStatus?.realm_totals ?? null;
      // 有任一账号健康即视为该分组可用
      wb.ok = wb.healthy > 0;
      health.workbuddy = wb;
    }

    health.ok = health.groups.antigravity.ok || health.groups.agentrouter.ok || health.groups.workbuddy.ok;
  } catch (e) {
    health.error = String(e);
  }
  return c.json(health);
});

// ---- SSE: one server-side poller feeds every connected client (and idles when nobody is watching) ----
const authFilesFeed = new Broadcaster<any[]>(async () => getAuthFiles(), 5000);

app.get('/api/events', async (c) => {
  return streamSSE(c, async (stream) => {
    const off = authFilesFeed.subscribe((files) => {
      void stream.writeSSE({ data: JSON.stringify({ type: 'auth-files', files }), event: 'auth-files' }).catch(() => {});
    });
    stream.onAbort(off);
    while (!stream.aborted) {
      await stream.sleep(30_000);
      // Comment-only keep-alive so idle proxies/tunnels do not cut the connection.
      await stream.write(': ping\n\n').catch(() => {});
    }
    off();
  });
});

// ---- Record usage record endpoint (for AgentRouter & custom clients) ----
app.post('/api/usage/record', async (c) => {
  if (Number(c.req.header('content-length') ?? 0) > 16_384) return c.json({ error: 'payload too large' }, 413);
  const row = parseUsageRecord(await c.req.json().catch(() => null));
  if (!row) return c.json({ error: 'invalid payload' }, 400);
  try {
    // group: an explicit one from the client wins; otherwise insertUsageRows infers it from account, then model.
    insertUsageRows(db, [row]);
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ ok: false, error: String(e) }, 500);
  }
});

// Built web UI (bun run build). Registered last so every /api route above wins; absent in dev (Vite serves the UI).
const serveUi = createStaticHandler(new URL('../../web/dist', import.meta.url).pathname);
if (serveUi) app.get('*', serveUi);

console.log(`[antigravity-ui server] listening on http://${BIND_HOST}:${PORT}${remote.enabled ? ' (remote mode: token auth on)' : ''}`);
if (remote.enabled && !remote.allowedHosts.length) {
  console.warn('[antigravity-ui server] remote mode without ANTI_UI_ALLOWED_HOSTS: only loopback Host headers are accepted');
}
console.log(`[antigravity-ui server] proxying management API -> ${PROXY_URL}/v0/management`);

// start usage queue consumer
setInterval(consumeUsageQueue, 10_000);
consumeUsageQueue();

// Optional retention: ANTI_UI_USAGE_RETENTION_DAYS=N deletes usage rows older than N days (default: keep everything).
const RETENTION_DAYS = Number(process.env.ANTI_UI_USAGE_RETENTION_DAYS ?? 0);
if (RETENTION_DAYS > 0) {
  const prune = () => {
    const n = pruneUsage(db, RETENTION_DAYS);
    if (n) console.log(`[usage] pruned ${n} rows older than ${RETENTION_DAYS} days`);
  };
  prune();
  setInterval(prune, 6 * 3600_000);
}

export default {
  port: PORT,
  hostname: BIND_HOST,
  fetch: app.fetch,
};
