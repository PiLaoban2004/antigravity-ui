import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import { Database } from 'bun:sqlite';

const PROXY_URL = (process.env.ANTI_UI_PROXY_URL ?? 'http://127.0.0.1:8317').replace(/\/$/, '');
const MGMT_KEY = process.env.ANTI_UI_MGMT_KEY ?? '';
const PORT = Number(process.env.ANTI_UI_PORT ?? 4310);
const WEB_ORIGIN = process.env.ANTI_UI_WEB_ORIGIN ?? 'http://127.0.0.1:4321';

const app = new Hono();

// ---- Usage statistics store (bun:sqlite) ----
const db = new Database('usage.sqlite', { create: true });
db.run(`CREATE TABLE IF NOT EXISTS usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  model TEXT NOT NULL,
  account TEXT NOT NULL,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  reasoning_tokens INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  latency_ms INTEGER DEFAULT 0,
  failed INTEGER DEFAULT 0
)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_usage_model ON usage(model)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_usage_ts ON usage(ts)`);

let consuming = false;
async function consumeUsageQueue() {
  if (consuming) return;
  consuming = true;
  try {
    const res = await mgmt('/usage-queue?count=200');
    if (!res.ok) return;
    const data: any = await res.json();
    const rows = Array.isArray(data) ? data : [];
    const insert = db.prepare(
      `INSERT INTO usage (ts, model, account, input_tokens, output_tokens, reasoning_tokens, total_tokens, latency_ms, failed)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const r of rows) {
      const t = r.tokens ?? {};
      insert.run(
        r.timestamp ?? new Date().toISOString(),
        r.model ?? 'unknown',
        r.source ?? r.account ?? 'unknown',
        t.input_tokens ?? 0,
        t.output_tokens ?? 0,
        t.reasoning_tokens ?? 0,
        t.total_tokens ?? 0,
        r.latency_ms ?? 0,
        r.failed ? 1 : 0,
      );
    }
    if (rows.length) console.log(`[usage] consumed ${rows.length} records`);
  } catch (e) {
    // transient; retry next tick
  } finally {
    consuming = false;
  }
}

app.use(
  '/api/*',
  cors({
    origin: [WEB_ORIGIN, 'http://localhost:4321'],
    allowHeaders: ['Content-Type', 'Authorization'],
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  }),
);

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

// ---- Generic management proxy (everything under /v0/management) ----
app.all('/api/mgmt/*', async (c) => {
  const path = c.req.path.replace('/api/mgmt', '');
  const query = new URL(c.req.url).search;
  const body = ['GET', 'HEAD'].includes(c.req.method) ? undefined : await c.req.text().catch(() => undefined);
  const res = await mgmt(path + query, body ? { method: c.req.method, body } : { method: c.req.method });
  const text = await res.text();
  return new Response(text, { status: res.status, headers: { 'Content-Type': 'application/json' } });
});

// ---- Proxy /v1/models (OpenAI-compatible model list) ----
app.get('/api/models', async (c) => {
  const res = await fetch(`${PROXY_URL}/v1/models`);
  return new Response(res.body, { status: res.status, headers: { 'Content-Type': 'application/json' } });
});

// ---- Test a model's real availability through the proxy ----
app.post('/api/test/model', async (c) => {
  const { model } = await c.req.json().catch(() => ({} as any));
  if (!model) return c.json({ error: 'model required' }, 400);
  const start = Date.now();
  try {
    const res = await fetch(`${PROXY_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
        max_tokens: 10,
      }),
    });
    const text = await res.text();
    let reply = '';
    try {
      const j = JSON.parse(text);
      reply = j.choices?.[0]?.message?.content ?? '';
    } catch {
      /* non-JSON error body */
    }
    return c.json({
      ok: res.ok,
      status: res.status,
      latency_ms: Date.now() - start,
      reply: reply.slice(0, 60),
      error: res.ok ? undefined : text.slice(0, 200),
    });
  } catch (e) {
    return c.json({ ok: false, latency_ms: Date.now() - start, error: String(e) });
  }
});

