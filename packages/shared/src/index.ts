// Shared API contract between server and web.

export type ProviderGroup = 'antigravity' | 'agentrouter' | 'workbuddy';
export type ModelGroup = 'all' | ProviderGroup;

export interface AuthFile {
  id: string;
  name: string;
  account: string;
  email: string;
  provider: string;
  project_id?: string;
  status: 'active' | 'error' | 'disabled';
  disabled: boolean;
  failed: number;
  success: number;
  unavailable: boolean;
  weight?: number;
  label?: string;
  created_at?: string;
  updated_at?: string;
  status_message?: string | null;
}

export interface AuthFilesResponse {
  files: AuthFile[];
}

export interface ModelAliasEntry {
  name: string; // upstream model name
  alias: string; // client-facing alias
  displayName?: string;
  forceMapping?: boolean;
}

export type ModelAliasMap = Record<string, ModelAliasEntry[]>;

export type RoutingStrategy = 'round-robin' | 'weighted-round-robin' | 'fill-first';

export interface ModelInfo {
  id: string;
  display_name?: string;
  owned_by?: string;
  type?: string;
  group?: ProviderGroup;
}

export interface ProxyModel {
  id: string;
  object?: string;
  created?: number;
  owned_by?: string;
  group?: ProviderGroup;
  provider?: string;
  description?: string;
  endpoints?: string[];
  pricing?: {
    input: number;
    output: number;
  };
  /** WorkBuddy 专属字段：realm 分区 + 积分倍率（credits 形如 "x0.21"） */
  realm?: 'cn' | 'global';
  name?: string;
  vendor?: string;
  credits?: string | number;
  context_length?: number;
  max_output_tokens?: number;
  supports_images?: boolean;
  supports_reasoning?: boolean;
  supports_tool_call?: boolean;
  is_default?: boolean;
  tags?: string[];
}

export interface AgentRouterRaceRecord {
  id: string;
  ts: string;
  requestedModel: string;
  winner: string;
  latencyMs: number;
  isStream: boolean;
  protocol: 'openai' | 'anthropic';
  racers: string[];
  status: 'success' | 'all_failed' | 'client_aborted';
}

export interface AgentRouterStats {
  startedAt: string;
  totalRequests: number;
  totalRaces: number;
  winners: Record<string, number>;
  modelLatencies: Record<string, { count: number; totalMs: number; avgMs: number }>;
  recentRaces: AgentRouterRaceRecord[];
}

export interface AgentRouterHealth {
  ok: boolean;
  reachable: boolean;
  port: number;
  hasApiKey: boolean;
  supportedModels: string[];
  stats?: AgentRouterStats;
}

// ---- WorkBuddy (workbuddy2api, Go, :7863) ----

export interface WorkBuddyAccount {
  uid: string;
  realm: 'cn' | 'global' | string;
  nickname?: string;
  credits: number;
  cooling: boolean;
  cool_kind?: string;
  cool_remaining_sec?: number;
  until?: string;
  disabled: boolean;
  manual_disabled: boolean;
  success_count: number;
  last_success?: string;
  last_err?: string;
  consecutive_fails: number;
  degrade_until?: string;
  in_flight: number;
  breaker_fails: number;
  breaker_until?: string;
  model_costs?: Record<string, number>;
}

export interface WorkBuddyRealmTotals {
  cooling: number;
  disabled: number;
  healthy: number;
  in_flight_full: number;
  total: number;
}

export interface WorkBuddyStatus {
  accounts: WorkBuddyAccount[];
  cooling: number;
  disabled: number;
  healthy: number;
  total: number;
  in_flight_full?: number;
  realm_totals?: Record<string, WorkBuddyRealmTotals>;
  redis_mode?: string;
  sticky_sessions?: number;
}

export interface WorkBuddyHealth {
  ok: boolean;
  reachable: boolean;
  port: number;
  healthy: number;
  cooling: number;
  disabled: number;
  total: number;
  realmServable?: Record<string, boolean> | null;
  realmTotals?: Record<string, WorkBuddyRealmTotals> | null;
  models?: number;
}

export interface WorkBuddyStats {
  enabled: boolean;
  since?: string;
  now?: string;
  uptime_sec: number;
  total: {
    requests: number;
    success: number;
    failed: number;
    streaming?: number;
    input_tokens?: number;
    output_tokens?: number;
    total_tokens: number;
  };
}

