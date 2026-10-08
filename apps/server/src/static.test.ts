import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { CSP, createStaticHandler } from './static';

const dir = mkdtempSync(join(tmpdir(), 'aui-static-'));
mkdirSync(join(dir, 'dist/assets'), { recursive: true });
writeFileSync(join(dir, 'dist/index.html'), '<html>app</html>');
writeFileSync(join(dir, 'dist/assets/app-abc.js'), 'console.log(1)');
writeFileSync(join(dir, 'secret.txt'), 'top secret');
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const handler = createStaticHandler(join(dir, 'dist'))!;
const app = new Hono();
app.get('*', handler);

describe('static handler', () => {
  test('is null when there is no build', () => {
    expect(createStaticHandler(join(dir, 'nope'))).toBeNull();
  });

  test('serves index.html with CSP and falls back for SPA routes', async () => {
    for (const path of ['/', '/accounts', '/usage/deep/link']) {
      const r = await app.request(path);
      expect(r.status).toBe(200);
      expect(await r.text()).toBe('<html>app</html>');
      expect(r.headers.get('content-security-policy')).toBe(CSP);
    }
  });

  test('serves fingerprinted assets as immutable', async () => {
    const r = await app.request('/assets/app-abc.js');
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toContain('immutable');
  });

  test('missing asset is a 404, not index.html', async () => {
    expect((await app.request('/assets/missing.js')).status).toBe(404);
  });

  test('cannot escape dist/', async () => {
    for (const path of ['/../secret.txt', '/%2e%2e/secret.txt', '/..%2fsecret.txt', '/assets/../../secret.txt']) {
      const r = await app.request(path);
      expect(await r.text()).not.toContain('top secret');
    }
  });

  test('unknown /api paths are JSON 404s', async () => {
    const r = await app.request('/api/nope');
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: 'not found' });
  });
});
