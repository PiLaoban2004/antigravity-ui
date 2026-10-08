import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { LoginLimiter, SessionStore, createAuth, loadRemoteConfig, safeEqual, type RemoteConfig } from './auth';
import { createLocalGuard } from './security';

const ADMIN = 'a'.repeat(24);
const VIEW = 'v'.repeat(24);
const RECORD = 'r'.repeat(24);

const env = (extra: Record<string, string> = {}) => ({
  ANTI_UI_REMOTE: '1',
  ANTI_UI_ADMIN_TOKEN: ADMIN,
  ANTI_UI_VIEW_TOKEN: VIEW,
  ANTI_UI_RECORD_KEY: RECORD,
  ANTI_UI_ALLOWED_HOSTS: 'Dash.Example.com',
  ...extra,
});

describe('loadRemoteConfig', () => {
  test('is disabled by default and ignores remote-only settings', () => {
    const c = loadRemoteConfig({ ANTI_UI_ALLOWED_HOSTS: 'x.com', ANTI_UI_ADMIN_TOKEN: 'short' });
    expect(c.enabled).toBe(false);
    expect(c.allowedHosts).toEqual([]);
  });

  test('refuses to start with a weak or missing admin token', () => {
    expect(() => loadRemoteConfig({ ANTI_UI_REMOTE: '1' })).toThrow(/ADMIN_TOKEN/);
    expect(() => loadRemoteConfig(env({ ANTI_UI_ADMIN_TOKEN: 'short' }))).toThrow(/ADMIN_TOKEN/);
  });

  test('rejects a view token that equals the admin token or is weak', () => {
    expect(() => loadRemoteConfig(env({ ANTI_UI_VIEW_TOKEN: ADMIN }))).toThrow(/differ/);
    expect(() => loadRemoteConfig(env({ ANTI_UI_VIEW_TOKEN: 'short' }))).toThrow(/VIEW_TOKEN/);
  });

  test('normalises hosts', () => {
    expect(loadRemoteConfig(env()).allowedHosts).toEqual(['dash.example.com']);
  });
});

describe('safeEqual', () => {
  test('matches equal strings only; empty never matches', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual('', '')).toBe(false);
  });
});

describe('LoginLimiter', () => {
  test('locks an IP after maxPerIp failures and releases after the window', () => {
    let t = 0;
    const l = new LoginLimiter({ maxPerIp: 3, maxGlobal: 100, windowMs: 1000 }, () => t);
    for (let i = 0; i < 3; i++) {
      expect(l.retryAfterMs('1.1.1.1')).toBe(0);
      l.fail('1.1.1.1');
      t += 10;
    }
    expect(l.retryAfterMs('1.1.1.1')).toBeGreaterThan(0);
    expect(l.retryAfterMs('2.2.2.2')).toBe(0);
    t += 1001;
    expect(l.retryAfterMs('1.1.1.1')).toBe(0);
  });

  test('global cap blocks everyone', () => {
    let t = 0;
    const l = new LoginLimiter({ maxPerIp: 100, maxGlobal: 3, windowMs: 1000 }, () => t);
    for (const ip of ['a', 'b', 'c']) l.fail(ip);
    expect(l.retryAfterMs('d')).toBeGreaterThan(0);
  });

  test('success clears that IP', () => {
    const l = new LoginLimiter({ maxPerIp: 2, maxGlobal: 100, windowMs: 1000 }, () => 0);
    l.fail('x');
    l.fail('x');
    l.success('x');
    expect(l.retryAfterMs('x')).toBe(0);
  });
});

describe('SessionStore', () => {
  test('expires and caps size', () => {
    let t = 0;
    const s = new SessionStore(1000, () => t, 2);
    const a = s.create('admin');
    expect(s.get(a)).toBe('admin');
    t = 1000;
    expect(s.get(a)).toBeNull();
    const ids = [s.create('viewer'), s.create('viewer'), s.create('admin')];
    expect(s.get(ids[0])).toBeNull(); // evicted
    expect(s.get(ids[2])).toBe('admin');
  });
});

function makeApp(config: RemoteConfig) {
  const auth = createAuth(config);
  const app = new Hono();
  // Tunnels present the public hostname and forward from loopback.
  app.use('/api/*', createLocalGuard({ port: 4310, webOrigins: ['https://dash.example.com'], allowedHosts: config.allowedHosts }));
  app.use('/api/*', auth.middleware);
  auth.registerRoutes(app);
  app.get('/api/read', (c) => c.text('data'));
  app.post('/api/write', (c) => c.text('done'));
  app.post('/api/usage/record', (c) => c.text('recorded'));
  return app;
}

