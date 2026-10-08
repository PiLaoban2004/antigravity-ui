import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { ensureSchema, insertUsageRows, parseUsageRecord, pruneUsage, queryTimeline, type UsageInput } from './usage-db';

const NOW = new Date(2026, 9, 8, 15, 30); // local time, so the test is TZ-independent
const at = (y: number, mo: number, d: number, h = 12) => new Date(y, mo, d, h).toISOString();

const row = (over: Partial<UsageInput>): UsageInput => ({
  ts: at(2026, 9, 8),
  model: 'gemini-3.7-flash-high',
  account: 'a@gmail.com',
  input_tokens: 1_000_000,
  output_tokens: 0,
  reasoning_tokens: 0,
  total_tokens: 1_000_000,
  latency_ms: 100,
  failed: false,
  ...over,
});

const fresh = () => {
  const db = new Database(':memory:');
  ensureSchema(db);
  return db;
};

describe('migration', () => {
  test('adds ts_ms / grp to a legacy table and backfills from account + model', () => {
    const db = new Database(':memory:');
    db.run(`CREATE TABLE usage (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, model TEXT NOT NULL, account TEXT NOT NULL,
      input_tokens INTEGER DEFAULT 0, output_tokens INTEGER DEFAULT 0, reasoning_tokens INTEGER DEFAULT 0,
      total_tokens INTEGER DEFAULT 0, latency_ms INTEGER DEFAULT 0, failed INTEGER DEFAULT 0)`);
    const ins = db.prepare('INSERT INTO usage (ts, model, account) VALUES (?, ?, ?)');
    ins.run('2026-10-08T11:18:12.878466+08:00', 'gpt-6-astra', 'agentrouter'); // not in any model list
    ins.run('2026-10-08T11:18:12+08:00', 'gemini-3.7-flash-high', 'a@gmail.com');
    ins.run('not a date', 'x', 'y');

    ensureSchema(db);
    ensureSchema(db); // idempotent

    const rows = db.query('SELECT model, ts, ts_ms, grp FROM usage ORDER BY id').all() as any[];
    expect(rows[0].grp).toBe('agentrouter');
    expect(rows[1].grp).toBe('antigravity');
    expect(rows[0].ts_ms).toBe(Date.parse('2026-10-08T03:18:12.878Z'));
    expect(rows[0].ts).toBe('2026-10-08T11:18:12.878466+08:00'); // original text untouched
    expect(rows[2].ts_ms).toBeNull();
  });
});

describe('insertUsageRows', () => {
  test('is all-or-nothing', () => {
    const db = fresh();
    const bad = { ...row({}), model: null as any }; // violates NOT NULL
    expect(() => insertUsageRows(db, [row({}), bad])).toThrow();
    expect((db.query('SELECT COUNT(*) n FROM usage').get() as any).n).toBe(0);
  });

  test('records the group it is given, infers otherwise', () => {
    const db = fresh();
    insertUsageRows(db, [row({ group: 'workbuddy', model: 'whatever' }), row({ model: 'claude-opus-5', account: 'agentrouter' })]);
    expect(db.query('SELECT grp FROM usage ORDER BY id').all()).toEqual([{ grp: 'workbuddy' }, { grp: 'agentrouter' }]);
  });
});

