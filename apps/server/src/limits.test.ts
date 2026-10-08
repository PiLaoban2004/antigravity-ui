import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { createCallGate } from './limits';

describe('call gate', () => {
  test('rejects past the per-window cap and recovers when the window slides', async () => {
    let t = 0;
    const app = new Hono();
    app.use('/x', createCallGate({ max: 2, windowMs: 1000, concurrency: 5 }, () => t));
    app.post('/x', (c) => c.text('ok'));
    expect((await app.request('/x', { method: 'POST' })).status).toBe(200);
    expect((await app.request('/x', { method: 'POST' })).status).toBe(200);
    const blocked = await app.request('/x', { method: 'POST' });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('retry-after')).toBe('1');
    t = 1001;
    expect((await app.request('/x', { method: 'POST' })).status).toBe(200);
  });

  test('caps concurrency', async () => {
    const app = new Hono();
    app.use('/x', createCallGate({ max: 100, windowMs: 1000, concurrency: 1 }));
    app.post('/x', async (c) => {
      await new Promise((r) => setTimeout(r, 20));
      return c.text('ok');
    });
    const [a, b] = await Promise.all([app.request('/x', { method: 'POST' }), app.request('/x', { method: 'POST' })]);
    expect([a.status, b.status].sort()).toEqual([200, 429]);
    expect((await app.request('/x', { method: 'POST' })).status).toBe(200);
  });
});
