import type { Database } from 'bun:sqlite';

export interface GatewayStats {
  sinceMs: number;
  untilMs: number;
  total: number;
  /** Forwarded and answered with a non-error status. */
  ok: number;
  /** Forwarded but the upstream answered >= 400 (e.g. Google 429), or the stream broke. */
  upstreamErrors: number;
  /** Refused by the gateway itself (auth, limits, model not allowed, ...). */
  rejected: number;
  latencyP50: number | null;
  latencyP95: number | null;
  /** Sums over rows that reported usage; `tokenRows` says how many did, out of `forwarded`. */
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  tokenRows: number;
  forwarded: number;
  activeKeys: number;
  byKey: Array<{ keyId: string | null; requests: number; rejected: number; tokens: number; lastMs: number }>;
  byModel: Array<{ model: string; requests: number; tokens: number }>;
  byIp: Array<{ ip: string; country: string | null; requests: number; rejected: number; lastMs: number }>;
  byCountry: Array<{ country: string; requests: number }>;
  /** Hourly buckets keyed by epoch-hour start (ms); the client formats them in its own time zone. */
  timeline: Array<{ t: number; requests: number; errors: number; tokens: number }>;
}

const HOUR = 3_600_000;

function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

export function queryGatewayStats(db: Database, sinceMs: number, untilMs = Date.now()): GatewayStats {
  const range = [sinceMs, untilMs] as const;
  const one = (sql: string) => db.query(sql).get(...range) as any;
  const all = (sql: string) => db.query(sql).all(...range) as any[];

  const head = one(`SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN error IS NOT NULL AND error NOT IN ('upstream_stream_error','client_abort','upstream_unavailable') THEN 1 ELSE 0 END) AS rejected,
      SUM(CASE WHEN (error IS NULL AND status >= 400) OR error IN ('upstream_stream_error','upstream_unavailable') THEN 1 ELSE 0 END) AS upstream_errors,
      SUM(CASE WHEN error IS NULL AND status < 400 THEN 1 ELSE 0 END) AS ok,
      SUM(CASE WHEN error IS NULL OR error IN ('upstream_stream_error','client_abort','upstream_unavailable') THEN 1 ELSE 0 END) AS forwarded,
      SUM(CASE WHEN total_tokens IS NOT NULL THEN 1 ELSE 0 END) AS token_rows,
      COALESCE(SUM(input_tokens), 0) AS inp, COALESCE(SUM(output_tokens), 0) AS outp, COALESCE(SUM(total_tokens), 0) AS tot,
      COUNT(DISTINCT CASE WHEN key_id IS NOT NULL AND error IS NULL THEN key_id END) AS active_keys
    FROM gateway_log WHERE ts_ms >= ? AND ts_ms < ?`);

  const latencies = (all(`SELECT latency_ms AS l FROM gateway_log WHERE ts_ms >= ? AND ts_ms < ? AND error IS NULL AND status < 400 ORDER BY latency_ms`) as { l: number }[]).map((r) => r.l);

  const byKey = all(`SELECT key_id AS keyId, COUNT(*) AS requests,
        SUM(CASE WHEN error IS NOT NULL AND error NOT IN ('upstream_stream_error','client_abort','upstream_unavailable') THEN 1 ELSE 0 END) AS rejected,
        COALESCE(SUM(total_tokens), 0) AS tokens, MAX(ts_ms) AS lastMs
      FROM gateway_log WHERE ts_ms >= ? AND ts_ms < ? GROUP BY key_id ORDER BY requests DESC LIMIT 20`);
  const byModel = all(`SELECT model, COUNT(*) AS requests, COALESCE(SUM(total_tokens), 0) AS tokens
      FROM gateway_log WHERE ts_ms >= ? AND ts_ms < ? AND model IS NOT NULL AND error IS NULL GROUP BY model ORDER BY requests DESC LIMIT 20`);
  const byIp = all(`SELECT ip, MAX(country) AS country, COUNT(*) AS requests,
        SUM(CASE WHEN error IS NOT NULL AND error NOT IN ('upstream_stream_error','client_abort','upstream_unavailable') THEN 1 ELSE 0 END) AS rejected, MAX(ts_ms) AS lastMs
      FROM gateway_log WHERE ts_ms >= ? AND ts_ms < ? GROUP BY ip ORDER BY requests DESC LIMIT 20`);
  const byCountry = all(`SELECT country, COUNT(*) AS requests FROM gateway_log
      WHERE ts_ms >= ? AND ts_ms < ? AND country IS NOT NULL GROUP BY country ORDER BY requests DESC LIMIT 20`);
  const hours = all(`SELECT (ts_ms / ${HOUR}) * ${HOUR} AS t, COUNT(*) AS requests,
        SUM(CASE WHEN status >= 400 THEN 1 ELSE 0 END) AS errors, COALESCE(SUM(total_tokens), 0) AS tokens
      FROM gateway_log WHERE ts_ms >= ? AND ts_ms < ? GROUP BY t ORDER BY t`);

  // Fill empty hours so the chart has a continuous axis (capped: an `all`-sized range must not explode).
  const timeline: GatewayStats['timeline'] = [];
  const byT = new Map<number, any>(hours.map((h) => [h.t, h]));
  const first = Math.floor(sinceMs / HOUR) * HOUR;
  const last = Math.floor((untilMs - 1) / HOUR) * HOUR;
  if ((last - first) / HOUR <= 24 * 31) {
    for (let t = first; t <= last; t += HOUR) {
      const h = byT.get(t);
      timeline.push({ t, requests: h?.requests ?? 0, errors: h?.errors ?? 0, tokens: h?.tokens ?? 0 });
    }
  } else {
    for (const h of hours) timeline.push({ t: h.t, requests: h.requests, errors: h.errors, tokens: h.tokens });
  }

  return {
    sinceMs,
    untilMs,
    total: head.total ?? 0,
    ok: head.ok ?? 0,
    upstreamErrors: head.upstream_errors ?? 0,
    rejected: head.rejected ?? 0,
    latencyP50: percentile(latencies, 50),
    latencyP95: percentile(latencies, 95),
    inputTokens: head.inp ?? 0,
    outputTokens: head.outp ?? 0,
    totalTokens: head.tot ?? 0,
    tokenRows: head.token_rows ?? 0,
    forwarded: head.forwarded ?? 0,
    activeKeys: head.active_keys ?? 0,
    byKey,
    byModel,
    byIp,
    byCountry,
    timeline,
  };
}