const HOST = { host: 'dash.example.com' };
const login = (app: Hono, token: string) =>
  app.request('/api/session', { method: 'POST', headers: { ...HOST, 'content-type': 'application/json' }, body: JSON.stringify({ token }) });
const cookieOf = (r: Response) => r.headers.get('set-cookie')?.split(';')[0] ?? '';

describe('remote mode', () => {
  const config = loadRemoteConfig(env());

  test('guard still rejects unknown hosts, accepts the tunnel host', async () => {
    const app = makeApp(config);
    expect((await app.request('/api/read', { headers: { host: 'evil.example.com' } })).status).toBe(403);
    expect((await app.request('/api/read', { headers: HOST })).status).toBe(401);
  });

  test('requests without credentials are refused even though they look local', async () => {
    const app = makeApp(config);
    expect((await app.request('/api/read', { headers: { host: '127.0.0.1:4310' } })).status).toBe(401);
  });

  test('admin session can read and write; cookie is HttpOnly + Strict', async () => {
    const app = makeApp(config);
    const r = await login(app, ADMIN);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ remote: true, role: 'admin' });
    const setCookie = r.headers.get('set-cookie') ?? '';
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Strict/i);
    const h = { ...HOST, cookie: cookieOf(r) };
    expect((await app.request('/api/read', { headers: h })).status).toBe(200);
    expect((await app.request('/api/write', { method: 'POST', headers: h })).status).toBe(200);
  });

  test('viewer can read but not write', async () => {
    const app = makeApp(config);
    const h = { ...HOST, cookie: cookieOf(await login(app, VIEW)) };
    expect((await app.request('/api/read', { headers: h })).status).toBe(200);
    expect((await app.request('/api/write', { method: 'POST', headers: h })).status).toBe(403);
    const me: any = await (await app.request('/api/session', { headers: h })).json();
    expect(me.role).toBe('viewer');
  });

  test('bearer token works for scripts; wrong bearer is 401', async () => {
    const app = makeApp(config);
    const ok = await app.request('/api/write', { method: 'POST', headers: { ...HOST, authorization: `Bearer ${ADMIN}` } });
    expect(ok.status).toBe(200);
    const bad = await app.request('/api/read', { headers: { ...HOST, authorization: 'Bearer nope' } });
    expect(bad.status).toBe(401);
  });

  test('record key opens only /api/usage/record', async () => {
    const app = makeApp(config);
    const h = { ...HOST, 'x-record-key': RECORD };
    expect((await app.request('/api/usage/record', { method: 'POST', headers: h })).status).toBe(200);
    expect((await app.request('/api/write', { method: 'POST', headers: h })).status).toBe(401);
    expect((await app.request('/api/read', { headers: h })).status).toBe(401);
  });

  test('wrong token is rejected and repeated failures lock the client out', async () => {
    const app = makeApp(config);
    for (let i = 0; i < 5; i++) expect((await login(app, 'wrong-token')).status).toBe(401);
    const locked = await login(app, ADMIN);
    expect(locked.status).toBe(429);
    expect(locked.headers.get('retry-after')).toBeTruthy();
  });

  test('logout invalidates the session', async () => {
    const app = makeApp(config);
    const cookie = cookieOf(await login(app, ADMIN));
    const h = { ...HOST, cookie };
    await app.request('/api/session', { method: 'DELETE', headers: h });
    expect((await app.request('/api/read', { headers: h })).status).toBe(401);
  });

  test('session survives only with the session secret (forged cookie fails)', async () => {
    const app = makeApp(config);
    const r = await app.request('/api/read', { headers: { ...HOST, cookie: 'aui_sid=deadbeef' } });
    expect(r.status).toBe(401);
  });
});

describe('local mode (remote off)', () => {
  test('behaves as before: no credentials needed, reports admin', async () => {
    const app = makeApp(loadRemoteConfig({}));
    expect((await app.request('/api/write', { method: 'POST', headers: { host: '127.0.0.1:4310' } })).status).toBe(200);
    const me: any = await (await app.request('/api/session', { headers: { host: '127.0.0.1:4310' } })).json();
    expect(me).toEqual({ remote: false, role: 'admin' });
  });
});
