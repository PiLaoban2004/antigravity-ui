import type { Database } from 'bun:sqlite';
import { Hono, type Context } from 'hono';
import { getConnInfo } from 'hono/bun';
import { LoginLimiter } from '../auth';
import { findKey, keyState, modelAllowed, type GatewayKey } from './keys';
import { GatewayLimiter } from './limiter';
import { LogWriter, type LogEntry } from './log';
import { NO_USAGE, UsageSniffer } from './usage';

/**
 * Remote API gateway: the only thing exposed through the public tunnel hostname. It authenticates a
 * self-issued key, enforces that key's limits, forwards a fixed set of model-call paths to the local
 * CLIProxyAPI, and records who called what. It does not touch headers that identify the client application,
 * does not rotate anything, and never forwards management paths.
 */
export interface GatewayOptions {
  db: Database;
  /** CLIProxyAPI base URL, e.g. http://127.0.0.1:8317 */
  upstream: string;
  /** Trust CF-Connecting-IP / X-Forwarded-For (only behind a tunnel or proxy you control). */
  trustedProxy?: boolean;
  globalRpm?: number;
  globalConcurrency?: number;
  maxBodyBytes?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** Test hook: override how the peer address is determined. */
  peerIp?: (c: Context) => string;
}

const MODEL_BODY_PATHS = new Set(['/v1/chat/completions', '/v1/completions', '/v1/responses', '/v1/messages', '/v1/messages/count_tokens']);
const GEMINI_CALL = /^\/v1beta\/models\/[A-Za-z0-9._-]+:(generateContent|streamGenerateContent|countTokens)$/;
const GEMINI_MODEL = /^\/v1beta\/models\/([A-Za-z0-9._-]+):/;

export type RouteKind = 'model-call' | 'list';

/** Exact-match allowlist. Anything else (management API, `..`, encoded slashes, other verbs) is not forwarded. */
export function matchGatewayRoute(method: string, path: string): RouteKind | null {
  if (method === 'POST' && (MODEL_BODY_PATHS.has(path) || GEMINI_CALL.test(path))) return 'model-call';
  if (method === 'GET' && (path === '/v1/models' || path === '/v1beta/models')) return 'list';
  return null;
}

/** Pull the presented key out of the places OpenAI / Anthropic / Gemini clients put it. */
export function presentedKey(headers: Headers, url: URL): string {
  const auth = headers.get('authorization');
  if (auth) {
    const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (m) return m[1].trim();
  }
  return headers.get('x-api-key')?.trim() || headers.get('x-goog-api-key')?.trim() || url.searchParams.get('key')?.trim() || '';
}

const STRIP_REQUEST = new Set([
  'authorization', 'x-api-key', 'x-goog-api-key', 'host', 'connection', 'content-length', 'cookie', 'keep-alive', 'transfer-encoding', 'te', 'upgrade', 'proxy-authorization',
]);
const STRIP_RESPONSE = new Set(['connection', 'keep-alive', 'transfer-encoding', 'content-length', 'content-encoding']);

/** Headers to send upstream: everything the client set except credentials, hop-by-hop and edge-added headers. */
export function upstreamHeaders(src: Headers): Headers {
  const out = new Headers();
  src.forEach((v, k) => {
    const key = k.toLowerCase();
    if (STRIP_REQUEST.has(key) || key.startsWith('cf-') || key.startsWith('x-forwarded-') || key === 'x-real-ip' || key === 'true-client-ip') return;
    out.set(k, v);
  });
  return out;
}

const errorBody = (message: string, type: string, code: string) => ({ error: { message, type, code } });

async function readLimited(req: Request, max: number): Promise<Uint8Array | 'too_large'> {
  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared > max) return 'too_large';
  if (!req.body) return new Uint8Array();
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return 'too_large';
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

const REASON_TEXT: Record<string, string> = {
  rpm: 'rate limit exceeded for this key',
  concurrency: 'too many concurrent requests for this key',
  daily: 'daily request limit reached for this key',
  global_rpm: 'gateway is busy, retry shortly',
  global_concurrency: 'gateway is busy, retry shortly',
};

