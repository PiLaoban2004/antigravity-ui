import type { MiddlewareHandler } from 'hono';

/**
 * Remote viewers must not multiply upstream work: N browsers watching the dashboard should cost the same
 * CLIProxyAPI / language_server calls as one. Two small tools:
 *  - TtlCache:    concurrent callers share one in-flight call; the result is reused for `ttlMs`.
 *  - Broadcaster: one timer polls for all subscribers and runs only while someone is listening.
 */
export class TtlCache {
  private entries = new Map<string, { exp: number; value: Promise<unknown> }>();
  constructor(private now: () => number = Date.now) {}

  get<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
    const hit = this.entries.get(key);
    if (hit && hit.exp > this.now()) return hit.value as Promise<T>;
    const value = fn();
    this.entries.set(key, { exp: this.now() + ttlMs, value });
    // Failures are shared with whoever was already waiting, but never remembered.
    value.catch(() => {
      if (this.entries.get(key)?.value === value) this.entries.delete(key);
    });
    return value;
  }

  invalidate(prefix = '') {
    for (const k of this.entries.keys()) if (k.startsWith(prefix)) this.entries.delete(k);
  }
}

export class Broadcaster<T> {
  private subs = new Set<(v: T) => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private last: T | undefined;
  private running = false;

  constructor(
    private poll: () => Promise<T | undefined>,
    private intervalMs: number,
  ) {}

  get subscribers() {
    return this.subs.size;
  }

  subscribe(fn: (v: T) => void): () => void {
    this.subs.add(fn);
    if (this.last !== undefined) fn(this.last);
    if (!this.timer) {
      this.timer = setInterval(() => void this.tick(), this.intervalMs);
      void this.tick();
    }
    return () => {
      this.subs.delete(fn);
      if (!this.subs.size && this.timer) {
        clearInterval(this.timer);
        this.timer = null;
        this.last = undefined; // a later first subscriber must not be served stale data
      }
    };
  }

  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const v = await this.poll();
      if (v === undefined) return;
      this.last = v;
      for (const fn of [...this.subs]) fn(v);
    } catch {
      // upstream down: try again next tick
    } finally {
      this.running = false;
    }
  }
}

/**
 * Cache successful JSON GET responses per URL (path + query) for `ttlMs`, sharing concurrent in-flight
 * requests. Non-200 results are never reused. Call `cache.invalidate(prefix)` after a mutation.
 */
export function responseCache(cache: TtlCache, ttlMs: number): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.method !== 'GET') return next();
    const u = new URL(c.req.url);
    const key = `resp:${u.pathname}${u.search}`;

    let produced = false;
    const body = await cache.get(key, ttlMs, async () => {
      produced = true;
      await next();
      if (c.res.status !== 200) throw new Error(`not cacheable: ${c.res.status}`);
      return c.res.clone().text();
    }).catch(() => null);

    if (produced) return; // this request ran the handler; c.res is already set
    if (body === null) return next(); // the shared attempt failed: do the work ourselves
    return c.body(body, 200, { 'Content-Type': 'application/json' });
  };
}
