import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { Broadcaster, TtlCache, responseCache } from './shared-cache';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('TtlCache', () => {
  test('concurrent callers share one call, then the result is reused until the TTL passes', async () => {
    let t = 0;
    const c = new TtlCache(() => t);
    let calls = 0;
    const fn = async () => ++calls;
    const [a, b] = await Promise.all([c.get('k', 1000, fn), c.get('k', 1000, fn)]);
    expect([a, b, calls]).toEqual([1, 1, 1]);
    expect(await c.get('k', 1000, fn)).toBe(1);
    t = 1001;
    expect(await c.get('k', 1000, fn)).toBe(2);
  });

  test('failures are not remembered', async () => {
    const c = new TtlCache(() => 0);
    let n = 0;
    const flaky = async () => {
      if (++n === 1) throw new Error('boom');
      return 'ok';
    };
    await expect(c.get('k', 1000, flaky)).rejects.toThrow('boom');
    await sleep(0);
    expect(await c.get('k', 1000, flaky)).toBe('ok');
  });

  test('invalidate by prefix', async () => {
    const c = new TtlCache(() => 0);
    let n = 0;
    await c.get('a:1', 1000, async () => ++n);
    await c.get('b:1', 1000, async () => ++n);
    c.invalidate('a:');
    expect(await c.get('a:1', 1000, async () => ++n)).toBe(3);
    expect(await c.get('b:1', 1000, async () => ++n)).toBe(2);
  });
});

describe('Broadcaster', () => {
  test('one poller serves all subscribers and stops when the last leaves', async () => {
    let polls = 0;
    const b = new Broadcaster(async () => ++polls, 20);
    const got1: number[] = [];
    const got2: number[] = [];
    const off1 = b.subscribe((v) => got1.push(v));
    const off2 = b.subscribe((v) => got2.push(v));
    await sleep(70);
    expect(got1.length).toBeGreaterThanOrEqual(2);
    expect(got2).toEqual(got1);
    const pollsWithTwo = polls;
    off1();
    off2();
    expect(b.subscribers).toBe(0);
    await sleep(60);
    expect(polls).toBe(pollsWithTwo); // timer stopped
  });

  test('late subscriber gets the last value immediately; fresh start after idle gets none', async () => {
    const b = new Broadcaster(async () => 'v', 1000);
    const off = b.subscribe(() => {});
    await sleep(5);
    const late: string[] = [];
    const off2 = b.subscribe((v) => late.push(v));
    expect(late).toEqual(['v']);
    off();
    off2();
    const after: string[] = [];
    const off3 = b.subscribe((v) => after.push(v));
    expect(after).toEqual([]); // stale value dropped
    off3();
  });
});

describe('responseCache', () => {
  test('serves repeats and concurrent requests from one handler run; keys include the query', async () => {
    const cache = new TtlCache();
    const app = new Hono();
    let runs = 0;
    app.use('/q', responseCache(cache, 5000));
    app.get('/q', async (c) => {
      runs++;
      await sleep(10);
      return c.json({ n: runs, who: c.req.query('who') ?? null });
    });
    const rs = await Promise.all([app.request('/q'), app.request('/q'), app.request('/q')]);
    expect(runs).toBe(1);
    for (const r of rs) expect(((await r.json()) as any).n).toBe(1);
    expect(((await (await app.request('/q?who=b')).json()) as any).who).toBe('b');
    expect(runs).toBe(2);
    cache.invalidate('resp:');
    await app.request('/q');
    expect(runs).toBe(3);
  });

  test('errors are not cached', async () => {
    const app = new Hono();
    let runs = 0;
    app.use('/e', responseCache(new TtlCache(), 5000));
    app.get('/e', (c) => (++runs === 1 ? c.json({ error: 'x' }, 500) : c.json({ ok: true })));
    expect((await app.request('/e')).status).toBe(500);
    expect((await app.request('/e')).status).toBe(200);
  });
});