export interface LogQuery {
  limit?: number;
  beforeId?: number;
  keyId?: string;
  /** ok = forwarded < 400, error = upstream >= 400 or stream failure, rejected = refused by the gateway. */
  outcome?: 'ok' | 'error' | 'rejected';
  model?: string;
}

export interface LogRow {
  id: number;
  tsMs: number;
  keyId: string | null;
  keyName: string | null;
  ip: string;
  country: string | null;
  ua: string | null;
  method: string;
  path: string;
  model: string | null;
  status: number;
  latencyMs: number;
  bytes: number;
  stream: boolean;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  error: string | null;
}

const GATEWAY_FAULTS = `('upstream_stream_error','client_abort','upstream_unavailable')`;

export function queryGatewayLogs(db: Database, q: LogQuery = {}): LogRow[] {
  const where: string[] = [];
  const args: any[] = [];
  if (q.beforeId) {
    where.push('l.id < ?');
    args.push(q.beforeId);
  }
  if (q.keyId) {
    where.push('l.key_id = ?');
    args.push(q.keyId);
  }
  if (q.model) {
    where.push('l.model = ?');
    args.push(q.model);
  }
  if (q.outcome === 'ok') where.push('l.error IS NULL AND l.status < 400');
  else if (q.outcome === 'rejected') where.push(`l.error IS NOT NULL AND l.error NOT IN ${GATEWAY_FAULTS}`);
  else if (q.outcome === 'error') where.push(`((l.error IS NULL AND l.status >= 400) OR l.error IN ${GATEWAY_FAULTS})`);
  const limit = Math.min(Math.max(Math.floor(q.limit ?? 100), 1), 500);
  const rows = db
    .query(
      `SELECT l.*, k.name AS key_name FROM gateway_log l LEFT JOIN gateway_key k ON k.id = l.key_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY l.id DESC LIMIT ?`,
    )
    .all(...args, limit) as any[];
  return rows.map((r) => ({
    id: r.id,
    tsMs: r.ts_ms,
    keyId: r.key_id,
    keyName: r.key_name ?? null,
    ip: r.ip,
    country: r.country,
    ua: r.ua,
    method: r.method,
    path: r.path,
    model: r.model,
    status: r.status,
    latencyMs: r.latency_ms,
    bytes: r.bytes,
    stream: !!r.stream,
    inputTokens: r.input_tokens,
    outputTokens: r.output_tokens,
    totalTokens: r.total_tokens,
    error: r.error,
  }));
}

/** Per-key request counts over the last 24h, for the key table. */
export function requestsLast24h(db: Database, now = Date.now()): Record<string, number> {
  const rows = db
    .query('SELECT key_id AS k, COUNT(*) AS n FROM gateway_log WHERE ts_ms >= ? AND key_id IS NOT NULL AND error IS NULL GROUP BY key_id')
    .all(now - 24 * HOUR) as { k: string; n: number }[];
  return Object.fromEntries(rows.map((r) => [r.k, r.n]));
}
