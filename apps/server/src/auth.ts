import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Context, Hono, MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { getConnInfo } from 'hono/bun';

/**
 * Remote mode. Off by default: the dashboard is then loopback-only and unauthenticated, exactly as before.
 * With ANTI_UI_REMOTE=1 every /api request needs a credential, *including* requests from 127.0.0.1 — a
 * tunnel (cloudflared, `tailscale serve`) forwards from loopback, so the peer address proves nothing.
 *
 * Roles: `admin` may do anything; `viewer` may only read. Everything that changes state or spends upstream
 * quota (any non-GET request) needs admin.
 */
export type Role = 'admin' | 'viewer';

export interface RemoteConfig {
  enabled: boolean;
  adminToken: string;
  viewToken: string;
  /** Lets local scripts POST /api/usage/record without a session. Valid for that one endpoint only. */
  recordKey: string;
  /** Trust CF-Connecting-IP / X-Forwarded-For (only correct when a tunnel/proxy is the sole way in). */
  trustedProxy: boolean;
  /** Exact `Host` header values the tunnel presents, e.g. `dash.example.com`. */
  allowedHosts: string[];
  /** Extra browser origins allowed besides https://<allowedHost>. */
  webOrigins: string[];
  sessionTtlMs: number;
}

export const MIN_SECRET_LENGTH = 24;

const list = (v?: string) =>
  (v ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase().replace(/\/+$/, ''))
    .filter(Boolean);

export function loadRemoteConfig(env: Record<string, string | undefined>): RemoteConfig {
  const enabled = env.ANTI_UI_REMOTE === '1';
  const cfg: RemoteConfig = {
    enabled,
    adminToken: env.ANTI_UI_ADMIN_TOKEN ?? '',
    viewToken: env.ANTI_UI_VIEW_TOKEN ?? '',
    recordKey: env.ANTI_UI_RECORD_KEY ?? '',
    trustedProxy: env.ANTI_UI_TRUSTED_PROXY === '1',
    allowedHosts: enabled ? list(env.ANTI_UI_ALLOWED_HOSTS) : [],
    webOrigins: enabled ? list(env.ANTI_UI_WEB_ORIGINS) : [],
    sessionTtlMs: Math.max(1, Number(env.ANTI_UI_SESSION_HOURS ?? 12)) * 3600_000,
  };
  if (!enabled) return cfg;

  const need = (name: string, v: string) => {
    if (v.length < MIN_SECRET_LENGTH) throw new Error(`${name} must be at least ${MIN_SECRET_LENGTH} characters in remote mode`);
  };
  need('ANTI_UI_ADMIN_TOKEN', cfg.adminToken);
  if (cfg.viewToken) {
    need('ANTI_UI_VIEW_TOKEN', cfg.viewToken);
    if (cfg.viewToken === cfg.adminToken) throw new Error('ANTI_UI_VIEW_TOKEN must differ from ANTI_UI_ADMIN_TOKEN');
  }
  if (cfg.recordKey) need('ANTI_UI_RECORD_KEY', cfg.recordKey);
  return cfg;
}

