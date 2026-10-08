import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { ensureGatewaySchema } from './keys';
import { GatewayLimiter } from './limiter';

const none = { rpm: null, concurrency: null, dailyLimit: null };
const setup = (globals = { rpm: 100, concurrency: 10 }) => {
  const db = new Database(':memory:');
  ensureGatewaySchema(db);
  let t = new Date(2026, 9, 8, 12, 0, 0).getTime();
  const lim = new GatewayLimiter(db, globals, () => t);
  return { db, lim, advance: (ms: number) => (t += ms), at: () => t };
};

describe('GatewayLimiter', () => {
  test('per-key rpm: blocks the (n+1)th and recovers after the window', () => {
    const { lim, advance } = setup();
    for (let i = 0; i < 3; i++) {
      const a = lim.tryAcquire('k', { ...none, rpm: 3 });
      expect(a.ok).toBe(true);
      if (a.ok) a.release();
    }
    const blocked = lim.tryAcquire('k', { ...none, rpm: 3 });
    expect(blocked).toMatchObject({ ok: false, reason: 'rpm' });
    advance(60_001);
    expect(lim.tryAcquire('k', { ...none, rpm: 3 }).ok).toBe(true);
  });

  test('keys are limited independently', () => {
    const { lim } = setup();
    expect(lim.tryAcquire('a', { ...none, rpm: 1 }).ok).toBe(true);
    expect(lim.tryAcquire('b', { ...none, rpm: 1 }).ok).toBe(true);
    expect(lim.tryAcquire('a', { ...none, rpm: 1 }).ok).toBe(false);
  });

  test('per-key concurrency frees on release (and release is idempotent)', () => {
    const { lim } = setup();
    const a = lim.tryAcquire('k', { ...none, concurrency: 1 });
    expect(a.ok).toBe(true);
    expect(lim.tryAcquire('k', { ...none, concurrency: 1 })).toMatchObject({ ok: false, reason: 'concurrency' });
    if (a.ok) {
      a.release();
      a.release();
    }
    expect(lim.inFlight()).toBe(0);
    expect(lim.tryAcquire('k', { ...none, concurrency: 1 }).ok).toBe(true);
  });

  test('global concurrency caps all keys together', () => {
    const { lim } = setup({ rpm: 100, concurrency: 2 });
    expect(lim.tryAcquire('a', none).ok).toBe(true);
    expect(lim.tryAcquire('b', none).ok).toBe(true);
    expect(lim.tryAcquire('c', none)).toMatchObject({ ok: false, reason: 'global_concurrency' });
  });

  test('global rpm caps all keys together', () => {
    const { lim } = setup({ rpm: 2, concurrency: 10 });
    for (const k of ['a', 'b']) {
      const r = lim.tryAcquire(k, none);
      if (r.ok) r.release();
    }
    expect(lim.tryAcquire('c', none)).toMatchObject({ ok: false, reason: 'global_rpm' });
  });

  test('daily cap counts forwarded requests, seeded from the log, and resets next day', () => {
    const { db, lim, advance, at } = setup();
    const ins = db.query("INSERT INTO gateway_log (ts_ms, key_id, ip, method, path, status, error) VALUES (?, 'k', 'ip', 'POST', '/v1/x', ?, ?)");
    ins.run(at() - 1000, 200, null); // counts
    ins.run(at() - 900, 429, 'rpm'); // rejected: does not count
    const opts = { ...none, dailyLimit: 2 };
    const a = lim.tryAcquire('k', opts); // 1 seeded + this = 2
    expect(a.ok).toBe(true);
    if (a.ok) a.release();
    expect(lim.tryAcquire('k', opts)).toMatchObject({ ok: false, reason: 'daily' });
    advance(13 * 3600_000); // past midnight
    expect(lim.tryAcquire('k', opts).ok).toBe(true);
  });
});
