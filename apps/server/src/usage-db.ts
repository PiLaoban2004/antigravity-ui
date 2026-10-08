import { Database } from 'bun:sqlite';
import { ensureGatewaySchema } from './gateway/keys';
import { inferGroup, isProviderGroup, type ProviderGroup } from './groups';
import { costOf, priceFor } from './pricing';

export interface UsageInput {
  ts: string;
  model: string;
  account: string;
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  total_tokens: number;
  latency_ms: number;
  failed: boolean;
  /** Which provider served the request. Decided where the row is recorded; inferred only if omitted. */
  group?: ProviderGroup;
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);

export function openUsageDb(path: string): Database {
  const db = new Database(path, { create: true });
  // The dashboard and the remote gateway are separate processes sharing this file: WAL lets one write while the other reads.
  try {
    db.run('PRAGMA busy_timeout = 5000');
    db.run('PRAGMA journal_mode = WAL');
  } catch {
    /* read-only / in-memory: keep the default journal */
  }
  ensureSchema(db);
  return db;
}

export function ensureSchema(db: Database) {
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
  migrate(db);
  ensureGatewaySchema(db);
}

/**
 * Additive migration of databases created before `ts_ms` / `grp` existed.
 *  - ts_ms: epoch milliseconds parsed from `ts`. `ts` is free-form text (varying offsets / precision), so it
 *    cannot be range-queried or ordered reliably; ts_ms can.
 *  - grp: provider group, fixed when the row is written.
 * Existing `ts` values are left untouched.
 */
function migrate(db: Database) {
  const cols = new Set((db.query('PRAGMA table_info(usage)').all() as any[]).map((c) => c.name));
  if (!cols.has('ts_ms')) db.run('ALTER TABLE usage ADD COLUMN ts_ms INTEGER');
  if (!cols.has('grp')) db.run('ALTER TABLE usage ADD COLUMN grp TEXT');

  db.transaction(() => {
    const noTs = db.query('SELECT id, ts FROM usage WHERE ts_ms IS NULL').all() as Array<{ id: number; ts: string }>;
    const setTs = db.prepare('UPDATE usage SET ts_ms = ? WHERE id = ?');
    for (const r of noTs) {
      const ms = Date.parse(r.ts);
      if (!Number.isNaN(ms)) setTs.run(ms, r.id);
    }

    const noGrp = db
      .query('SELECT DISTINCT model, account FROM usage WHERE grp IS NULL')
      .all() as Array<{ model: string; account: string }>;
    const setGrp = db.prepare('UPDATE usage SET grp = ? WHERE model = ? AND account = ? AND grp IS NULL');
    for (const r of noGrp) setGrp.run(inferGroup(r.model, r.account), r.model, r.account);
  })();

  db.run('DROP INDEX IF EXISTS idx_usage_ts'); // text timestamps are not range-queryable; ts_ms replaces it
  db.run('CREATE INDEX IF NOT EXISTS idx_usage_model ON usage(model)');
  db.run('CREATE INDEX IF NOT EXISTS idx_usage_ts_ms ON usage(ts_ms)');
}

const MAX_TOKENS = 1e9;
const MAX_TS_SKEW_MS = 400 * 86400_000;

/**
 * Validate a client-supplied usage record (POST /api/usage/record). Returns null if anything is out of range,
 * instead of silently storing garbage that would skew the charts and cost totals.
 */
export function parseUsageRecord(r: any, now = Date.now()): UsageInput | null {
  if (!r || typeof r !== 'object') return null;
  const str = (v: unknown, fallback?: string) => {
    if (v === undefined || v === null || v === '') return fallback ?? null;
    return typeof v === 'string' && v.length <= 200 ? v : null;
  };
  const count = (v: unknown, max = MAX_TOKENS) => {
    if (v === undefined || v === null) return 0;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 && n <= max ? Math.floor(n) : null;
  };

  const model = str(r.model);
  const account = str(r.account, 'agentrouter');
  const input = count(r.input_tokens);
  const output = count(r.output_tokens);
  const reasoning = count(r.reasoning_tokens);
  const total = r.total_tokens === undefined ? (input ?? 0) + (output ?? 0) + (reasoning ?? 0) : count(r.total_tokens, MAX_TOKENS * 3);
  const latency = count(r.latency_ms, 1e7);
  if (!model || !account || input === null || output === null || reasoning === null || total === null || latency === null) return null;

  let ts: string;
  if (r.ts === undefined || r.ts === null) {
    ts = new Date(now).toISOString();
  } else {
    const ms = typeof r.ts === 'string' ? Date.parse(r.ts) : NaN;
    if (Number.isNaN(ms) || Math.abs(ms - now) > MAX_TS_SKEW_MS) return null;
    ts = r.ts;
  }

  return {
    ts,
    model,
    account,
    input_tokens: input,
    output_tokens: output,
    reasoning_tokens: reasoning,
    total_tokens: total,
    latency_ms: latency,
    failed: Boolean(r.failed),
    group: isProviderGroup(r.group) ? r.group : undefined, // a client that names the provider is authoritative
  };
}