describe('queryTimeline', () => {
  test('14days: buckets, cost per group, success/failed', () => {
    const db = fresh();
    insertUsageRows(db, [
      row({}), // $0.75 (1M input at 0.75)
      row({ failed: true }),
      row({ ts: at(2026, 9, 7), model: 'cn:auto', group: 'workbuddy' }), // free
      row({ ts: at(2026, 8, 20) }), // outside the 14-day window
    ]);
    const t = queryTimeline(db, '14days', NOW);
    expect(t.count).toBe(14);
    const today = t.data.at(-1)!;
    expect(today.key).toBe('2026-10-08');
    expect(today).toMatchObject({ calls: 2, success: 1, failed: 1 });
    expect(today.cost).toBeCloseTo(1.5);
    expect(t.data.at(-2)!.models['cn:auto']).toMatchObject({ calls: 1, cost: 0, group: 'workbuddy' });
    expect(t.totals.calls).toBe(3);
    expect(t.totals.per_model.map((m) => m.model).sort()).toEqual(['cn:auto', 'gemini-3.7-flash-high']);
  });

  test('today has 24 hour buckets keyed by local hour', () => {
    const db = fresh();
    insertUsageRows(db, [row({ ts: at(2026, 9, 8, 3) }), row({ ts: at(2026, 9, 7, 23) })]);
    const t = queryTimeline(db, 'today', NOW);
    expect(t.count).toBe(24);
    expect(t.data[3]).toMatchObject({ key: '2026-10-08-03', calls: 1 });
    expect(t.totals.calls).toBe(1);
  });

  test('month covers every day of the current month', () => {
    const t = queryTimeline(fresh(), 'month', NOW);
    expect(t.count).toBe(31);
    expect(t.data[0].label).toBe('10/01');
  });

  test('all: totals equal the sum of the buckets even for data older than 12 months', () => {
    const db = fresh();
    insertUsageRows(db, [row({ ts: at(2024, 0, 15) }), row({ ts: at(2026, 9, 8) })]);
    const t = queryTimeline(db, 'all', NOW);
    expect(t.data[0].key).toBe('2024-01');
    expect(t.data.at(-1)!.key).toBe('2026-10');
    expect(t.totals.calls).toBe(2);
    expect(t.data.reduce((s, b) => s + b.calls, 0)).toBe(t.totals.calls);
  });

  test('rows with an unparseable timestamp are ignored', () => {
    const db = fresh();
    insertUsageRows(db, [row({ ts: 'garbage' })]);
    expect(queryTimeline(db, 'all', NOW).totals.calls).toBe(0);
  });
});

describe('pruneUsage', () => {
  test('0 days keeps everything; N days drops older rows', () => {
    const db = fresh();
    insertUsageRows(db, [row({ ts: at(2026, 0, 1) }), row({ ts: at(2026, 9, 8) })]);
    expect(pruneUsage(db, 0, NOW.getTime())).toBe(0);
    expect(pruneUsage(db, 30, NOW.getTime())).toBe(1);
    expect((db.query('SELECT COUNT(*) n FROM usage').get() as any).n).toBe(1);
  });
});

describe('parseUsageRecord', () => {
  const now = Date.parse('2026-10-08T00:00:00Z');
  test('accepts a normal record and fills defaults', () => {
    const r = parseUsageRecord({ model: 'gpt-x', input_tokens: 10, output_tokens: 5 }, now)!;
    expect(r).toMatchObject({ model: 'gpt-x', account: 'agentrouter', total_tokens: 15, failed: false });
    expect(r.ts).toBe(new Date(now).toISOString());
    expect(r.group).toBeUndefined();
  });

  test('keeps an explicit provider group, ignores an invalid one', () => {
    expect(parseUsageRecord({ model: 'm', group: 'workbuddy' }, now)!.group).toBe('workbuddy');
    expect(parseUsageRecord({ model: 'm', group: 'bogus' }, now)!.group).toBeUndefined();
  });

  test('rejects out-of-range or malformed fields', () => {
    for (const bad of [
      null,
      'x',
      {},
      { model: '' },
      { model: 5 },
      { model: 'm', input_tokens: -1 },
      { model: 'm', input_tokens: 'abc' },
      { model: 'm', output_tokens: 1e12 },
      { model: 'm', latency_ms: Infinity },
      { model: 'm', ts: 'not a date' },
      { model: 'm', ts: '1999-01-01T00:00:00Z' },
      { model: 'm', ts: '2030-01-01T00:00:00Z' },
      { model: 'x'.repeat(201) },
    ]) {
      expect(parseUsageRecord(bad, now)).toBeNull();
    }
  });
});
