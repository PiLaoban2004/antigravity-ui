import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { createKey, ensureGatewaySchema, updateKey, type KeyInput } from './keys';
import { createGateway, matchGatewayRoute, presentedKey, upstreamHeaders } from './proxy';
import { queryGatewayLogs } from './stats';

const base: KeyInput = { name: 't', note: '', expiresMs: null, models: null, rpm: null, concurrency: null, dailyLimit: null };

function setup(upstream: (req: Request) => Response | Promise<Response> = () => Response.json({ usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 } }), opts: Partial<Parameters<typeof createGateway>[0]> = {}) {
  const db = new Database(':memory:');
  ensureGatewaySchema(db);
  const seen: Request[] = [];
  const gw = createGateway({
    db,
    upstream: 'http://upstream.test',
    peerIp: (c) => c.req.header('x-test-ip') ?? '1.1.1.1',
    fetchImpl: (async (input: any, init: any) => {
      const req = new Request(input, init);
      seen.push(req);
      return upstream(req);
    }) as any,
    ...opts,
  });
  const call = (path: string, init: RequestInit & { key?: string } = {}) => {
    const headers = new Headers(init.headers);
    if (init.key) headers.set('authorization', `Bearer ${init.key}`);
    return Promise.resolve(gw.app.fetch(new Request(`http://gw.test${path}`, { ...init, headers }))).then(async (res: Response) => {
      await res.clone().text(); // a real client reads the body; the gateway finalizes the log row when the stream ends
      return res;
    });
  };
  const rows = () => {
    gw.logs.flush();
    return queryGatewayLogs(db, { limit: 100 }).reverse();
  };
  return { db, gw, call, seen, rows };
}

const chat = (model = 'gemini-3-pro', extra: any = {}) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ model, messages: [{ role: 'user', content: 'hi' }], ...extra }),
});

describe('route allowlist', () => {
  test('forwards only model-call and list paths', () => {
    expect(matchGatewayRoute('POST', '/v1/chat/completions')).toBe('model-call');
    expect(matchGatewayRoute('POST', '/v1/messages')).toBe('model-call');
    expect(matchGatewayRoute('POST', '/v1beta/models/gemini-3-pro:streamGenerateContent')).toBe('model-call');
    expect(matchGatewayRoute('GET', '/v1/models')).toBe('list');
    for (const [m, p] of [
      ['GET', '/v0/management/auth-files'],
      ['POST', '/v0/management/api-call'],
      ['POST', '/api-call'],
      ['GET', '/v1/chat/completions'],
      ['POST', '/v1/models'],
      ['POST', '/v1/../v0/management/config'],
      ['POST', '/v1/chat/completions/'],
      ['POST', '/v1beta/models/x/../../v0:generateContent'],
      ['POST', '/v1beta/models/a%2Fb:generateContent'],
      ['DELETE', '/v1/chat/completions'],
    ] as const) {
      expect(matchGatewayRoute(m, p)).toBeNull();
    }
  });
});

describe('credential extraction and header hygiene', () => {
  test('bearer, x-api-key, x-goog-api-key, ?key=', () => {
    const u = new URL('http://x/v1/models');
    expect(presentedKey(new Headers({ authorization: 'Bearer sk-a' }), u)).toBe('sk-a');
    expect(presentedKey(new Headers({ 'x-api-key': 'sk-b' }), u)).toBe('sk-b');
    expect(presentedKey(new Headers({ 'x-goog-api-key': 'sk-c' }), u)).toBe('sk-c');
    expect(presentedKey(new Headers(), new URL('http://x/v1beta/models?key=sk-d'))).toBe('sk-d');
    expect(presentedKey(new Headers(), u)).toBe('');
  });

  test('credentials, cookies and edge headers never reach the upstream; app headers do', () => {
    const h = upstreamHeaders(
      new Headers({
        authorization: 'Bearer sk-secret',
        'x-api-key': 'sk-secret',
        cookie: 'a=b',
        'cf-connecting-ip': '9.9.9.9',
        'cf-ray': 'abc',
        'x-forwarded-for': '9.9.9.9',
        'user-agent': 'claude-cli/1.0',
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      }),
    );
    expect([...h.keys()].sort()).toEqual(['anthropic-version', 'content-type', 'user-agent']);
  });
});

