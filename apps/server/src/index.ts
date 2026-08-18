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
