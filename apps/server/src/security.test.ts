import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { createLocalGuard, isDirectLocalRequest, isMgmtAllowed, redactSecrets } from './security';

function appWithGuard() {
  const app = new Hono();
  app.use('/api/*', createLocalGuard({ port: 4310, webOrigins: ['http://127.0.0.1:4321', 'http://localhost:4321'] }));
  app.all('/api/ping', (c) => c.text('pong'));
  return app;
}

const call = (headers: Record<string, string>, method = 'GET') =>
  appWithGuard().request('/api/ping', { method, headers });

describe('local guard', () => {
  test('allows our own host with no Origin (curl / smoke test)', async () => {
    expect((await call({ host: '127.0.0.1:4310' })).status).toBe(200);
  });

  test('allows the web UI origin', async () => {
    const r = await call({ host: 'localhost:4310', origin: 'http://127.0.0.1:4321' }, 'DELETE');
    expect(r.status).toBe(200);
  });

  test('rejects a rebinding host', async () => {
    expect((await call({ host: 'evil.example.com:4310' })).status).toBe(403);
    expect((await call({ host: 'evil.example.com' })).status).toBe(403);
  });

  test('rejects foreign and opaque origins', async () => {
    expect((await call({ host: '127.0.0.1:4310', origin: 'https://evil.example.com' }, 'POST')).status).toBe(403);
    expect((await call({ host: '127.0.0.1:4310', origin: 'null' }, 'POST')).status).toBe(403);
  });

  test('rejects cross-site fetch metadata', async () => {
    expect((await call({ host: '127.0.0.1:4310', 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect((await call({ host: '127.0.0.1:4310', 'sec-fetch-site': 'same-site' })).status).toBe(200);
  });
});

describe('isDirectLocalRequest', () => {
  const check = async (headers: Record<string, string>) => {
    const app = new Hono();
    app.get('/x', (c) => c.json({ direct: isDirectLocalRequest(c) }));
    return ((await app.request('/x', { headers })).json() as Promise<{ direct: boolean }>).then((j) => j.direct);
  };

  test('true for loopback hosts with no forwarding headers', async () => {
    expect(await check({ host: '127.0.0.1:4310' })).toBe(true);
    expect(await check({ host: 'localhost:4310' })).toBe(true);
    expect(await check({ host: '[::1]:4310' })).toBe(true);
  });

  test('false for a tunnel hostname or any forwarding header', async () => {
    expect(await check({ host: 'dash.example.com' })).toBe(false);
    expect(await check({ host: '127.0.0.1:4310', 'x-forwarded-for': '1.2.3.4' })).toBe(false);
    expect(await check({ host: '127.0.0.1:4310', 'cf-connecting-ip': '1.2.3.4' })).toBe(false);
    expect(await check({ host: '127.0.0.1:4310', 'tailscale-user-login': 'me@example.com' })).toBe(false);
  });
});

describe('mgmt allowlist', () => {
  test('allows what the UI uses', () => {
    expect(isMgmtAllowed('GET', '/auth-files')).toBe(true);
    expect(isMgmtAllowed('PATCH', '/auth-files/fields')).toBe(true);
    expect(isMgmtAllowed('DELETE', '/auth-files')).toBe(true);
    expect(isMgmtAllowed('POST', '/reset-quota')).toBe(true);
    expect(isMgmtAllowed('GET', '/auth-files/')).toBe(true);
  });

  test('blocks the arbitrary-request primitive and wrong methods', () => {
    expect(isMgmtAllowed('POST', '/api-call')).toBe(false);
    expect(isMgmtAllowed('GET', '/api-call')).toBe(false);
    expect(isMgmtAllowed('PUT', '/config')).toBe(false);
    expect(isMgmtAllowed('DELETE', '/config')).toBe(false);
    expect(isMgmtAllowed('GET', '/auth-files/download')).toBe(false);
  });

  test('is not fooled by traversal', () => {
    expect(isMgmtAllowed('GET', '/auth-files/../api-call')).toBe(false);
    expect(isMgmtAllowed('GET', '/auth-files%2F..%2Fapi-call')).toBe(false);
  });
});

describe('redactSecrets', () => {
  test('masks secret-looking keys at any depth, keeps the rest', () => {
    const out = redactSecrets({
      port: 8317,
      'api-keys': ['sk-1', 'sk-2'],
      'remote-management': { 'secret-key': 'hunter2', 'allow-remote': false },
      providers: [{ name: 'a', 'api-key': 'sk-3', token: '' }],
    });
    expect(out).toEqual({
      port: 8317,
      'api-keys': '***REDACTED***',
      'remote-management': { 'secret-key': '***REDACTED***', 'allow-remote': false },
      providers: [{ name: 'a', 'api-key': '***REDACTED***', token: '' }],
    });
  });
});