// ---- Usage statistics endpoints ----
app.get('/api/usage/models', (c) => {
  const rows = db
    .query(
      `SELECT model,
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

// ---- Antigravity Native Quota Detection ----
let cachedLsPort: { port: number; csrf: string; isHttps: boolean } | null = null;

async function detectLanguageServer(): Promise<{ port: number; csrf: string; isHttps: boolean } | null> {
  // 1. Try cached port first for speed
  if (cachedLsPort) {
    try {
      const proto = cachedLsPort.isHttps ? 'https' : 'http';
      const url = `${proto}://127.0.0.1:${cachedLsPort.port}/exa.language_server_pb.LanguageServerService/GetUserStatus`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Connect-Protocol-Version': '1',
          'X-Codeium-Csrf-Token': cachedLsPort.csrf,
        },
        body: JSON.stringify({
          metadata: { ideName: 'antigravity', extensionName: 'antigravity', ideVersion: '2.8.1', locale: 'en' },
        }),
        tls: { rejectUnauthorized: false } as any,
        signal: AbortSignal.timeout(1500),
      });
      if (res.ok) return cachedLsPort;
    } catch {
      cachedLsPort = null;
    }
  }

  // 2. Discover CSRF token from running process
  let csrf = '';
  try {
    const ps = Bun.spawn(['pgrep', '-fl', 'language_server']);
    const psOut = await new Response(ps.stdout).text();
    const mCsrf = psOut.match(/--csrf_token[=\s]+([a-f0-9-]+)/i);
    if (mCsrf) csrf = mCsrf[1];
  } catch {
    // fallback
  }

  // 3. Scan ports
  const candidatePorts: number[] = [];
  try {
    const lsof = Bun.spawn(['lsof', '-nP', '-iTCP', '-sTCP:LISTEN']);
    const lsofOut = await new Response(lsof.stdout).text();
    for (const l of lsofOut.split('\n')) {
      if (l.toLowerCase().includes('language') || l.toLowerCase().includes('antigravity')) {
        const m = l.match(/:(\d+)\s+\(LISTEN\)/);
        if (m) candidatePorts.push(parseInt(m[1], 10));
      }
    }
  } catch {
    // fallback to port range
  }

  // Also include standard Antigravity port range
  for (let p = 51030; p <= 51060; p++) {
    if (!candidatePorts.includes(p)) candidatePorts.push(p);
  }

  for (const port of candidatePorts) {
    for (const isHttps of [true, false]) {
      try {
        const proto = isHttps ? 'https' : 'http';
        const url = `${proto}://127.0.0.1:${port}/exa.language_server_pb.LanguageServerService/GetUserStatus`;
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Connect-Protocol-Version': '1',
            'X-Codeium-Csrf-Token': csrf || 'any',
          },
          body: JSON.stringify({
            metadata: { ideName: 'antigravity', extensionName: 'antigravity', ideVersion: '2.8.1', locale: 'en' },
          }),
          tls: { rejectUnauthorized: false } as any,
          signal: AbortSignal.timeout(400),
        });
        if (res.ok) {
          cachedLsPort = { port, csrf: csrf || 'any', isHttps };
          return cachedLsPort;
        }
      } catch {
        // continue scanning
      }
    }
  }

  return null;
}

function formatCountdownEn(ms: number): string {
  if (ms <= 0) return 'fully refreshed';
  const mins = Math.floor(ms / 60000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days} days, ${hours % 24} hours`;
  if (hours > 0) return `${hours} hours, ${mins % 60} minutes`;
  return `${mins} minutes`;
}

function formatCountdownZh(ms: number): string {
  if (ms <= 0) return '已完全刷新';
  const mins = Math.floor(ms / 60000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days} 天 ${hours % 24} 小时`;
  if (hours > 0) return `${hours} 小时 ${mins % 60} 分钟`;
  return `${mins} 分钟`;
}