/** Constant-time string comparison (hashing first makes the lengths equal). An empty secret never matches. */
export function safeEqual(a: string, b: string): boolean {
  if (!a || !b) return false;
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** Sliding-window brute-force limiter: per client IP, plus a global cap so botnets cannot go wide. */
export class LoginLimiter {
  private perIp = new Map<string, number[]>();
  private all: number[] = [];
  constructor(
    private opts = { maxPerIp: 5, maxGlobal: 50, windowMs: 15 * 60_000 },
    private now: () => number = Date.now,
  ) {}

  private prune(list: number[]) {
    const cut = this.now() - this.opts.windowMs;
    while (list.length && list[0] <= cut) list.shift();
  }

  /** Milliseconds until another attempt is allowed; 0 if allowed now. */
  retryAfterMs(ip: string): number {
    const mine = this.perIp.get(ip) ?? [];
    this.prune(mine);
    this.prune(this.all);
    const wait = (list: number[], max: number) => (list.length >= max ? list[list.length - max] + this.opts.windowMs - this.now() : 0);
    return Math.max(0, wait(mine, this.opts.maxPerIp), wait(this.all, this.opts.maxGlobal));
  }

  fail(ip: string) {
    const t = this.now();
    const mine = this.perIp.get(ip) ?? [];
    mine.push(t);
    this.perIp.set(ip, mine);
    this.all.push(t);
    if (this.perIp.size > 10_000) this.perIp.delete(this.perIp.keys().next().value as string);
  }

  success(ip: string) {
    this.perIp.delete(ip);
  }
}

/** In-memory sessions (a restart signs everyone out, which is acceptable for a personal dashboard). */
export class SessionStore {
  private sessions = new Map<string, { role: Role; exp: number }>();
  constructor(
    private ttlMs: number,
    private now: () => number = Date.now,
    private max = 100,
  ) {}

  create(role: Role): string {
    const id = randomBytes(32).toString('hex');
    this.sessions.set(id, { role, exp: this.now() + this.ttlMs });
    while (this.sessions.size > this.max) this.sessions.delete(this.sessions.keys().next().value as string);
    return id;
  }

  get(id: string | undefined): Role | null {
    if (!id) return null;
    const s = this.sessions.get(id);
    if (!s) return null;
    if (s.exp <= this.now()) {
      this.sessions.delete(id);
      return null;
    }
    return s.role;
  }

  delete(id: string | undefined) {
    if (id) this.sessions.delete(id);
  }
}

export const SESSION_COOKIE = 'aui_sid';
const READ_METHODS = new Set(['GET', 'HEAD']);

export interface Auth {
  config: RemoteConfig;
  middleware: MiddlewareHandler;
  /** The role of the caller, or null when not authenticated. Local mode: always admin. */
  roleOf(c: Context): Role | null;
  clientIp(c: Context): string;
  registerRoutes(app: Hono): void;
}

export function createAuth(
  config: RemoteConfig,
  deps: { limiter?: LoginLimiter; sessions?: SessionStore } = {},
): Auth {
  const limiter = deps.limiter ?? new LoginLimiter();
  const sessions = deps.sessions ?? new SessionStore(config.sessionTtlMs);

  const clientIp = (c: Context): string => {
    if (config.trustedProxy) {
      const fwd = c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for')?.split(',')[0] ?? c.req.header('x-real-ip');
      if (fwd) return fwd.trim();
    }
    try {
      return getConnInfo(c).remote.address ?? 'unknown';
    } catch {
      return 'unknown'; // not running under Bun.serve (unit tests)
    }
  };

  const isHttps = (c: Context) =>
    new URL(c.req.url).protocol === 'https:' || (config.trustedProxy && c.req.header('x-forwarded-proto') === 'https');

  const roleForToken = (token: string): Role | null =>
    safeEqual(token, config.adminToken) ? 'admin' : safeEqual(token, config.viewToken) ? 'viewer' : null;

  const bearer = (c: Context) => /^Bearer\s+(.+)$/i.exec(c.req.header('authorization') ?? '')?.[1];

  const roleOf = (c: Context): Role | null => {
    if (!config.enabled) return 'admin';
    const fromSession = sessions.get(getCookie(c, SESSION_COOKIE));
    if (fromSession) return fromSession;
    const t = bearer(c);
    return t ? roleForToken(t) : null;
  };

  const middleware: MiddlewareHandler = async (c, next) => {
    if (!config.enabled) return next();
    if (c.req.method === 'OPTIONS' || c.req.path === '/api/session') return next();

    // Local scripts that report usage hold only the record key, which opens exactly this endpoint.
    if (
      c.req.method === 'POST' &&
      c.req.path === '/api/usage/record' &&
      safeEqual(c.req.header('x-record-key') ?? '', config.recordKey)
    ) {
      return next();
    }

    const ip = clientIp(c);
    const role = roleOf(c);
    if (!role) {
      // Only a *presented but wrong* credential counts against the limiter; a plain unauthenticated visit does not.
      if (bearer(c) || c.req.header('x-record-key')) {
        const wait = limiter.retryAfterMs(ip);
        if (wait > 0) return rateLimited(c, wait);
        limiter.fail(ip);
      }
      return c.json({ error: 'unauthorized' }, 401);
    }
    if (!READ_METHODS.has(c.req.method) && role !== 'admin') {
      return c.json({ error: 'admin role required' }, 403);
    }
    await next();
  };

  function rateLimited(c: Context, waitMs: number) {
    c.header('Retry-After', String(Math.ceil(waitMs / 1000)));
    return c.json({ error: 'too many failed attempts', retryAfterSeconds: Math.ceil(waitMs / 1000) }, 429);
  }

  function registerRoutes(app: Hono) {
    app.get('/api/session', (c) => c.json({ remote: config.enabled, role: roleOf(c) }));

    app.post('/api/session', async (c) => {
      if (!config.enabled) return c.json({ remote: false, role: 'admin' });
      const ip = clientIp(c);
      const wait = limiter.retryAfterMs(ip);
      if (wait > 0) return rateLimited(c, wait);

      const body = await c.req.json().catch(() => null);
      const role = typeof body?.token === 'string' ? roleForToken(body.token) : null;
      if (!role) {
        limiter.fail(ip);
        return c.json({ error: 'invalid token' }, 401);
      }
      limiter.success(ip);
      setCookie(c, SESSION_COOKIE, sessions.create(role), {
        httpOnly: true,
        sameSite: 'Strict',
        secure: isHttps(c),
        path: '/',
        maxAge: Math.floor(config.sessionTtlMs / 1000),
      });
      return c.json({ remote: true, role });
    });

    app.delete('/api/session', (c) => {
      sessions.delete(getCookie(c, SESSION_COOKIE));
      deleteCookie(c, SESSION_COOKIE, { path: '/' });
      return c.json({ ok: true });
    });
  }

  return { config, middleware, roleOf, clientIp, registerRoutes };
}