export function createGateway(opts: GatewayOptions) {
  const { db, upstream } = opts;
  const now = opts.now ?? Date.now;
  const doFetch = opts.fetchImpl ?? fetch;
  const maxBody = opts.maxBodyBytes ?? 8 * 1024 * 1024;
  const limiter = new GatewayLimiter(db, { rpm: opts.globalRpm ?? 120, concurrency: opts.globalConcurrency ?? 4 }, now);
  // Wrong-key attempts per IP. The global cap is deliberately loose: it must not let a scanner lock out real callers.
  const authFails = new LoginLimiter({ maxPerIp: 10, maxGlobal: 1000, windowMs: 15 * 60_000 }, now);
  const logs = new LogWriter(db);
  const app = new Hono();

  const clientIp = (c: Context): string => {
    if (opts.peerIp) return opts.peerIp(c);
    if (opts.trustedProxy) {
      const fwd = c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for')?.split(',')[0] ?? c.req.header('x-real-ip');
      if (fwd) return fwd.trim();
    }
    try {
      return getConnInfo(c).remote.address ?? 'unknown';
    } catch {
      return 'unknown';
    }
  };

  app.get('/healthz', (c) => c.json({ ok: true }));

  app.all('*', async (c) => {
    const started = now();
    const url = new URL(c.req.url);
    const path = url.pathname;
    const method = c.req.method;
    const kind = matchGatewayRoute(method, path);
    if (!kind) return c.json(errorBody('not found', 'invalid_request_error', 'not_found'), 404); // not logged: scanners would flood the table

    const ip = clientIp(c);
    const base = {
      ip,
      country: opts.trustedProxy ? c.req.header('cf-ipcountry') ?? null : null,
      ua: c.req.header('user-agent') ?? null,
      method,
      path,
    };
    const record = (e: Partial<LogEntry> & { status: number }) =>
      logs.add({
        tsMs: started,
        keyId: null,
        model: null,
        latencyMs: now() - started,
        bytes: 0,
        stream: false,
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
        error: null,
        ...base,
        ...e,
      });
    const reject = (status: number, code: string, message: string, extra: Partial<LogEntry> = {}, headers: Record<string, string> = {}) => {
      record({ status, error: code, ...extra });
      for (const [k, v] of Object.entries(headers)) c.header(k, v);
      return c.json(errorBody(message, status === 429 ? 'rate_limit_error' : 'invalid_request_error', code), status as any);
    };

    // ---- authenticate (identical 401 for unknown / disabled / expired so a key's state is not probeable) ----
    const wait = authFails.retryAfterMs(ip);
    if (wait > 0) {
      return c.json(errorBody('too many failed attempts', 'rate_limit_error', 'auth_rate_limited'), 429, { 'Retry-After': String(Math.ceil(wait / 1000)) });
    }
    const presented = presentedKey(c.req.raw.headers, url);
    const key: GatewayKey | null = presented ? findKey(db, presented) : null;
    const state = key ? keyState(key, started) : 'ok';
    if (!key || state !== 'ok') {
      authFails.fail(ip);
      record({ status: 401, keyId: key?.id ?? null, error: !presented ? 'no_key' : !key ? 'bad_key' : state });
      return c.json(errorBody('Invalid API key', 'authentication_error', 'invalid_api_key'), 401);
    }
    authFails.success(ip);

    // ---- body + model ----
    let body: Uint8Array | undefined;
    let model: string | null = null;
    if (kind === 'model-call') {
      const read = await readLimited(c.req.raw, maxBody);
      if (read === 'too_large') return reject(413, 'body_too_large', `request body exceeds ${maxBody} bytes`, { keyId: key.id });
      body = read;
      model = GEMINI_MODEL.exec(path)?.[1] ?? null;
      if (!model) {
        try {
          const j = JSON.parse(new TextDecoder().decode(body));
          if (typeof j?.model === 'string') model = j.model;
        } catch {
          /* malformed JSON: forwarded as-is unless the key has a model allowlist */
        }
      }
      if (!modelAllowed(key.models, model)) {
        return reject(403, 'model_not_allowed', `this key may not use model ${model ?? '(unspecified)'}`, { keyId: key.id, model });
      }
    }

    // ---- admission ----
    const adm = limiter.tryAcquire(key.id, { rpm: key.rpm, concurrency: key.concurrency, dailyLimit: key.dailyLimit });
    if (!adm.ok) {
      return reject(429, adm.reason, REASON_TEXT[adm.reason], { keyId: key.id, model }, { 'Retry-After': String(adm.retryAfterSec) });
    }

    // ---- forward ----
    const target = new URL(path, upstream);
    for (const [k, v] of url.searchParams) if (k !== 'key') target.searchParams.append(k, v);
    let res: Response;
    try {
      res = await doFetch(target, {
        method,
        headers: upstreamHeaders(c.req.raw.headers),
        body: body && body.byteLength ? body : undefined,
        signal: c.req.raw.signal,
        redirect: 'manual',
      });
    } catch (e) {
      adm.release();
      const aborted = c.req.raw.signal.aborted;
      record({ status: aborted ? 499 : 502, keyId: key.id, model, error: aborted ? 'client_abort' : 'upstream_unavailable' });
      return c.json(errorBody('upstream unavailable', 'api_error', 'upstream_unavailable'), 502);
    }

    const isStream = (res.headers.get('content-type') ?? '').includes('text/event-stream');
    const sniff = new UsageSniffer();
    let done = false;
    const finalize = (error: string | null) => {
      if (done) return;
      done = true;
      adm.release();
      const u = res.status < 400 ? (error ? NO_USAGE : sniff.result(isStream)) : NO_USAGE;
      record({
        status: res.status,
        keyId: key.id,
        model,
        bytes: sniff.bytes,
        stream: isStream,
        inputTokens: u.input,
        outputTokens: u.output,
        totalTokens: u.total,
        // Upstream failures (Google 429 etc.) are the upstream's, not the gateway's: keep error null so they still count as forwarded.
        error,
      });
    };

    const headers = new Headers();
    res.headers.forEach((v, k) => {
      if (!STRIP_RESPONSE.has(k.toLowerCase())) headers.set(k, v);
    });

    if (!res.body) {
      finalize(null);
      return new Response(null, { status: res.status, headers });
    }
    const reader = res.body.getReader();
    const stream = new ReadableStream<Uint8Array>({
      async pull(ctrl) {
        try {
          const { done: end, value } = await reader.read();
          if (end) {
            finalize(null);
            ctrl.close();
            return;
          }
          sniff.push(value);
          ctrl.enqueue(value);
        } catch {
          finalize('upstream_stream_error');
          ctrl.error(new Error('upstream stream failed'));
        }
      },
      cancel(reason) {
        finalize('client_abort');
        return reader.cancel(reason).catch(() => {});
      },
    });
    return new Response(stream, { status: res.status, headers });
  });

  return { app, logs, limiter, authFails };
}

