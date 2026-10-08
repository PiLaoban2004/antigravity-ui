import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { decryptSecret } from './secret';
import { createKey, deleteKey, revealKey, ensureGatewaySchema, findKey, generateKey, getKey, hashKey, keyState, listKeys, modelAllowed, parseKeyInput, updateKey } from './keys';

const mk = () => {
  const db = new Database(':memory:');
  ensureGatewaySchema(db);
  return db;
};
const input = { name: 'phone', note: '', expiresMs: null, models: null, rpm: null, concurrency: null, dailyLimit: null };

describe('gateway keys', () => {
  test('generated keys are long, prefixed and unique', () => {
    const a = generateKey();
    expect(a).toMatch(/^sk-[A-Za-z0-9_-]{43}$/);
    expect(generateKey()).not.toBe(a);
  });

  test('only the hash is stored; lookup works by plaintext', () => {
    const db = mk();
    const { key, record } = createKey(db, input);
    const raw = JSON.stringify(db.query('SELECT * FROM gateway_key').all());
    expect(raw).not.toContain(key);
    expect(raw).toContain(hashKey(key));
    expect(findKey(db, key)?.id).toBe(record.id);
    expect(findKey(db, key + 'x')).toBeNull();
    expect(findKey(db, '')).toBeNull();
    expect(findKey(db, 'x'.repeat(500))).toBeNull();
  });

  test('state: disabled and expired keys are not ok', () => {
    const db = mk();
    const { record } = createKey(db, { ...input, expiresMs: 2000 }, 1000);
    expect(keyState(record, 1500)).toBe('ok');
    expect(keyState(record, 2000)).toBe('expired');
    const off = updateKey(db, record.id, { enabled: false })!;
    expect(keyState(off, 1500)).toBe('disabled');
  });

  test('update leaves untouched fields alone and can clear limits', () => {
    const db = mk();
    const { record } = createKey(db, { ...input, rpm: 10, models: ['gemini-*'] });
    const u = updateKey(db, record.id, { name: 'laptop', rpm: null })!;
    expect(u.name).toBe('laptop');
    expect(u.rpm).toBeNull();
    expect(u.models).toEqual(['gemini-*']);
    expect(updateKey(db, 'nope', { name: 'x' })).toBeNull();
  });

  test('delete removes the key', () => {
    const db = mk();
    const { record } = createKey(db, input);
    expect(deleteKey(db, record.id)).toBe(true);
    expect(getKey(db, record.id)).toBeNull();
    expect(listKeys(db)).toHaveLength(0);
    expect(deleteKey(db, record.id)).toBe(false);
  });

  test('model allowlist: exact, prefix wildcard, unknown model denied', () => {
    expect(modelAllowed(null, 'anything')).toBe(true);
    expect(modelAllowed(null, null)).toBe(true);
    expect(modelAllowed(['gemini-*'], 'gemini-3-pro')).toBe(true);
    expect(modelAllowed(['gemini-3-pro'], 'gemini-3-pro-x')).toBe(false);
    expect(modelAllowed(['gemini-*'], null)).toBe(false);
  });

  test('parseKeyInput validates ranges and trims', () => {
    const ok = parseKeyInput({ name: '  a ', rpm: '30', models: ['x', 'x', 'y'], expiresMs: null }, { partial: false }, 1000);
    expect(ok.ok && ok.value).toMatchObject({ name: 'a', rpm: 30, models: ['x', 'y'], expiresMs: null, concurrency: null, dailyLimit: null });
    expect(parseKeyInput({ name: '' }, { partial: false }).ok).toBe(false);
    expect(parseKeyInput({ name: 'a', rpm: 0 }, { partial: false }).ok).toBe(false);
    expect(parseKeyInput({ name: 'a', rpm: 1.5 }, { partial: false }).ok).toBe(false);
    expect(parseKeyInput({ name: 'a', expiresMs: 5 }, { partial: false }, 1000).ok).toBe(false);
    expect(parseKeyInput({ name: 'a', models: [1] }, { partial: false }).ok).toBe(false);
    expect(parseKeyInput({ enabled: 'yes' }, { partial: true }).ok).toBe(false);
    const p = parseKeyInput({ enabled: false }, { partial: true });
    expect(p.ok && p.value).toEqual({ enabled: false });
  });

  test('with a master key the full key can be revealed again; the database never holds it in the clear', () => {
    const db = mk();
    const master = randomBytes(32);
    const { key, record } = createKey(db, input, Date.now(), master);
    expect(record.revealable).toBe(true);
    expect(revealKey(db, record.id, master)).toBe(key);
    expect(JSON.stringify(db.query('SELECT * FROM gateway_key').all())).not.toContain(key);
    expect(revealKey(db, record.id, randomBytes(32))).toBeNull(); // wrong master key
    expect(revealKey(db, 'nope', master)).toBeNull();
  });

  test('a key created without a master key is not revealable', () => {
    const db = mk();
    const { record } = createKey(db, input);
    expect(record.revealable).toBe(false);
    expect(revealKey(db, record.id, randomBytes(32))).toBeNull();
  });

  test('ciphertext is bound to its key id', () => {
    const db = mk();
    const master = randomBytes(32);
    const a = createKey(db, input, Date.now(), master);
    const b = createKey(db, { ...input, name: 'b' }, Date.now(), master);
    const blob = (db.query('SELECT secret_enc FROM gateway_key WHERE id = ?').get(a.record.id) as any).secret_enc;
    expect(decryptSecret(master, b.record.id, blob)).toBeNull();
    expect(decryptSecret(master, a.record.id, blob)).toBe(a.key);
  });

  test('schema migration adds secret_enc to a table created before it existed', () => {
    const db = new Database(':memory:');
    db.run('CREATE TABLE gateway_key (id TEXT PRIMARY KEY, name TEXT NOT NULL, note TEXT NOT NULL DEFAULT \'\', hash TEXT NOT NULL UNIQUE, prefix TEXT NOT NULL, created_ms INTEGER NOT NULL, expires_ms INTEGER, enabled INTEGER NOT NULL DEFAULT 1, models TEXT, rpm INTEGER, concurrency INTEGER, daily_limit INTEGER, last_used_ms INTEGER, last_ip TEXT)');
    ensureGatewaySchema(db);
    const { record } = createKey(db, input, Date.now(), randomBytes(32));
    expect(record.revealable).toBe(true);
  });
});
