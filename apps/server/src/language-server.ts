/**
 * Discovery of the local Antigravity IDE's `language_server` process and its Connect-RPC endpoint.
 *
 * Works wherever `ps` and `lsof` exist (macOS, Linux); on Windows discovery simply finds nothing.
 * Every running language_server is considered (one per IDE window / account), not just the first.
 */

export interface LsProcess {
  pid: number;
  csrf: string;
  ideVersion?: string;
}

export interface LsEndpoint extends LsProcess {
  port: number;
  isHttps: boolean;
}

export interface LiveSnapshot {
  email: string;
  endpoint: LsEndpoint;
  status: any;
  quotaSummary: any;
}

const SERVICE = 'exa.language_server_pb.LanguageServerService';
const POSITIVE_TTL_MS = 30_000;
/** Remember "not running" briefly so a closed IDE does not cost a ps + lsof sweep on every poll. */
const NEGATIVE_TTL_MS = 10_000;
const FALLBACK_IDE_VERSION = '2.21.1';

/** Parse `ps -axo pid=,command=` output into language_server processes that carry a CSRF token. */
export function parseLsProcesses(psOutput: string): LsProcess[] {
  const out: LsProcess[] = [];
  for (const line of psOutput.split('\n')) {
    const m = line.match(/^\s*(\d+)\s+(.*)$/);
    if (!m) continue;
    const cmd = m[2];
    if (!cmd.includes('language_server')) continue;
    const csrf = cmd.match(/--csrf_token[=\s]+([a-f0-9-]+)/i)?.[1];
    if (!csrf) continue;
    const ideVersion = cmd.match(/--override_ide_version[=\s]+(\S+)/)?.[1];
    out.push({ pid: Number(m[1]), csrf, ideVersion });
  }
  return out;
}

export function parseListenPorts(lsofOutput: string): number[] {
  const ports = new Set<number>();
  for (const line of lsofOutput.split('\n')) {
    const m = line.match(/:(\d+)\s+\(LISTEN\)/);
    if (m) ports.add(Number(m[1]));
  }
  return [...ports];
}

async function run(cmd: string[]): Promise<string> {
  try {
    const proc = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'ignore' });
    return await new Response(proc.stdout).text();
  } catch {
    return '';
  }
}

function rpcUrl(e: { port: number; isHttps: boolean }, method: string) {
  return `${e.isHttps ? 'https' : 'http'}://127.0.0.1:${e.port}/${SERVICE}/${method}`;
}

async function rpc(e: LsEndpoint, method: string, timeoutMs: number): Promise<any | null> {
  try {
    const res = await fetch(rpcUrl(e, method), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Connect-Protocol-Version': '1',
        'X-Codeium-Csrf-Token': e.csrf,
      },
      body: JSON.stringify({
        metadata: { ideName: 'antigravity', extensionName: 'antigravity', ideVersion: e.ideVersion ?? FALLBACK_IDE_VERSION, locale: 'en' },
      }),
      tls: { rejectUnauthorized: false } as any,
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/** Find the endpoint of one process: probe each of its listening ports, https first, all in parallel. */
async function probeProcess(p: LsProcess): Promise<LsEndpoint | null> {
  const ports = parseListenPorts(await run(['lsof', '-nP', '-iTCP', '-sTCP:LISTEN', '-a', '-p', String(p.pid)]));
  const attempts = ports.flatMap((port) => [true, false].map((isHttps) => ({ ...p, port, isHttps })));
  const results = await Promise.all(
    attempts.map(async (e) => ((await rpc(e, 'GetUserStatus', 800)) ? e : null)),
  );
  // Prefer https when both schemes answer on a port.
  return results.find((e) => e?.isHttps) ?? results.find(Boolean) ?? null;
}

async function discover(): Promise<LsEndpoint[]> {
  const procs = parseLsProcesses(await run(['ps', '-axo', 'pid=,command=']));
  const found = await Promise.all(procs.map(probeProcess));
  return found.filter((e): e is LsEndpoint => e !== null);
}

let cache: { at: number; servers: LsEndpoint[] } | null = null;
let inflight: Promise<LsEndpoint[]> | null = null;

export function invalidateLanguageServers() {
  cache = null;
}

export async function getLanguageServers(): Promise<LsEndpoint[]> {
  if (cache && Date.now() - cache.at < (cache.servers.length ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS)) return cache.servers;
  // Concurrent requests share one discovery sweep.
  inflight ??= discover()
    .then((servers) => {
      cache = { at: Date.now(), servers };
      return servers;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/**
 * Live quota data from every running language server, one snapshot per signed-in account
 * (the same account open in two windows is reported once). A server that stops answering is
 * dropped from the cache so the next call rediscovers.
 */
export async function fetchLiveSnapshots(): Promise<LiveSnapshot[]> {
  const servers = await getLanguageServers();
  const snaps = await Promise.all(
    servers.map(async (endpoint): Promise<LiveSnapshot | null> => {
      const [status, quotaSummary] = await Promise.all([rpc(endpoint, 'GetUserStatus', 3000), rpc(endpoint, 'RetrieveUserQuotaSummary', 3000)]);
      if (!status && !quotaSummary) {
        invalidateLanguageServers();
        return null;
      }
      const email = status?.userStatus?.email;
      return typeof email === 'string' && email ? { email, endpoint, status, quotaSummary } : null;
    }),
  );
  const seen = new Set<string>();
  return snaps.filter((s): s is LiveSnapshot => {
    if (!s || seen.has(s.email)) return false;
    seen.add(s.email);
    return true;
  });
}