/** Insert a batch atomically: either every row lands or none does (so a retry cannot duplicate). */
export function insertUsageRows(db: Database, rows: UsageInput[]): void {
  if (!rows.length) return;
  const insert = db.prepare(
    `INSERT INTO usage (ts, ts_ms, model, account, input_tokens, output_tokens, reasoning_tokens, total_tokens, latency_ms, failed, grp)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  db.transaction(() => {
    for (const r of rows) {
      const ms = Date.parse(r.ts);
      insert.run(
        r.ts,
        Number.isNaN(ms) ? null : ms,
        r.model,
        r.account,
        num(r.input_tokens),
        num(r.output_tokens),
        num(r.reasoning_tokens),
        num(r.total_tokens),
        num(r.latency_ms),
        r.failed ? 1 : 0,
        isProviderGroup(r.group) ? r.group : inferGroup(r.model, r.account),
      );
    }
  })();
}

/** Delete rows older than `days`. Returns how many were removed. */
export function pruneUsage(db: Database, days: number, now = Date.now()): number {
  if (!(days > 0)) return 0;
  return db.query('DELETE FROM usage WHERE ts_ms IS NOT NULL AND ts_ms < ?').run(now - days * 86400_000).changes;
}

// ---- timeline ---------------------------------------------------------------------------------------------

const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hourKey = (d: Date) => `${dayKey(d)}-${pad(d.getHours())}`;
const monthKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;

interface Counts {
  calls: number;
  success: number;
  failed: number;
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  total_tokens: number;
  cost: number;
}
export interface ModelCounts extends Counts {
  model: string;
  group: ProviderGroup;
}
export interface TimelineBucket extends Counts {
  key: string;
  label: string;
  models: Record<string, ModelCounts>;
}
export interface Timeline {
  period: 'today' | '14days' | 'month' | 'all';
  count: number;
  data: TimelineBucket[];
  totals: Counts & { per_model: ModelCounts[] };
}

const zero = (): Counts => ({
  calls: 0,
  success: 0,
  failed: 0,
  input_tokens: 0,
  output_tokens: 0,
  reasoning_tokens: 0,
  total_tokens: 0,
  cost: 0,
});

function add(into: Counts, r: Counts) {
  into.calls += r.calls;
  into.success += r.success;
  into.failed += r.failed;
  into.input_tokens += r.input_tokens;
  into.output_tokens += r.output_tokens;
  into.reasoning_tokens += r.reasoning_tokens;
  into.total_tokens += r.total_tokens;
  into.cost += r.cost;
}

/**
 * Usage bucketed by hour / day / month in the server's local time zone.
 *
 * SQLite pre-aggregates rows into 15-minute slots (every real UTC offset is a multiple of 15 minutes, so a
 * slot never straddles a local hour boundary) and JS maps each slot to its local bucket. That keeps the work
 * proportional to (active slots x models) instead of the row count, while time-zone handling stays in one
 * place (JS) rather than depending on SQLite's `localtime` agreeing with the runtime.
 * Totals are the sum of the buckets, so the chart and the headline numbers always agree.
 */
const SLOT_MS = 15 * 60_000;

export function queryTimeline(db: Database, periodParam: string, nowDate = new Date()): Timeline {
  const y = nowDate.getFullYear();
  const mo = nowDate.getMonth();
  const d = nowDate.getDate();

  let period: Timeline['period'];
  let keyOf: (d: Date) => string;
  let from: Date;
  let to: Date | null;
  const skeleton: Array<{ key: string; label: string }> = [];

  if (periodParam === 'today') {
    period = 'today';
    keyOf = hourKey;
    from = new Date(y, mo, d);
    to = new Date(y, mo, d + 1);
    for (let h = 0; h < 24; h++) skeleton.push({ key: hourKey(new Date(y, mo, d, h)), label: `${pad(h)}:00` });
  } else if (periodParam === 'month' || periodParam === 'this_month') {
    period = 'month';
    keyOf = dayKey;
    from = new Date(y, mo, 1);
    to = new Date(y, mo + 1, 1);
    const days = new Date(y, mo + 1, 0).getDate();
    for (let day = 1; day <= days; day++) skeleton.push({ key: dayKey(new Date(y, mo, day)), label: `${pad(mo + 1)}/${pad(day)}` });
  } else if (periodParam === 'all') {
    period = 'all';
    keyOf = monthKey;
    // At least the last 12 months, extended back to the first month that has data and forward to the last.
    const span = db.query('SELECT MIN(ts_ms) AS lo, MAX(ts_ms) AS hi FROM usage WHERE ts_ms IS NOT NULL').get() as any;
    let first = new Date(y, mo - 11, 1);
    let last = new Date(y, mo, 1);
    if (span?.lo != null) {
      const lo = new Date(span.lo);
      const hi = new Date(span.hi);
      const loM = new Date(lo.getFullYear(), lo.getMonth(), 1);
      const hiM = new Date(hi.getFullYear(), hi.getMonth(), 1);
      if (loM < first) first = loM;
      if (hiM > last) last = hiM;
    }
    from = first;
    to = null;
    for (let m = new Date(first); m <= last; m = new Date(m.getFullYear(), m.getMonth() + 1, 1)) {
      skeleton.push({ key: monthKey(m), label: `${m.getFullYear()}/${pad(m.getMonth() + 1)}` });
    }
  } else {
    period = '14days';
    keyOf = dayKey;
    from = new Date(y, mo, d - 13);
    to = new Date(y, mo, d + 1);
    for (let i = 13; i >= 0; i--) {
      const day = new Date(y, mo, d - i);
      skeleton.push({ key: dayKey(day), label: `${pad(day.getMonth() + 1)}/${pad(day.getDate())}` });
    }
  }

  const buckets: TimelineBucket[] = skeleton.map((s) => ({ ...s, ...zero(), models: {} }));
  const byKey = new Map(buckets.map((b) => [b.key, b]));

  const rows = db
    .query(
      `SELECT ts_ms / ${SLOT_MS} AS slot,
              model,
              COALESCE(grp, 'antigravity') AS grp,
              COUNT(*) AS calls,
              SUM(failed) AS failed,
              SUM(input_tokens) AS input_tokens,
              SUM(output_tokens) AS output_tokens,
              SUM(reasoning_tokens) AS reasoning_tokens,
              SUM(total_tokens) AS total_tokens
       FROM usage
       WHERE ts_ms >= ?1 AND (?2 IS NULL OR ts_ms < ?2)
       GROUP BY slot, model, grp`,
    )
    .all(from.getTime(), to ? to.getTime() : null) as any[];

  const totals = { ...zero(), per_model: [] as ModelCounts[] };
  const perModel = new Map<string, ModelCounts>();

  for (const r of rows) {
    const b = byKey.get(keyOf(new Date(r.slot * SLOT_MS)));
    if (!b) continue;
    const group: ProviderGroup = isProviderGroup(r.grp) ? r.grp : 'antigravity';
    const failed = num(r.failed);
    const part: Counts = {
      calls: r.calls,
      success: r.calls - failed,
      failed,
      input_tokens: num(r.input_tokens),
      output_tokens: num(r.output_tokens),
      reasoning_tokens: num(r.reasoning_tokens),
      total_tokens: num(r.total_tokens),
      cost: 0,
    };
    part.cost = costOf(part, priceFor(r.model, group));

    add(b, part);
    add(totals, part);

    const bm = (b.models[r.model] ??= { model: r.model, group, ...zero() });
    add(bm, part);
    const tm = perModel.get(r.model) ?? { model: r.model, group, ...zero() };
    add(tm, part);
    perModel.set(r.model, tm);
  }

  totals.per_model = [...perModel.values()];
  return { period, count: buckets.length, data: buckets, totals };
}
