import type { Context, MiddlewareHandler } from 'hono';

/**
 * Binding to 127.0.0.1 is not enough on its own: a web page in the user's browser can still reach it
 * (cross-site requests, DNS rebinding). This guard rejects anything that is not addressed to us
 * (Host) or not initiated by our own web UI (Origin / Sec-Fetch-Site).
 *
 * Requests with no Origin header (curl, smoke.ts, other local processes) are allowed: browsers always
 * attach Origin to cross-origin and non-GET requests, so its absence rules out a browser-driven attack.
 */
export function createLocalGuard(opts: { port: number; webOrigins: string[]; allowedHosts?: string[] }): MiddlewareHandler {
  // `allowedHosts` (remote mode only) are the exact Host values a tunnel presents; anything else is still a rebinding attempt.
  const hosts = new Set([
    `127.0.0.1:${opts.port}`,
    `localhost:${opts.port}`,
    `[::1]:${opts.port}`,
    ...(opts.allowedHosts ?? []).map((h) => h.toLowerCase()),
  ]);
  const origins = new Set(opts.webOrigins);

  return async (c, next) => {
    const host = (c.req.header('host') ?? '').toLowerCase();
    if (!hosts.has(host)) return c.json({ error: 'forbidden host' }, 403);

    const origin = c.req.header('origin');
    if (origin !== undefined && !origins.has(origin)) return c.json({ error: 'forbidden origin' }, 403);

    if (c.req.header('sec-fetch-site') === 'cross-site') return c.json({ error: 'forbidden cross-site request' }, 403);

    await next();
  };
}

const FORWARDING_HEADERS = ['x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'forwarded', 'x-real-ip', 'cf-connecting-ip', 'cf-ray', 'tailscale-user-login'];
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

/**
 * True only for a browser/curl talking to the loopback address directly, i.e. someone at this machine.
 * A tunnel connects from loopback too, but it forwards the public Host and adds forwarding headers, so
 * neither survives. Best effort, used to keep new-device OAuth logins off remote sessions.
 */
export function isDirectLocalRequest(c: Context): boolean {
  const host = (c.req.header('host') ?? '').toLowerCase().replace(/:\d+$/, '');
  if (!LOOPBACK_HOSTS.has(host)) return false;
  return !FORWARDING_HEADERS.some((h) => c.req.header(h) !== undefined);
}

/** Headers for every API response: nothing here is cacheable by a shared proxy or embeddable in a frame. */
export const apiSecurityHeaders: MiddlewareHandler = async (c, next) => {
  c.header('Cache-Control', 'no-store');
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  await next();
};

/**
 * The only CLIProxyAPI management endpoints the web UI needs. Everything else (notably `/api-call`, which
 * performs an arbitrary HTTP request carrying an account's OAuth token) is not reachable through the proxy.
 * Matched on exact path, so `..` / encoded-slash tricks never line up with an entry.
 */
const MGMT_ALLOWLIST: Record<string, readonly string[]> = {
  GET: [
    '/auth-files',
    '/get-auth-status',
    '/antigravity-auth-url',
    '/oauth-model-alias',
    '/routing/strategy',
    '/config',
    '/logs',
  ],
  PATCH: ['/auth-files/status', '/auth-files/fields', '/oauth-model-alias', '/routing/strategy'],
  DELETE: ['/auth-files'],
  POST: ['/reset-quota'],
};

export function isMgmtAllowed(method: string, path: string): boolean {
  const normalized = path.length > 1 ? path.replace(/\/+$/, '') : path;
  return MGMT_ALLOWLIST[method.toUpperCase()]?.includes(normalized) ?? false;
}

const SECRET_KEY = /key|secret|token|passw|credential/i;

/** Deep-copy `value`, masking anything stored under a secret-looking key (the config page is display-only). */
export function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SECRET_KEY.test(k) && v !== null && v !== '' && v !== false ? '***REDACTED***' : redactSecrets(v);
    }
    return out;
  }
  return value;
}
