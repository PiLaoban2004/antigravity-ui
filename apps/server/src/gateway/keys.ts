import type { Database } from 'bun:sqlite';
import { createHash, randomBytes } from 'node:crypto';
import { decryptSecret, encryptSecret } from './secret';

/**
 * API keys for the remote gateway, in the style of a relay ("中转") site: self-issued `sk-…` keys, each with its
 * own limits. The gateway authenticates by SHA-256 hash (the keys carry 256 bits of randomness, so a plain hash
 * is enough and lets it look a key up by index). The dashboard can show a key again because an AES-GCM encrypted
 * copy is kept too (secret.ts); keys created without a master key have none and cannot be revealed.
 */
export interface GatewayKey {
  id: string;
  name: string;
  note: string;
  prefix: string;
  createdMs: number;
  expiresMs: number | null;
  enabled: boolean;
  /** Allowed model ids (a trailing `*` is a prefix match). null = any model. */
  models: string[] | null;
  rpm: number | null;
  concurrency: number | null;
  dailyLimit: number | null;
  lastUsedMs: number | null;
  lastIp: string | null;
  /** An encrypted copy exists, so the dashboard can show the full key again. */
  revealable: boolean;
}

export interface KeyInput {
  name: string;
  note: string;
  expiresMs: number | null;
  models: string[] | null;
  rpm: number | null;
  concurrency: number | null;
  dailyLimit: number | null;
}

export function ensureGatewaySchema(db: Database) {
  db.run(`CREATE TABLE IF NOT EXISTS gateway_key (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    hash TEXT NOT NULL UNIQUE,
    prefix TEXT NOT NULL,
    created_ms INTEGER NOT NULL,
    expires_ms INTEGER,
    enabled INTEGER NOT NULL DEFAULT 1,
    models TEXT,
    rpm INTEGER,
    concurrency INTEGER,
    daily_limit INTEGER,
    last_used_ms INTEGER,
    last_ip TEXT,
    secret_enc TEXT
  )`);
  const cols = new Set((db.query('PRAGMA table_info(gateway_key)').all() as { name: string }[]).map((c) => c.name));
  if (!cols.has('secret_enc')) db.run('ALTER TABLE gateway_key ADD COLUMN secret_enc TEXT');
  // One row per request that reached the gateway with a (well-formed) credential, plus rejected ones.
  // `error` is set when the gateway itself refused or failed the request; NULL means it was forwarded.
  // Token columns are NULL when the response carried no usage block (never 0: unknown is not zero).
  db.run(`CREATE TABLE IF NOT EXISTS gateway_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts_ms INTEGER NOT NULL,
    key_id TEXT,
    ip TEXT NOT NULL,
    country TEXT,
    ua TEXT,
    method TEXT NOT NULL,
    path TEXT NOT NULL,
    model TEXT,
    status INTEGER NOT NULL,
    latency_ms INTEGER NOT NULL DEFAULT 0,
    bytes INTEGER NOT NULL DEFAULT 0,
    stream INTEGER NOT NULL DEFAULT 0,
    input_tokens INTEGER,
    output_tokens INTEGER,
    total_tokens INTEGER,
    error TEXT
  )`);
  db.run('CREATE INDEX IF NOT EXISTS idx_gateway_log_ts ON gateway_log(ts_ms)');
  db.run('CREATE INDEX IF NOT EXISTS idx_gateway_log_key_ts ON gateway_log(key_id, ts_ms)');
}

export function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/** `sk-` + 43 url-safe chars (256 bits). */
export function generateKey(): string {
  return `sk-${randomBytes(32).toString('base64url')}`;
}

const rowToKey = (r: any): GatewayKey => ({
  id: r.id,
  name: r.name,
  note: r.note ?? '',
  prefix: r.prefix,
  createdMs: r.created_ms,
  expiresMs: r.expires_ms ?? null,
  enabled: !!r.enabled,
  models: r.models ? (JSON.parse(r.models) as string[]) : null,
  rpm: r.rpm ?? null,
  concurrency: r.concurrency ?? null,
  dailyLimit: r.daily_limit ?? null,
  lastUsedMs: r.last_used_ms ?? null,
  lastIp: r.last_ip ?? null,
  revealable: !!r.secret_enc,
});