export interface AntigravityHealth {
  ok: boolean;
  reachable: boolean;
  port: number;
  authCount: number;
  activeCount: number;
  errorCount: number;
  strategy: RoutingStrategy;
  models: number;
}

export interface HealthStatus {
  ok: boolean;
  proxyReachable: boolean;
  authCount: number;
  activeCount: number;
  errorCount: number;
  strategy: RoutingStrategy;
  models: number;
  groups?: {
    antigravity: AntigravityHealth;
    agentrouter: AgentRouterHealth;
    workbuddy: WorkBuddyHealth;
  };
  agentrouter?: AgentRouterHealth;
  workbuddy?: WorkBuddyHealth;
}

export interface ClientConfig {
  id: string;
  label: string;
  description: string;
  generate: (baseUrl: string) => string;
}

export interface UsageModelBreakdown {
  model?: string;
  group?: ProviderGroup;
  calls: number;
  success: number;
  failed: number;
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  total_tokens: number;
  cost: number;
}

export interface UsageTimelineBucket {
  key: string;
  label: string;
  calls: number;
  success: number;
  failed: number;
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  total_tokens: number;
  cost: number;
  models: Record<string, UsageModelBreakdown>;
}

export interface UsageTimelineTotals {
  calls: number;
  success: number;
  failed: number;
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  total_tokens: number;
  cost: number;
  per_model: UsageModelBreakdown[];
}

export type UsagePeriod = 'today' | '14days' | 'month' | 'all';

export interface UsageTimelineResponse {
  period: UsagePeriod | string;
  count: number;
  data: UsageTimelineBucket[];
  totals: UsageTimelineTotals;
}

// ---- Remote access ----
export type SessionRole = 'admin' | 'viewer';

/** GET /api/session. `remote:false` = loopback-only local mode (no login, role is always admin). */
export interface SessionInfo {
  remote: boolean;
  role: SessionRole | null;
}

export interface AuditEntry {
  ts: number;
  role: string;
  ip: string;
  ua: string;
  method: string;
  path: string;
  status: number;
}

// ---- Remote API gateway (src/gateway) ----

export interface GatewayKey {
  id: string;
  name: string;
  note: string;
  prefix: string;
  createdMs: number;
  expiresMs: number | null;
  enabled: boolean;
  /** Allowed model ids; a trailing `*` is a prefix match. null = any model. */
  models: string[] | null;
  rpm: number | null;
  concurrency: number | null;
  dailyLimit: number | null;
  lastUsedMs: number | null;
  lastIp: string | null;
  /** The dashboard can show the full key again. */
  revealable: boolean;
  requests24h: number;
}

export interface GatewayKeyInput {
  name: string;
  note?: string;
  expiresMs?: number | null;
  models?: string[] | null;
  rpm?: number | null;
  concurrency?: number | null;
  dailyLimit?: number | null;
}

export interface GatewayInfo {
  publicUrl: string | null;
  localUrl: string;
  gatewayUp: boolean;
  globalRpm: number;
  globalConcurrency: number;
  retentionDays: number;
}

export interface GatewayStats {
  sinceMs: number;
  untilMs: number;
  total: number;
  ok: number;
  upstreamErrors: number;
  rejected: number;
  latencyP50: number | null;
  latencyP95: number | null;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** Requests whose response reported usage, out of `forwarded` — tokens are best-effort. */
  tokenRows: number;
  forwarded: number;
  activeKeys: number;
  byKey: Array<{ keyId: string | null; requests: number; rejected: number; tokens: number; lastMs: number }>;
  byModel: Array<{ model: string; requests: number; tokens: number }>;
  byIp: Array<{ ip: string; country: string | null; requests: number; rejected: number; lastMs: number }>;
  byCountry: Array<{ country: string; requests: number }>;
  timeline: Array<{ t: number; requests: number; errors: number; tokens: number }>;
}

export interface GatewayLogRow {
  id: number;
  tsMs: number;
  keyId: string | null;
  keyName: string | null;
  ip: string;
  country: string | null;
  ua: string | null;
  method: string;
  path: string;
  model: string | null;
  status: number;
  latencyMs: number;
  bytes: number;
  stream: boolean;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  error: string | null;
}
