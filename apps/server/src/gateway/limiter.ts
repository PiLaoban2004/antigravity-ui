import type { Database } from 'bun:sqlite';

/**
 * Admission control for the gateway: per-key RPM / concurrency / daily cap plus a global RPM and concurrency
 * cap across all keys. The global cap is the one that matters for the account: however many keys exist, the
 * upstream only ever sees a bounded, steady rate from this machine.
 *
 * In memory only; a restart forgets the sliding windows (fine) and re-seeds daily counts from the log.
 */
export interface LimitOpts {
  rpm: number | null;
  concurrency: number | null;
  dailyLimit: number | null;
}

export type Admission =
  | { ok: true; release: () => void }
  | { ok: false; reason: 'rpm' | 'concurrency' | 'daily' | 'global_rpm' | 'global_concurrency'; retryAfterSec: number };

const WINDOW_MS = 60_000;

export class GatewayLimiter {
  private stamps = new Map<string, number[]>();
  private active = new Map<string, number>();
  private globalStamps: number[] = [];
  private globalActive = 0;
  private daily = new Map<string, { day: string; count: number }>();

  constructor(
    private db: Database,
    private globals: { rpm: number; concurrency: number },
    private now: () => number = Date.now,
  ) {}

  private dayOf(t: number): string {
    const d = new Date(t);
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  }

  private startOfDay(t: number): number {
    const d = new Date(t);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  /** Requests that were actually forwarded today (rejections do not count against the cap). */
  private dailyCount(keyId: string, t: number): number {
    const day = this.dayOf(t);
    const cur = this.daily.get(keyId);
    if (cur && cur.day === day) return cur.count;
    let count = 0;
    try {
      const r = this.db
        .query('SELECT COUNT(*) AS n FROM gateway_log WHERE key_id = ? AND ts_ms >= ? AND error IS NULL')
        .get(keyId, this.startOfDay(t)) as { n: number };
      count = r.n;
    } catch {
      /* log table unreadable: start from 0 rather than refusing service */
    }
    this.daily.set(keyId, { day, count });
    return count;
  }

  private prune(list: number[], t: number) {
    while (list.length && list[0] <= t - WINDOW_MS) list.shift();
  }

  tryAcquire(keyId: string, limits: LimitOpts): Admission {
    const t = this.now();
    this.prune(this.globalStamps, t);
    const mine = this.stamps.get(keyId) ?? [];
    this.prune(mine, t);

    const retryFrom = (list: number[]) => Math.max(1, Math.ceil((list[0] + WINDOW_MS - t) / 1000));

    if (this.globalActive >= this.globals.concurrency) return { ok: false, reason: 'global_concurrency', retryAfterSec: 1 };
    if (this.globalStamps.length >= this.globals.rpm) return { ok: false, reason: 'global_rpm', retryAfterSec: retryFrom(this.globalStamps) };
    if (limits.concurrency !== null && (this.active.get(keyId) ?? 0) >= limits.concurrency) {
      return { ok: false, reason: 'concurrency', retryAfterSec: 1 };
    }
    if (limits.rpm !== null && mine.length >= limits.rpm) return { ok: false, reason: 'rpm', retryAfterSec: retryFrom(mine) };
    if (limits.dailyLimit !== null && this.dailyCount(keyId, t) >= limits.dailyLimit) {
      const tomorrow = this.startOfDay(t) + 24 * 3600_000;
      return { ok: false, reason: 'daily', retryAfterSec: Math.max(1, Math.ceil((tomorrow - t) / 1000)) };
    }

    mine.push(t);
    this.stamps.set(keyId, mine);
    this.globalStamps.push(t);
    this.globalActive++;
    this.active.set(keyId, (this.active.get(keyId) ?? 0) + 1);
    const d = this.daily.get(keyId);
    if (d) d.count++;

    let released = false;
    return {
      ok: true,
      release: () => {
        if (released) return;
        released = true;
        this.globalActive--;
        const left = (this.active.get(keyId) ?? 1) - 1;
        if (left <= 0) this.active.delete(keyId);
        else this.active.set(keyId, left);
      },
    };
  }

  /** Test / diagnostics hook. */
  inFlight(): number {
    return this.globalActive;
  }
}
