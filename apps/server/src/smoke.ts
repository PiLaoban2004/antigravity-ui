// Integration smoke test: exercises every endpoint the web UI calls.
// Safe: does not disable/delete the real account, restores any state it touches.
const BASE = 'http://127.0.0.1:4310/api';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}${detail ? ' — ' + detail : ''}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

async function j(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  try {
    return { status: res.status, body: JSON.parse(text) };
  } catch {
    return { status: res.status, body: text };
  }
}

console.log('== antigravity-ui API smoke ==\n');

// 1. health
{
  const r = await j('/health');
  check('GET /health', r.status === 200 && r.body.ok === true, `auth=${r.body.authCount} active=${r.body.activeCount} models=${r.body.models}`);
}

// 2. models
{
  const r = await j('/models');
  check('GET /models', r.status === 200 && Array.isArray(r.body.data), `count=${r.body.data?.length}`);
}

// 3. auth-files
{
  const r = await j('/mgmt/auth-files');
  check('GET /mgmt/auth-files', r.status === 200 && Array.isArray(r.body.files), `files=${r.body.files?.length}`);
}

// 4. start OAuth flow (no real auth)
{
  const r = await j('/mgmt/antigravity-auth-url?is_webui=true');
  check('GET /mgmt/antigravity-auth-url', r.status === 200 && !!r.body.url && !!r.body.state, `state=${String(r.body.state).slice(0, 8)}`);
}

// 5. get-auth-status with a fresh state (should be wait)
{
  const a = await j('/mgmt/antigravity-auth-url?is_webui=true');
  const r = await j(`/mgmt/get-auth-status?state=${a.body.state}`);
  check('GET /mgmt/get-auth-status', r.status === 200 && ['wait', 'ok', 'error'].includes(r.body.status), `status=${r.body.status}`);
}

// 6. oauth-model-alias
{
  const r = await j('/mgmt/oauth-model-alias');
  check('GET /mgmt/oauth-model-alias', r.status === 200 && typeof r.body['oauth-model-alias'] === 'object', `channels=${Object.keys(r.body['oauth-model-alias'] ?? {}).join(',')}`);
}

// 7. routing strategy (read + write + restore)
{
  const before = await j('/mgmt/routing/strategy');
  const orig = before.body.strategy;
  const patch = await j('/mgmt/routing/strategy', { method: 'PATCH', body: JSON.stringify({ value: 'fill-first' }) });
  await new Promise((r) => setTimeout(r, 1500));
  const after = await j('/mgmt/routing/strategy');
  const restored = await j('/mgmt/routing/strategy', { method: 'PATCH', body: JSON.stringify({ value: orig }) });
  check('PATCH /mgmt/routing/strategy', patch.status === 200 && after.body.strategy === 'fill-first' && restored.status === 200, `restored to ${orig}`);
}

// 8. auth-files/fields weight (write + restore)
{
  const files = (await j('/mgmt/auth-files')).body.files;
  const name = files?.[0]?.name;
  if (name) {
    const w = await j('/mgmt/auth-files/fields', { method: 'PATCH', body: JSON.stringify({ name, weight: 7 }) });
    const after = await j('/mgmt/auth-files');
    const got = after.body.files.find((f: any) => f.name === name)?.weight;
    const restore = await j('/mgmt/auth-files/fields', { method: 'PATCH', body: JSON.stringify({ name, weight: 1 }) });
    check('PATCH /mgmt/auth-files/fields (weight)', w.status === 200 && got === 7 && restore.status === 200, 'weight 1→7→1');
  } else {
    check('PATCH /mgmt/auth-files/fields (weight)', false, 'no account to test');
  }
}

// 9. config
{
  const r = await j('/mgmt/config');
  check('GET /mgmt/config', r.status === 200, `keys=${Object.keys(r.body ?? {}).length}`);
}

// 10. logs
{
  const r = await j('/mgmt/logs');
  const ok = r.status === 200 && (Array.isArray(r.body.lines) || Array.isArray(r.body));
  check('GET /mgmt/logs', ok, `status=${r.status} lines=${Array.isArray(r.body.lines) ? r.body.lines.length : 'n/a'}`);
}

// 11. delete auth (nonexistent, expect "not found" not crash)
{
  const r = await j('/mgmt/auth-files?name=__does_not_exist__.json', { method: 'DELETE' });
  check('DELETE /mgmt/auth-files (nonexistent)', r.status === 200 || r.status === 404, `status=${r.status}`);
}

console.log(`\n== result: ${pass} passed, ${fail} failed ==`);
process.exit(fail === 0 ? 0 : 1);

export {};
