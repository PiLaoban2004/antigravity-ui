import type { Database } from 'bun:sqlite';
import type { Context, MiddlewareHandler } from 'hono';

/**
 * Who changed what, and who failed to log in — kept in the same SQLite file as usage. Records method, path
 * and status only: never bodies, query strings, tokens or cookies.
 */
export interface AuditRow {
  ts: number;
  role: string;
  ip: string;
  ua: string;
  method: string;
  path: string;
  status: number;
}

const MAX_ROWS = 5000;

export function ensureAuditSchema(db: Database) {
  db.run(`CREATE TABLE IF NOT EXISTS audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    role TEXT NOT NULL,
    ip TEXT NOT NULL,
    ua TEXT NOT NULL,
    method TEXT NOT NULL,
    path TEXT NOT NULL,
    status INTEGER NOT NULL
  )`);
}

export function recordAudit(db: Database, row: AuditRow) {
  db.query('INSERT INTO audit (ts, role, ip, ua, method, path, status) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    row.ts,
    row.role,
    row.ip.slice(0, 64),
    row.ua.slice(0, 200),
    row.method,
    row.path.slice(0, 200),
    row.status,
  );
  // Bounded: keep the newest MAX_ROWS.
  db.query('DELETE FROM audit WHERE id <= (SELECT MAX(id) FROM audit) - ?').run(MAX_ROWS);
}

export function recentAudit(db: Database, limit = 100): AuditRow[] {
  return db.query('SELECT ts, role, ip, ua, method, path, status FROM audit ORDER BY id DESC LIMIT ?').all(Math.min(Math.max(limit, 1), 500)) as AuditRow[];
}

/** Log every state-changing request and every login attempt. Reads are not logged (the UI polls constantly). */
export function createAuditMiddleware(
  db: Database,
  who: { roleOf: (c: Context) => string | null; clientIp: (c: Context) => string },
): MiddlewareHandler {
  return async (c, next) => {
    await next();
    const isLogin = c.req.path === '/api/session' && c.req.method === 'POST';
    if (!isLogin && ['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) return;
    try {
      recordAudit(db, {
        ts: Date.now(),
        role: who.roleOf(c) ?? '-',
        ip: who.clientIp(c),
        ua: c.req.header('user-agent') ?? '',
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
      });
    } catch (e) {
      console.warn('[audit] write failed:', e);
    }
  };
}