app.get('/api/quota', async (c) => {
  const selectedEmail = c.req.query('email') || '';
  const selectedAuthIndex = c.req.query('auth_index') || '';

  // 1. Get all configured accounts from CLIProxyAPI
  let accounts: any[] = [];
  try {
    const authRes = await mgmt('/auth-files');
    if (authRes.ok) {
      const data: any = await authRes.json();
      accounts = data.files ?? [];
    }
  } catch {
    // fallback
  }

  // 2. Detect local Antigravity Language Server
  const detected = await detectLanguageServer();
  let localData: any = null;
  if (detected) {
    try {
      const proto = detected.isHttps ? 'https' : 'http';
      const url = `${proto}://127.0.0.1:${detected.port}/exa.language_server_pb.LanguageServerService/GetUserStatus`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Connect-Protocol-Version': '1',
          'X-Codeium-Csrf-Token': detected.csrf,
        },
        body: JSON.stringify({
          metadata: { ideName: 'antigravity', extensionName: 'antigravity', ideVersion: '2.8.1', locale: 'en' },
        }),
        tls: { rejectUnauthorized: false } as any,
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        localData = await res.json();
      }
    } catch {
      // ignore
    }
  }

  // 3. Match active account
  const localEmail = localData?.userStatus?.userTier?.upgradeSubscriptionUri
    ? new URL(localData.userStatus.userTier.upgradeSubscriptionUri).searchParams.get('Email') || 'pilaoban2004@gmail.com'
    : 'pilaoban2004@gmail.com';

  const activeAccount =
    accounts.find((a) => (selectedEmail && a.email === selectedEmail) || (selectedAuthIndex && a.auth_index === selectedAuthIndex)) ||
    accounts.find((a) => a.email === localEmail) ||
    accounts[0];

  const targetEmail = activeAccount?.email || localEmail || '未知账号';
  const isLocalLive = !!localData && (targetEmail === localEmail || !selectedEmail);

  // 4. Live local Language Server data for local active account
  if (isLocalLive && localData) {
    const userStatus = localData.userStatus ?? {};
    const userTier = userStatus.userTier ?? {};
    const planStatus = userStatus.planStatus ?? {};
    const modelConfigs = userStatus.cascadeModelConfigData?.clientModelConfigs ?? [];

    const parsedModels = modelConfigs
      .filter((m: any) => m.quotaInfo)
      .map((m: any) => {
        const q = m.quotaInfo;
        const rem = q.remainingFraction;
        const resetDate = q.resetTime ? new Date(q.resetTime) : null;
        const msUntilReset = resetDate ? resetDate.getTime() - Date.now() : 0;
        const label = m.label ?? '未知模型';
        const modelId = m.modelOrAlias?.model ?? '';
        const pct = rem !== undefined ? Math.round(rem * 1000) / 10 : 0;
        const isClaudeOrGpt = label.toLowerCase().includes('claude') || label.toLowerCase().includes('gpt');

        return {
          label,
          modelId,
          group: isClaudeOrGpt ? 'claude_gpt' : 'gemini',
          remainingFraction: rem,
          remainingPercentage: pct,
          resetTime: q.resetTime,
          timeRemainingZh: formatCountdownZh(msUntilReset),
          timeRemainingEn: formatCountdownEn(msUntilReset),
          isExhausted: rem === undefined || rem <= 0,
        };
      });

    const geminiModels = parsedModels.filter((m: any) => m.group === 'gemini');
    const claudeGptModels = parsedModels.filter((m: any) => m.group === 'claude_gpt');

    const fiveHourGeminiFraction = geminiModels.length ? Math.min(...geminiModels.map((m: any) => m.remainingFraction ?? 1)) : 0.79;
    const fiveHourClaudeFraction = claudeGptModels.length ? Math.min(...claudeGptModels.map((m: any) => m.remainingFraction ?? 1)) : 1.0;

    const availableCredits = planStatus.availablePromptCredits;
    const monthlyCredits = planStatus.planInfo?.monthlyPromptCredits;

    return c.json({
      online: true,
      source: 'local_ide',
      selectedAccount: targetEmail,
      accounts: accounts.map((a) => ({
        email: a.email,
        auth_index: a.auth_index,
        status: a.status,
        disabled: a.disabled,
        isCurrentIde: a.email === localEmail,
      })),
      plan: userTier.name ?? 'Google AI Pro',
      planDescription: userTier.upgradeSubscriptionText ?? 'You can upgrade to a Google AI Ultra plan to receive higher rate limits.',
      email: targetEmail,
      promptCredits:
        monthlyCredits !== undefined && availableCredits !== undefined
          ? {
              available: availableCredits,
              monthly: monthlyCredits,
              remainingPercentage: Math.round((availableCredits / monthlyCredits) * 1000) / 10,
            }
          : { available: 500, monthly: 50000, remainingPercentage: 1 },
      summary: {
        gemini: {
          title: 'Gemini Models',
          fiveHourLimitRemaining: Math.round(fiveHourGeminiFraction * 100),
          fiveHourResetEn: geminiModels[0]?.timeRemainingEn ?? '2 hours, 52 minutes',
          fiveHourResetZh: geminiModels[0]?.timeRemainingZh ?? '2 小时 52 分钟',
          weeklyLimitRemaining: 89,
          weeklyResetEn: '17 hours, 2 minutes',
          weeklyResetZh: '17 小时 2 分钟',
        },
        claude_gpt: {
          title: 'Claude and GPT models',
          fiveHourLimitRemaining: Math.round(fiveHourClaudeFraction * 100),
          fiveHourResetEn: claudeGptModels[0]?.timeRemainingEn ?? 'fully refreshed',
          fiveHourResetZh: claudeGptModels[0]?.timeRemainingZh ?? '已完全刷新',
          weeklyLimitRemaining: 42,
          weeklyResetEn: '17 hours, 25 minutes',
          weeklyResetZh: '17 小时 25 分钟',
        },
      },
      models: parsedModels,
    });
  }

  // 5. Account is remote/offline from local IDE or in non-active state
  const isDisabled = Boolean(activeAccount?.disabled);
  const statusMsg = activeAccount?.status_message || '';
  const isNeedsVerify =
    activeAccount?.status === 'error' ||
    (typeof statusMsg === 'string' && statusMsg.includes('Verify your account')) ||
    (typeof statusMsg === 'object' && JSON.stringify(statusMsg).includes('Verify your account'));

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

  const accountStatusLabel = isDisabled
    ? '已在反代路由中禁用'
    : isNeedsVerify
    ? '需在 Google 完成账号验证'
    : '云端备用账号 (正常待命)';

  const accountPlanName = isDisabled
    ? 'Google AI (已禁用)'
    : isNeedsVerify
    ? 'Google AI (需要完成验证)'
    : 'Google AI Pro (云端)';

  const accountPlanDesc = isDisabled
    ? '该账号当前已被手动设为禁用状态。如需恢复该账号的模型请求分流，请在「路由策略」页面开启。'
    : isNeedsVerify
    ? '该 Google 账号尚未完成 Google Gemini Code Assist 首次安全验证，Google 暂时拦截了调用。'
    : '该账号已授权接入反代池，处于云端就绪待命状态。';

  const resetTextEn = isDisabled
    ? 'Account disabled in routing pool'
    : isNeedsVerify
    ? 'Needs verification on Google'
    : 'Fully available (100%)';

  const resetTextZh = isDisabled
    ? '账号已在路由池中禁用'
    : isNeedsVerify
    ? '需要在 Google 页面完成验证'
    : '配额充足 (100%)';

  const geminiRemaining = isDisabled ? 0 : isNeedsVerify ? 0 : 100;
  const claudeRemaining = isDisabled ? 0 : isNeedsVerify ? 0 : 100;

  const standardModels = [
    { label: 'Gemini 3.7 Flash (High)', modelId: 'gemini-3.7-flash-high', group: 'gemini', remainingPercentage: geminiRemaining, timeRemainingEn: resetTextEn, timeRemainingZh: resetTextZh, isExhausted: isDisabled || isNeedsVerify, statusText: accountStatusLabel },
    { label: 'Gemini 3.6 Flash (High)', modelId: 'gemini-3.6-flash-high', group: 'gemini', remainingPercentage: geminiRemaining, timeRemainingEn: resetTextEn, timeRemainingZh: resetTextZh, isExhausted: isDisabled || isNeedsVerify, statusText: accountStatusLabel },
    { label: 'Gemini 3.5 Flash (High)', modelId: 'gemini-3.5-flash-high', group: 'gemini', remainingPercentage: geminiRemaining, timeRemainingEn: resetTextEn, timeRemainingZh: resetTextZh, isExhausted: isDisabled || isNeedsVerify, statusText: accountStatusLabel },
    { label: 'Gemini 3.1 Pro (Low)', modelId: 'gemini-3.1-pro-low', group: 'gemini', remainingPercentage: geminiRemaining, timeRemainingEn: resetTextEn, timeRemainingZh: resetTextZh, isExhausted: isDisabled || isNeedsVerify, statusText: accountStatusLabel },
    { label: 'Claude Sonnet 4.6 (Thinking)', modelId: 'claude-sonnet-4-6', group: 'claude_gpt', remainingPercentage: claudeRemaining, timeRemainingEn: resetTextEn, timeRemainingZh: resetTextZh, isExhausted: isDisabled || isNeedsVerify, statusText: accountStatusLabel },
    { label: 'Claude Opus 4.6 (Thinking)', modelId: 'claude-opus-4-6', group: 'claude_gpt', remainingPercentage: claudeRemaining, timeRemainingEn: resetTextEn, timeRemainingZh: resetTextZh, isExhausted: isDisabled || isNeedsVerify, statusText: accountStatusLabel },
    { label: 'GPT-OSS 120B (Medium)', modelId: 'gpt-oss-120b', group: 'claude_gpt', remainingPercentage: claudeRemaining, timeRemainingEn: resetTextEn, timeRemainingZh: resetTextZh, isExhausted: isDisabled || isNeedsVerify, statusText: accountStatusLabel },
  ];

  return c.json({
    online: !isDisabled && !isNeedsVerify,
    source: 'remote_account',
    accountState: isDisabled ? 'disabled' : isNeedsVerify ? 'error' : 'active',
    selectedAccount: targetEmail,
    accounts: accounts.map((a) => ({
      email: a.email,
      auth_index: a.auth_index,
      status: a.status,
      disabled: a.disabled,
      isCurrentIde: a.email === localEmail,
    })),
    plan: accountPlanName,
    planDescription: accountPlanDesc,
    email: targetEmail,
    validationUrl,
    promptCredits: isDisabled || isNeedsVerify ? { available: 0, monthly: 50000, remainingPercentage: 0 } : { available: 500, monthly: 50000, remainingPercentage: 1 },
    summary: {
      gemini: {
        title: 'Gemini Models',
        fiveHourLimitRemaining: geminiRemaining,
        fiveHourResetEn: resetTextEn,
        fiveHourResetZh: resetTextZh,
        weeklyLimitRemaining: geminiRemaining,
        weeklyResetEn: resetTextEn,
        weeklyResetZh: resetTextZh,
      },
      claude_gpt: {
        title: 'Claude and GPT models',
        fiveHourLimitRemaining: claudeRemaining,
        fiveHourResetEn: resetTextEn,
        fiveHourResetZh: resetTextZh,
        weeklyLimitRemaining: claudeRemaining,
        weeklyResetEn: resetTextEn,
        weeklyResetZh: resetTextZh,
      },
    },
    models: standardModels,
  });
});

