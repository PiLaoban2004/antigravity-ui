import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { createKey, ensureGatewaySchema } from './keys';
import { queryGatewayLogs, queryGatewayStats, requestsLast24h } from './stats';

const HOUR = 3_600_000;
const T0 = Math.floor(Date.UTC(2026, 9, 8, 0, 0, 0) / HOUR) * HOUR;

function seed() {
  const db = new Database(':memory:');
  ensureGatewaySchema(db);
  const { record } = createKey(db, { name: 'phone', note: '', expiresMs: null, models: null, rpm: null, concurrency: null, dailyLimit: null });
  const ins = db.query(
    `INSERT INTO gateway_log (ts_ms, key_id, ip, country, method, path, model, status, latency_ms, input_tokens, output_tokens, total_tokens, error)
     VALUES (?, ?, ?, ?, 'POST', '/v1/chat/completions', ?, ?, ?, ?, ?, ?, ?)`,
  );
  // ok x3 (latency 100/200/300), upstream 429, gateway-rejected rpm, bad key (no key id), stream error
  ins.run(T0 + 1000, record.id, '1.1.1.1', 'JP', 'm1', 200, 100, 1, 2, 3, null);
  ins.run(T0 + 2000, record.id, '1.1.1.1', 'JP', 'm1', 200, 200, 2, 3, 5, null);
  ins.run(T0 + HOUR + 1000, record.id, '2.2.2.2', 'US', 'm2', 200, 300, null, null, null, null);
  ins.run(T0 + HOUR + 2000, record.id, '2.2.2.2', 'US', 'm2', 429, 50, null, null, null, null);
  ins.run(T0 + HOUR + 3000, record.id, '2.2.2.2', 'US', 'm2', 429, 0, null, null, null, 'rpm');
  ins.run(T0 + HOUR + 4000, null, '9.9.9.9', null, null, 401, 0, null, null, null, 'bad_key');
  ins.run(T0 + 3 * HOUR, record.id, '1.1.1.1', 'JP', 'm1', 200, 70, null, null, null, 'upstream_stream_error');
  return { db, keyId: record.id };
}

describe('gateway stats', () => {
  test('separates ok / upstream errors / rejected / forwarded', () => {
    const { db } = seed();
    const s = queryGatewayStats(db, T0, T0 + 4 * HOUR);
    expect(s).toMatchObject({ total: 7, ok: 3, upstreamErrors: 2, rejected: 2, forwarded: 5 });
  });

  test('tokens are sums over rows that reported usage, with coverage', () => {
    const { db } = seed();
    const s = queryGatewayStats(db, T0, T0 + 4 * HOUR);
    expect(s).toMatchObject({ inputTokens: 3, outputTokens: 5, totalTokens: 8, tokenRows: 2 });
  });

  test('latency percentiles use successful forwarded calls only', () => {
    const { db } = seed();
    const s = queryGatewayStats(db, T0, T0 + 4 * HOUR);
    expect(s.latencyP50).toBe(200);
    expect(s.latencyP95).toBe(300);
    const empty = queryGatewayStats(db, T0 + 10 * HOUR, T0 + 11 * HOUR);
    expect(empty.latencyP50).toBeNull();
    expect(empty.total).toBe(0);
  });

  test('breakdowns: key / model / ip / country, and active keys excludes rejected-only', () => {
    const { db, keyId } = seed();
    const s = queryGatewayStats(db, T0, T0 + 4 * HOUR);
    expect(s.byKey[0]).toMatchObject({ keyId, requests: 6, rejected: 1, tokens: 8 });
    expect(s.byKey.find((k) => k.keyId === null)).toMatchObject({ requests: 1, rejected: 1 });
    expect(s.byModel.map((m) => m.model).sort()).toEqual(['m1', 'm2']);
    expect(s.byIp.find((i) => i.ip === '9.9.9.9')).toMatchObject({ requests: 1, rejected: 1 });
    expect([...s.byCountry].sort((a, b) => a.country.localeCompare(b.country))).toEqual([{ country: 'JP', requests: 3 }, { country: 'US', requests: 3 }]);
    expect(s.activeKeys).toBe(1);
  });

  test('timeline fills empty hours and counts non-2xx as errors', () => {
    const { db } = seed();
    const s = queryGatewayStats(db, T0, T0 + 4 * HOUR);
    expect(s.timeline.map((b) => b.t)).toEqual([T0, T0 + HOUR, T0 + 2 * HOUR, T0 + 3 * HOUR]);
    expect(s.timeline.map((b) => b.requests)).toEqual([2, 4, 0, 1]);
    expect(s.timeline[1].errors).toBe(3);
  });

  test('requestsLast24h counts forwarded requests per key', () => {
    const { db, keyId } = seed();
    expect(requestsLast24h(db, T0 + 5 * HOUR)[keyId]).toBe(4);
    expect(requestsLast24h(db, T0 + 30 * HOUR)[keyId]).toBeUndefined();
  });
});

describe('gateway log query', () => {
  test('newest first, with key name; outcome filters', () => {
    const { db, keyId } = seed();
    const all = queryGatewayLogs(db);
    expect(all).toHaveLength(7);
    expect(all[0].tsMs).toBe(T0 + 3 * HOUR);
    expect(all[0].keyName).toBe('phone');
    expect(all.find((r) => r.keyId === null)?.keyName).toBeNull();
    expect(queryGatewayLogs(db, { outcome: 'ok' })).toHaveLength(3);
    expect(queryGatewayLogs(db, { outcome: 'rejected' })).toHaveLength(2);
    expect(queryGatewayLogs(db, { outcome: 'error' })).toHaveLength(2);
    expect(queryGatewayLogs(db, { keyId })).toHaveLength(6);
    expect(queryGatewayLogs(db, { model: 'm2' })).toHaveLength(3);
  });

  test('paging with beforeId and a clamped limit', () => {
    const { db } = seed();
    const first = queryGatewayLogs(db, { limit: 3 });
    const next = queryGatewayLogs(db, { limit: 3, beforeId: first[2].id });
    expect(next[0].id).toBeLessThan(first[2].id);
    expect(queryGatewayLogs(db, { limit: 100000 }).length).toBe(7);
  });
});
