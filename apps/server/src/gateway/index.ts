import { createGateway } from './proxy';
import { pruneGatewayLog } from './log';
import { openUsageDb } from '../usage-db';

// Standalone entry for the remote API gateway (its own process, deliberately without --watch so editing the
// dashboard never cuts a remote caller's stream). Run from apps/server/ so usage.sqlite resolves to the same file.
const PORT = Number(process.env.ANTI_UI_GATEWAY_PORT ?? 4311);
const BIND_HOST = process.env.ANTI_UI_GATEWAY_BIND_HOST ?? '127.0.0.1';
const UPSTREAM = process.env.ANTI_UI_PROXY_URL ?? 'http://127.0.0.1:8317';

if (!['127.0.0.1', 'localhost', '::1'].includes(BIND_HOST)) {
  throw new Error(`ANTI_UI_GATEWAY_BIND_HOST=${BIND_HOST}: the gateway is meant to sit behind a tunnel on loopback; refusing to bind elsewhere`);
}

const db = openUsageDb('usage.sqlite');
const { app, logs } = createGateway({
  db,
  upstream: UPSTREAM,
  trustedProxy: process.env.ANTI_UI_GATEWAY_TRUSTED_PROXY === '1',
  globalRpm: Number(process.env.ANTI_UI_GATEWAY_GLOBAL_RPM ?? 120),
  globalConcurrency: Number(process.env.ANTI_UI_GATEWAY_GLOBAL_CONCURRENCY ?? 4),
  maxBodyBytes: Number(process.env.ANTI_UI_GATEWAY_MAX_BODY_BYTES ?? 8 * 1024 * 1024),
});
logs.start();

const RETENTION_DAYS = Number(process.env.ANTI_UI_GATEWAY_RETENTION_DAYS ?? 90);
const prune = () => {
  const n = pruneGatewayLog(db, RETENTION_DAYS);
  if (n) console.log(`[gateway] pruned ${n} log rows older than ${RETENTION_DAYS} days`);
};
prune();
setInterval(prune, 6 * 3600_000);

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    logs.stop();
    process.exit(0);
  });
}

console.log(`[gateway] listening on ${BIND_HOST}:${PORT} -> ${UPSTREAM}`);

export default {
  port: PORT,
  hostname: BIND_HOST,
  fetch: app.fetch,
  idleTimeout: 255, // long streaming completions: Bun's default (10s) would cut a quiet stream
};