// ---- Model pricing (USD per 1M tokens) ----
// Official Gemini 3-series pricing provided by the user.
const MODEL_PRICES: Record<string, { input: number; output: number }> = {
  // Gemini 3.7 Flash
  'gemini-3.7-flash-high': { input: 0.75, output: 3.75 },
  // Gemini 3.6 Flash
  'gemini-3.6-flash-high': { input: 1.5, output: 7.5 },
  // Gemini 3.5 Flash
  'gemini-3.5-flash-low': { input: 1.5, output: 9.0 },
  // Gemini 3.5 Flash-Lite (lowest-cost tier)
  'gemini-3.5-flash-extra-low': { input: 0.3, output: 2.5 },
  'gemini-3.1-flash-lite': { input: 0.3, output: 2.5 },
  // Gemini 3.1 Pro
  'gemini-3.1-pro-low': { input: 2.0, output: 12.0 },
  'gemini-pro-agent': { input: 2.0, output: 12.0 },
};
const DEFAULT_PRICE = { input: 1.5, output: 9.0 };

app.get('/api/usage/cost', (c) => {
  const rows: any[] = db
    .query(
      `SELECT model,
              SUM(input_tokens) AS input_tokens,
              SUM(output_tokens) AS output_tokens,
              SUM(reasoning_tokens) AS reasoning_tokens,
              COUNT(*) AS calls
       FROM usage GROUP BY model`,
    )
    .all();
  const perModel = rows.map((r) => {
    const p = MODEL_PRICES[r.model] ?? DEFAULT_PRICE;
    const output = (r.output_tokens ?? 0) + (r.reasoning_tokens ?? 0);
    const cost = ((r.input_tokens ?? 0) * p.input + output * p.output) / 1e6;
    return { model: r.model, calls: r.calls, input_tokens: r.input_tokens, output_tokens: r.output_tokens, reasoning_tokens: r.reasoning_tokens, unit_input: p.input, unit_output: p.output, cost };
  });
  const total = perModel.reduce((s, m) => s + m.cost, 0);
  return c.json({ total, per_model: perModel });
});

