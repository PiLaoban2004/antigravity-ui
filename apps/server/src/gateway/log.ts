import type { Database } from 'bun:sqlite';

export interface LogEntry {
  tsMs: number;
  keyId: string | null;
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
  /** Set when the gateway refused or failed the request itself; null when it was forwarded. */
  error: string | null;
}

const MAX_QUEUE = 5000;

/**
 * Buffered writer for gateway_log. Logging must never slow down or break forwarding: entries are queued and
 * written in one transaction, a failed batch is retried with the next one (bounded), and a key's
 * last_used / last_ip are updated alongside.
 */
export class LogWriter {
  private queue: LogEntry[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private db: Database, private flushEveryMs = 1000) {}

  start() {
    if (!this.timer) {
      this.timer = setInterval(() => this.flush(), this.flushEveryMs);
      (this.timer as any).unref?.();
    }
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.flush();
  }

  add(e: LogEntry) {
    this.queue.push(e);
    if (this.queue.length > MAX_QUEUE) this.queue.splice(0, this.queue.length - MAX_QUEUE);
    if (this.queue.length >= 100) this.flush();
  }

  pending(): number {
    return this.queue.length;
  }

  flush() {
    if (!this.queue.length) return;
    const batch = this.queue;
    this.queue = [];
    try {
      const ins = this.db.query(
        `INSERT INTO gateway_log (ts_ms, key_id, ip, country, ua, method, path, model, status, latency_ms, bytes, stream,
                                  input_tokens, output_tokens, total_tokens, error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const touch = this.db.query('UPDATE gateway_key SET last_used_ms = ?, last_ip = ? WHERE id = ?');
      this.db.transaction(() => {
        const last = new Map<string, LogEntry>();
        for (const e of batch) {
          ins.run(
            e.tsMs,
            e.keyId,
            e.ip.slice(0, 64),
            e.country?.slice(0, 8) ?? null,
            e.ua?.slice(0, 160) ?? null,
            e.method,
            e.path.slice(0, 200),
            e.model?.slice(0, 100) ?? null,
            e.status,
            Math.max(0, Math.round(e.latencyMs)),
            e.bytes,
            e.stream ? 1 : 0,
            e.inputTokens,
            e.outputTokens,
            e.totalTokens,
            e.error,
          );
          if (e.keyId) last.set(e.keyId, e);
        }
        for (const [id, e] of last) touch.run(e.tsMs, e.ip.slice(0, 64), id);
      })();
    } catch (err) {
      // Keep the batch for the next tick (bounded); never throw into the request path.
      this.queue = [...batch, ...this.queue].slice(-MAX_QUEUE);
      console.error('[gateway] log write failed, will retry:', (err as Error).message);
    }
  }
}

/** Optional retention: delete log rows older than `days`. */
export function pruneGatewayLog(db: Database, days: number, now = Date.now()): number {
  if (!(days > 0)) return 0;
  return db.query('DELETE FROM gateway_log WHERE ts_ms < ?').run(now - days * 86_400_000).changes;
}
