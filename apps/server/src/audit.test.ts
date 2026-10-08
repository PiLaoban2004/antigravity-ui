import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { Hono } from 'hono';
import { createAuditMiddleware, ensureAuditSchema, recentAudit, recordAudit } from './audit';

function setup() {
  const db = new Database(':memory:');
  ensureAuditSchema(db);
  const app = new Hono();
  app.use('/api/*', createAuditMiddleware(db, { roleOf: (c) => c.req.header('x-role') ?? null, clientIp: () => '9.9.9.9' }));
  app.get('/api/read', (c) => c.text('r'));
  app.delete('/api/mgmt/auth-files', (c) => c.text('d'));
  app.post('/api/session', (c) => c.json({ error: 'invalid token' }, 401));
  return { db, app };
}

describe('audit', () => {
  test('logs writes and login attempts, not reads; no query strings', async () => {
    const { db, app } = setup();
    await app.request('/api/read');
    await app.request('/api/mgmt/auth-files?name=secret@example.com', { method: 'DELETE', headers: { 'x-role': 'admin', 'user-agent': 'curl/8' } });
    await app.request('/api/session', { method: 'POST' });
    const rows = recentAudit(db);
    expect(rows.map((r) => [r.method, r.path, r.status, r.role])).toEqual([
      ['POST', '/api/session', 401, '-'],
      ['DELETE', '/api/mgmt/auth-files', 200, 'admin'],
    ]);
    expect(rows[1].ip).toBe('9.9.9.9');
    expect(JSON.stringify(rows)).not.toContain('secret@example.com');
  });

  test('is bounded', () => {
    const { db } = setup();
    for (let i = 0; i < 5100; i++) recordAudit(db, { ts: i, role: 'admin', ip: 'x', ua: '', method: 'POST', path: '/p', status: 200 });
    expect((db.query('SELECT COUNT(*) AS n FROM audit').get() as any).n).toBe(5000);
    expect(recentAudit(db, 1)[0].ts).toBe(5099);
  });
});