export function createKey(db: Database, input: KeyInput, now = Date.now(), master?: Buffer): { key: string; record: GatewayKey } {
  const key = generateKey();
  const id = randomBytes(6).toString('hex');
  db.query(
    `INSERT INTO gateway_key (id, name, note, hash, prefix, created_ms, expires_ms, enabled, models, rpm, concurrency, daily_limit, secret_enc)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.name,
    input.note,
    hashKey(key),
    key.slice(0, 9),
    now,
    input.expiresMs,
    input.models ? JSON.stringify(input.models) : null,
    input.rpm,
    input.concurrency,
    input.dailyLimit,
    master ? encryptSecret(master, id, key) : null,
  );
  return { key, record: getKey(db, id)! };
}

export function getKey(db: Database, id: string): GatewayKey | null {
  const r = db.query('SELECT * FROM gateway_key WHERE id = ?').get(id);
  return r ? rowToKey(r) : null;
}

export function listKeys(db: Database): GatewayKey[] {
  return (db.query('SELECT * FROM gateway_key ORDER BY created_ms DESC').all() as any[]).map(rowToKey);
}

/** The full key, for the dashboard's "view" button. Null if unknown, not stored, or undecryptable. */
export function revealKey(db: Database, id: string, master: Buffer): string | null {
  const r = db.query('SELECT secret_enc FROM gateway_key WHERE id = ?').get(id) as { secret_enc: string | null } | null;
  return r?.secret_enc ? decryptSecret(master, id, r.secret_enc) : null;
}

/** Look a presented credential up by its hash. Returns null for unknown keys; state checks are `keyState`'s job. */
export function findKey(db: Database, presented: string): GatewayKey | null {
  if (!presented || presented.length > 200) return null;
  const r = db.query('SELECT * FROM gateway_key WHERE hash = ?').get(hashKey(presented));
  return r ? rowToKey(r) : null;
}

export type KeyState = 'ok' | 'disabled' | 'expired';

export function keyState(k: GatewayKey, now = Date.now()): KeyState {
  if (!k.enabled) return 'disabled';
  if (k.expiresMs !== null && k.expiresMs <= now) return 'expired';
  return 'ok';
}

export function updateKey(db: Database, id: string, patch: Partial<KeyInput> & { enabled?: boolean }): GatewayKey | null {
  const cur = getKey(db, id);
  if (!cur) return null;
  const next = {
    name: patch.name ?? cur.name,
    note: patch.note ?? cur.note,
    expiresMs: patch.expiresMs !== undefined ? patch.expiresMs : cur.expiresMs,
    models: patch.models !== undefined ? patch.models : cur.models,
    rpm: patch.rpm !== undefined ? patch.rpm : cur.rpm,
    concurrency: patch.concurrency !== undefined ? patch.concurrency : cur.concurrency,
    dailyLimit: patch.dailyLimit !== undefined ? patch.dailyLimit : cur.dailyLimit,
    enabled: patch.enabled !== undefined ? patch.enabled : cur.enabled,
  };
  db.query(
    'UPDATE gateway_key SET name=?, note=?, expires_ms=?, models=?, rpm=?, concurrency=?, daily_limit=?, enabled=? WHERE id=?',
  ).run(
    next.name,
    next.note,
    next.expiresMs,
    next.models ? JSON.stringify(next.models) : null,
    next.rpm,
    next.concurrency,
    next.dailyLimit,
    next.enabled ? 1 : 0,
    id,
  );
  return getKey(db, id);
}

export function deleteKey(db: Database, id: string): boolean {
  return db.query('DELETE FROM gateway_key WHERE id = ?').run(id).changes > 0;
}

/** Does `model` pass the key's allowlist? Entries ending in `*` match by prefix. */
export function modelAllowed(allow: string[] | null, model: string | null): boolean {
  if (!allow) return true;
  if (!model) return false;
  return allow.some((p) => (p.endsWith('*') ? model.startsWith(p.slice(0, -1)) : p === model));
}

const intIn = (v: unknown, min: number, max: number): number | null | undefined => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) return undefined; // undefined = invalid
  return n;
};

/**
 * Validate a create/update body from the dashboard. Returns the cleaned fields, or an error string.
 * With `partial`, absent fields stay absent (so a PATCH can leave them alone).
 */
export function parseKeyInput(body: any, opts: { partial: boolean }, now = Date.now()): { ok: true; value: Partial<KeyInput> & { enabled?: boolean } } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') return { ok: false, error: 'invalid body' };
  const out: Partial<KeyInput> & { enabled?: boolean } = {};
  const has = (k: string) => k in body;

  if (has('name') || !opts.partial) {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > 60) return { ok: false, error: 'name is required (max 60 chars)' };
    out.name = name;
  }
  if (has('note')) {
    if (typeof body.note !== 'string' || body.note.length > 200) return { ok: false, error: 'note must be a string (max 200 chars)' };
    out.note = body.note;
  } else if (!opts.partial) out.note = '';

  const limits: Array<[keyof KeyInput, string, number, number]> = [
    ['rpm', 'rpm', 1, 10_000],
    ['concurrency', 'concurrency', 1, 64],
    ['dailyLimit', 'dailyLimit', 1, 10_000_000],
  ];
  for (const [field, label, min, max] of limits) {
    if (has(field) || !opts.partial) {
      const v = intIn(body[field], min, max);
      if (v === undefined) return { ok: false, error: `${label} must be an integer in ${min}..${max} (or empty for no limit)` };
      (out as any)[field] = v;
    }
  }

  if (has('expiresMs') || !opts.partial) {
    const raw = body.expiresMs;
    if (raw === null || raw === undefined || raw === '') out.expiresMs = null;
    else {
      const n = Number(raw);
      if (!Number.isFinite(n) || n <= now) return { ok: false, error: 'expiresMs must be a future timestamp (or empty)' };
      out.expiresMs = Math.floor(n);
    }
  }

  if (has('models') || !opts.partial) {
    const m = body.models;
    if (m === null || m === undefined) out.models = null;
    else if (Array.isArray(m) && m.length <= 50 && m.every((x) => typeof x === 'string' && x.trim() && x.length <= 100)) {
      out.models = m.length ? [...new Set(m.map((x: string) => x.trim()))] : null;
    } else return { ok: false, error: 'models must be an array of up to 50 model ids (or empty for any model)' };
  }

  if (has('enabled')) {
    if (typeof body.enabled !== 'boolean') return { ok: false, error: 'enabled must be a boolean' };
    out.enabled = body.enabled;
  }
  return { ok: true, value: out };
}
