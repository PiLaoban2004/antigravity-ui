import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { decryptSecret, encryptSecret, loadMasterKey } from './secret';

describe('master key', () => {
  test('generated once into a 0600 file and reused', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gw-'));
    const file = join(dir, '.gateway-secret');
    const a = loadMasterKey({}, file);
    expect(a).toHaveLength(32);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(loadMasterKey({}, file).equals(a)).toBe(true);
    rmSync(dir, { recursive: true });
  });
  test('env overrides the file; malformed values are refused', () => {
    const hex = 'ab'.repeat(32);
    expect(loadMasterKey({ ANTI_UI_GATEWAY_SECRET: hex }, '/nonexistent/x').toString('hex')).toBe(hex);
    expect(() => loadMasterKey({ ANTI_UI_GATEWAY_SECRET: 'short' }, '/nonexistent/x')).toThrow();
    const dir = mkdtempSync(join(tmpdir(), 'gw-'));
    const file = join(dir, 's');
    writeFileSync(file, 'garbage');
    expect(() => loadMasterKey({}, file)).toThrow();
    rmSync(dir, { recursive: true });
  });
  test('tampered ciphertext fails closed', () => {
    const m = Buffer.alloc(32, 7);
    const blob = encryptSecret(m, 'id1', 'sk-secret');
    expect(decryptSecret(m, 'id1', blob)).toBe('sk-secret');
    const raw = Buffer.from(blob, 'base64');
    raw[raw.length - 1] ^= 1;
    expect(decryptSecret(m, 'id1', raw.toString('base64'))).toBeNull();
    expect(decryptSecret(m, 'id1', 'not base64!!')).toBeNull();
  });
});
