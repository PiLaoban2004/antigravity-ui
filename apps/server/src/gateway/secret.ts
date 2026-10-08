import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

/**
 * Keys stay viewable in the dashboard, so the database holds them encrypted (AES-256-GCM, the key id as
 * associated data so a ciphertext cannot be moved to another row). The master key lives outside the database
 * (`ANTI_UI_GATEWAY_SECRET` as 64 hex chars, or an auto-generated chmod-600 file), so a copy of usage.sqlite or
 * its backups alone does not reveal a key. Only the dashboard process needs it; the gateway verifies by hash.
 */
export function loadMasterKey(env: Record<string, string | undefined>, file: string): Buffer {
  const fromEnv = env.ANTI_UI_GATEWAY_SECRET?.trim();
  if (fromEnv) {
    if (!/^[0-9a-fA-F]{64}$/.test(fromEnv)) throw new Error('ANTI_UI_GATEWAY_SECRET must be 64 hex characters (openssl rand -hex 32)');
    return Buffer.from(fromEnv, 'hex');
  }
  if (existsSync(file)) {
    const hex = readFileSync(file, 'utf8').trim();
    if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error(`${file} is not 64 hex characters; delete it to regenerate (existing keys would become unviewable)`);
    return Buffer.from(hex, 'hex');
  }
  const key = randomBytes(32);
  writeFileSync(file, key.toString('hex') + '\n', { mode: 0o600 });
  chmodSync(file, 0o600);
  return key;
}

export function encryptSecret(master: Buffer, id: string, plaintext: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', master, iv);
  c.setAAD(Buffer.from(id));
  const ct = Buffer.concat([c.update(plaintext, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}

/** Returns null if the data is malformed, the key is wrong, or it was bound to a different id. */
export function decryptSecret(master: Buffer, id: string, blob: string): string | null {
  try {
    const raw = Buffer.from(blob, 'base64');
    const d = createDecipheriv('aes-256-gcm', master, raw.subarray(0, 12));
    d.setAAD(Buffer.from(id));
    d.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}