describe('gateway', () => {
  test('healthz needs no key and leaks nothing', async () => {
    const { call } = setup();
    const r = await call('/healthz');
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
  });

  test('unmatched paths are 404 even with a valid key, and are not logged', async () => {
    const { db, call, rows } = setup();
    const { key } = createKey(db, base);
    expect((await call('/v0/management/config', { key })).status).toBe(404);
    expect((await call('/', { key })).status).toBe(404);
    expect(rows()).toHaveLength(0);
  });

  test('no key / wrong key -> identical 401; disabled and expired look the same', async () => {
    const { db, call, rows } = setup();
    const { key, record } = createKey(db, base);
    const bodies: string[] = [];
    for (const k of [undefined, 'sk-nope']) {
      const r = await call('/v1/models', { key: k });
      expect(r.status).toBe(401);
      bodies.push(await r.text());
    }
    updateKey(db, record.id, { enabled: false });
    const r = await call('/v1/models', { key });
    expect(r.status).toBe(401);
    bodies.push(await r.text());
    expect(new Set(bodies).size).toBe(1);
    expect(rows().map((x) => x.error)).toEqual(['no_key', 'bad_key', 'disabled']);
  });

  test('repeated bad keys from one IP get rate limited; another IP and a good key are unaffected', async () => {
    const { db, call } = setup();
    const { key } = createKey(db, base);
    for (let i = 0; i < 10; i++) expect((await call('/v1/models', { key: 'sk-bad', headers: { 'x-test-ip': '6.6.6.6' } })).status).toBe(401);
    const blocked = await call('/v1/models', { key, headers: { 'x-test-ip': '6.6.6.6' } });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('retry-after')).toBeTruthy();
    expect((await call('/v1/models', { key, headers: { 'x-test-ip': '7.7.7.7' } })).status).toBe(200);
  });

  test('forwards with the client key removed, logs the call with parsed tokens', async () => {
    const { db, call, seen, rows } = setup();
    const { key, record } = createKey(db, base);
    const r = await call('/v1/chat/completions?key=' + key + '&foo=1', { ...chat(), key, headers: { 'content-type': 'application/json', 'user-agent': 'my-sdk/2' } });
    expect(r.status).toBe(200);
    expect(((await r.json()) as any).usage.total_tokens).toBe(5);
    expect(seen).toHaveLength(1);
    const up = seen[0];
    expect(up.url).toBe('http://upstream.test/v1/chat/completions?foo=1');
    expect(up.headers.get('authorization')).toBeNull();
    expect(up.headers.get('user-agent')).toBe('my-sdk/2');
    expect(((await up.json()) as any).model).toBe('gemini-3-pro');
    const [row] = rows();
    expect(row).toMatchObject({ keyId: record.id, keyName: 't', model: 'gemini-3-pro', status: 200, error: null, inputTokens: 2, outputTokens: 3, totalTokens: 5, stream: false, method: 'POST' });
  });

  test('streaming passes through chunk by chunk and tokens are read from the stream tail', async () => {
    const sse = 'data: {"choices":[{"delta":{"content":"a"}}]}\n\ndata: {"usage":{"prompt_tokens":1,"completion_tokens":2,"total_tokens":3}}\n\ndata: [DONE]\n\n';
    const { db, call, rows } = setup(() => new Response(sse, { headers: { 'content-type': 'text/event-stream' } }));
    const { key } = createKey(db, base);
    const r = await call('/v1/chat/completions', { ...chat('m', { stream: true }), key });
    expect(await r.text()).toBe(sse);
    expect(rows()[0]).toMatchObject({ stream: true, totalTokens: 3, error: null, status: 200 });
  });

  test('a response with no usage logs NULL tokens, not 0', async () => {
    const { db, call, rows } = setup(() => Response.json({ data: [] }));
    const { key } = createKey(db, base);
    await call('/v1/models', { key });
    expect(rows()[0]).toMatchObject({ inputTokens: null, outputTokens: null, totalTokens: null });
  });

  test('upstream errors pass through with their status and count as forwarded, not rejected', async () => {
    const { db, call, rows } = setup(() => Response.json({ error: 'quota' }, { status: 429 }));
    const { key } = createKey(db, base);
    const r = await call('/v1/chat/completions', { ...chat(), key });
    expect(r.status).toBe(429);
    expect(rows()[0]).toMatchObject({ status: 429, error: null, totalTokens: null });
  });

  test('upstream down -> 502 and the slot is released', async () => {
    const { db, gw, call, rows } = setup(() => {
      throw new Error('ECONNREFUSED');
    });
    const { key } = createKey(db, base);
    const r = await call('/v1/chat/completions', { ...chat(), key });
    expect(r.status).toBe(502);
    expect(gw.limiter.inFlight()).toBe(0);
    expect(rows()[0]).toMatchObject({ status: 502, error: 'upstream_unavailable' });
  });

  test('model allowlist: blocked model never reaches the upstream', async () => {
    const { db, call, seen, rows } = setup();
    const { key } = createKey(db, { ...base, models: ['gemini-*'] });
    expect((await call('/v1/chat/completions', { ...chat('claude-opus'), key })).status).toBe(403);
    expect((await call('/v1/chat/completions', { method: 'POST', body: 'not json', key })).status).toBe(403);
    expect((await call('/v1/chat/completions', { ...chat('gemini-3-pro'), key })).status).toBe(200);
    expect(seen).toHaveLength(1);
    expect(rows().map((r) => r.error)).toEqual(['model_not_allowed', 'model_not_allowed', null]);
  });

  test('gemini-style path takes the model from the URL', async () => {
    const { db, call, rows } = setup();
    const { key } = createKey(db, { ...base, models: ['gemini-3-pro'] });
    const r = await call('/v1beta/models/gemini-3-pro:generateContent', { method: 'POST', body: '{}', key });
    expect(r.status).toBe(200);
    expect(rows()[0].model).toBe('gemini-3-pro');
    expect((await call('/v1beta/models/other:generateContent', { method: 'POST', body: '{}', key })).status).toBe(403);
  });

  test('per-key rpm returns 429 with Retry-After and does not reach the upstream', async () => {
    const { db, call, seen, rows } = setup();
    const { key } = createKey(db, { ...base, rpm: 2 });
    for (let i = 0; i < 2; i++) expect((await call('/v1/chat/completions', { ...chat(), key })).status).toBe(200);
    const r = await call('/v1/chat/completions', { ...chat(), key });
    expect(r.status).toBe(429);
    expect(Number(r.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(((await r.json()) as any).error.code).toBe('rpm');
    expect(seen).toHaveLength(2);
    expect(rows()[2]).toMatchObject({ status: 429, error: 'rpm' });
  });

  test('global concurrency: a second in-flight request is refused until the first ends', async () => {
    let finish!: () => void;
    const gate = new Promise<void>((r) => (finish = r));
    const { db, call, gw } = setup(async () => {
      await gate;
      return Response.json({});
    }, { globalConcurrency: 1 });
    const { key } = createKey(db, base);
    const first = call('/v1/chat/completions', { ...chat(), key });
    await new Promise((r) => setTimeout(r, 10));
    expect((await call('/v1/chat/completions', { ...chat(), key })).status).toBe(429);
    finish();
    expect((await first).status).toBe(200);
    await (await call('/v1/models', { key })).text();
    expect(gw.limiter.inFlight()).toBe(0);
  });

  test('client disconnect mid-stream releases the slot, cancels the upstream and logs client_abort', async () => {
    let cancelled = false;
    const upstream = new ReadableStream<Uint8Array>({
      pull(ctrl) {
        ctrl.enqueue(new TextEncoder().encode('data: {"x":1}\n\n'));
        return new Promise((r) => setTimeout(r, 5));
      },
      cancel() {
        cancelled = true;
      },
    });
    const { db, gw, rows } = setup(() => new Response(upstream, { headers: { 'content-type': 'text/event-stream' } }));
    const { key } = createKey(db, base);
    const res = await gw.app.fetch(new Request('http://gw.test/v1/chat/completions', { ...chat('m', { stream: true }), headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' } }));
    const reader = res.body!.getReader();
    await reader.read();
    expect(gw.limiter.inFlight()).toBe(1);
    await reader.cancel();
    expect(gw.limiter.inFlight()).toBe(0);
    expect(cancelled).toBe(true);
    expect(rows()[0]).toMatchObject({ error: 'client_abort', totalTokens: null });
  });

  test('oversized body -> 413 before anything is forwarded', async () => {
    const { db, call, seen } = setup(undefined, { maxBodyBytes: 100 });
    const { key } = createKey(db, base);
    const r = await call('/v1/chat/completions', { method: 'POST', body: 'x'.repeat(500), key });
    expect(r.status).toBe(413);
    expect(seen).toHaveLength(0);
  });

  test('trusted proxy: client IP and country come from Cloudflare headers; untrusted ignores them', async () => {
    const trusted = setup(undefined, { peerIp: undefined, trustedProxy: true });
    const k1 = createKey(trusted.db, base).key;
    await trusted.call('/v1/models', { key: k1, headers: { 'cf-connecting-ip': '8.8.4.4', 'cf-ipcountry': 'JP' } });
    expect(trusted.rows()[0]).toMatchObject({ ip: '8.8.4.4', country: 'JP' });

    const open = setup(undefined, { peerIp: undefined, trustedProxy: false });
    const k2 = createKey(open.db, base).key;
    await open.call('/v1/models', { key: k2, headers: { 'cf-connecting-ip': '8.8.4.4', 'cf-ipcountry': 'JP' } });
    expect(open.rows()[0].ip).not.toBe('8.8.4.4');
    expect(open.rows()[0].country).toBeNull();
  });

  test('a failing log write never breaks a request and is retried', async () => {
    const { db, call, gw } = setup();
    const { key } = createKey(db, base);
    db.run('ALTER TABLE gateway_log RENAME TO gateway_log_x');
    expect((await call('/v1/models', { key })).status).toBe(200);
    gw.logs.flush();
    expect(gw.logs.pending()).toBe(1);
    db.run('ALTER TABLE gateway_log_x RENAME TO gateway_log');
    gw.logs.flush();
    expect(gw.logs.pending()).toBe(0);
  });
});
