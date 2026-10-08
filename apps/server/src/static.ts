import { existsSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import type { Context } from 'hono';

/** Everything the built UI loads is same-origin; nothing may frame it or be loaded from elsewhere. */
export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join('; ');

/**
 * Serves the built web UI (apps/web/dist) with an SPA fallback, so one origin carries both the UI and /api
 * (no CORS, first-party cookie, relative SSE). Returns null when there is no build — dev uses Vite instead.
 */
export function createStaticHandler(distDir: string): ((c: Context) => Promise<Response>) | null {
  const root = resolve(distDir);
  if (!existsSync(join(root, 'index.html'))) return null;

  return async (c) => {
    if (c.req.path.startsWith('/api/')) return c.json({ error: 'not found' }, 404);

    let rel: string;
    try {
      rel = decodeURIComponent(c.req.path);
    } catch {
      return c.text('bad request', 400);
    }
    const target = resolve(root, '.' + (rel.startsWith('/') ? rel : `/${rel}`));
    // Never leave dist/ (`..`, encoded slashes, absolute paths).
    const inside = target === root || target.startsWith(root + sep);

    const file = inside && !rel.endsWith('/') ? Bun.file(target) : null;
    if (file && (await file.exists())) {
      const immutable = rel.startsWith('/assets/'); // vite fingerprints these
      return new Response(file, {
        headers: { 'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache', 'X-Content-Type-Options': 'nosniff' },
      });
    }

    // A missing asset must 404, not turn into index.html (which hides broken deploys behind a blank page).
    if (/\.[a-z0-9]{1,8}$/i.test(rel)) return c.text('not found', 404);

    return new Response(Bun.file(join(root, 'index.html')), {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache',
        'Content-Security-Policy': CSP,
        'X-Frame-Options': 'DENY',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
      },
    });
  };
}