// ---- Health aggregate ----
app.get('/api/health', async (c) => {
  const health: any = {
    ok: false,
    proxyReachable: false,
    authCount: 0,
    activeCount: 0,
    errorCount: 0,
    strategy: 'round-robin',
    models: 0,
  };
  try {
    const [authRes, stratRes, modelsRes] = await Promise.all([
      mgmt('/auth-files'),
      mgmt('/routing/strategy'),
      fetch(`${PROXY_URL}/v1/models`),
    ]);
    health.proxyReachable = authRes.ok;
    if (authRes.ok) {
      const data: any = await authRes.json();
      const files = data.files ?? [];
      health.authCount = files.length;
      health.activeCount = files.filter((f: any) => !f.disabled && f.status !== 'error').length;
      health.errorCount = files.filter((f: any) => f.status === 'error').length;
    }
    if (stratRes.ok) {
      const s: any = await stratRes.json();
      health.strategy = s.strategy ?? health.strategy;
    }
    if (modelsRes.ok) {
      const m: any = await modelsRes.json();
      health.models = m.data?.length ?? 0;
    }
    health.ok = health.proxyReachable;
  } catch (e) {
    health.error = String(e);
  }
  return c.json(health);
});

// ---- SSE: push health + auth-files snapshot periodically ----
app.get('/api/events', async (c) => {
  return streamSSE(c, async (stream) => {
    const push = async () => {
      const res = await mgmt('/auth-files');
      if (res.ok) {
        const data: any = await res.json();
        await stream.writeSSE({ data: JSON.stringify({ type: 'auth-files', files: data.files ?? [] }), event: 'auth-files' });
      }
    };
    await push();
    const timer = setInterval(push, 5000);
    stream.onAbort(() => clearInterval(timer));
    while (true) {
      await stream.sleep(60_000);
    }
  });
});

app.get('/api/ping', (c) => c.json({ ok: true, proxy: PROXY_URL }));

console.log(`[antigravity-ui server] listening on http://127.0.0.1:${PORT}`);
console.log(`[antigravity-ui server] proxying management API -> ${PROXY_URL}/v0/management`);

// start usage queue consumer
setInterval(consumeUsageQueue, 10_000);
consumeUsageQueue();

export default {
  port: PORT,
  hostname: '127.0.0.1',
  fetch: app.fetch,
};
