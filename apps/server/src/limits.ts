import type { MiddlewareHandler } from 'hono';

/**
 * Circuit breaker for endpoints that spend real upstream quota (a model test is a genuine completion; a
 * credential test is a call made with an account's OAuth token). Generous enough for the "test everything"
 * button, tight enough that a runaway loop or a stolen session cannot hammer the provider.
 * Global rather than per-client: one owner, and the upstream sees one source either way.
 */
export function createCallGate(opts: { max: number; windowMs: number; concurrency: number }, now: () => number = Date.now): MiddlewareHandler {
  const stamps: number[] = [];
  let inFlight = 0;

  return async (c, next) => {
    const t = now();
    while (stamps.length && stamps[0] <= t - opts.windowMs) stamps.shift();

    if (stamps.length >= opts.max) {
      const retry = Math.ceil((stamps[0] + opts.windowMs - t) / 1000);
      c.header('Retry-After', String(retry));
      return c.json({ error: `rate limit: at most ${opts.max} calls per ${Math.round(opts.windowMs / 1000)}s`, retryAfterSeconds: retry }, 429);
    }
    if (inFlight >= opts.concurrency) {
      c.header('Retry-After', '1');
      return c.json({ error: `too many concurrent calls (max ${opts.concurrency})`, retryAfterSeconds: 1 }, 429);
    }

    stamps.push(t);
    inFlight++;
    try {
      await next();
    } finally {
      inFlight--;
    }
  };
}
