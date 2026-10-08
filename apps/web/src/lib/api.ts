import type {
  AuthFile,
  AuthFilesResponse,
  ModelAliasMap,
  RoutingStrategy,
  HealthStatus,
  UsageModelBreakdown,
  UsageTimelineBucket,
  UsageTimelineResponse,
  UsageTimelineTotals,
  ProxyModel,
  AgentRouterStats,
  WorkBuddyStatus,
  WorkBuddyStats,
  WorkBuddyHealth,
  SessionInfo,
  SessionRole,
  AuditEntry,
} from '@antigravity-ui/shared';

export type {
  AuthFile,
  AuthFilesResponse,
  ModelAliasMap,
  RoutingStrategy,
  HealthStatus,
  UsageModelBreakdown,
  UsageTimelineBucket,
  UsageTimelineResponse,
  UsageTimelineTotals,
  ProxyModel,
  AgentRouterStats,
  WorkBuddyStatus,
  WorkBuddyStats,
  WorkBuddyHealth,
  SessionInfo,
  SessionRole,
  AuditEntry,
};

const BASE = '/api';

/** Fired when the server says the session is gone (remote mode); App shows the login page. */
export const UNAUTHORIZED_EVENT = 'aui:unauthorized';

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (res.status === 401 && path !== '/session') window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

export const api = {
  session: () => req<SessionInfo>('/session'),
  login: (token: string) => req<{ remote: boolean; role: SessionRole }>('/session', { method: 'POST', body: JSON.stringify({ token }) }),
  logout: () => req<{ ok: boolean }>('/session', { method: 'DELETE' }),
  health: () => req<HealthStatus>('/health'),
  models: () => req<{ data: ProxyModel[]; groups: string[] }>('/models'),

  // AgentRouter stats
  agentrouterStats: () => req<{ status: string; hasApiKey: boolean; stats: AgentRouterStats }>('/agentrouter/stats'),

  // WorkBuddy (:7863) —— 账号池 / 用量 / 账号管理
  workbuddyStatus: () => req<WorkBuddyStatus>('/workbuddy/status'),
  workbuddyStats: () => req<WorkBuddyStats>('/workbuddy/stats'),
  workbuddyAccountAction: (uid: string, action: 'disable' | 'enable' | 'revive') =>
    req<any>(`/workbuddy/accounts/${encodeURIComponent(uid)}/${action}`, { method: 'POST', body: '{}' }),

  // management proxy (raw)
  mgmt: <T = any>(path: string, init?: RequestInit) => req<T>(`/mgmt${path}`, init),

  // typed helpers
  authFiles: () => req<AuthFilesResponse>('/mgmt/auth-files'),
  authStatus: (state: string) => req<{ status: string }>(`/mgmt/get-auth-status?state=${encodeURIComponent(state)}`),
  startAuth: () => req<{ status: string; url: string; state: string }>('/mgmt/antigravity-auth-url?is_webui=true'),

  setAuthDisabled: (name: string, disabled: boolean) =>
    req('/mgmt/auth-files/status', {
      method: 'PATCH',
      body: JSON.stringify({ name, disabled }),
    }),

  deleteAuth: (name: string) => req(`/mgmt/auth-files?name=${encodeURIComponent(name)}`, { method: 'DELETE' }),

  patchAuthFields: (name: string, fields: Record<string, any>) =>
    req('/mgmt/auth-files/fields', {
      method: 'PATCH',
      body: JSON.stringify({ name, ...fields }),
    }),

  resetQuota: () => req('/mgmt/reset-quota', { method: 'POST', body: '{}' }),

  getAliases: () => req<{ 'oauth-model-alias': ModelAliasMap }>('/mgmt/oauth-model-alias'),
  patchAliases: (channel: string, aliases: any[]) =>
    req('/mgmt/oauth-model-alias', {
      method: 'PATCH',
      body: JSON.stringify({ channel, aliases }),
    }),

  getStrategy: () => req<{ strategy: RoutingStrategy }>('/mgmt/routing/strategy'),
  patchStrategy: (strategy: RoutingStrategy) =>
    req('/mgmt/routing/strategy', { method: 'PATCH', body: JSON.stringify({ value: strategy }) }),

  getConfig: () => req<any>('/mgmt/config'),
  audit: (limit = 100) => req<{ remote: boolean; rows: AuditEntry[] }>(`/audit?limit=${limit}`),
  getLogs: () => req<any>('/mgmt/logs'),

  testModel: (model: string, group?: string) =>
    req<{ ok: boolean; status: number; latency_ms: number; reply?: string; winner?: string; group?: string; error?: string }>('/test/model', {
      method: 'POST',
      body: JSON.stringify({ model, group }),
    }),

  testAuthCred: (authIndex: string) =>
    req<any>('/auth/test', {
      method: 'POST',
      body: JSON.stringify({ auth_index: authIndex }),
    }),

  usageModels: () => req<any[]>('/usage/models'),
  usageAccounts: () => req<any[]>('/usage/accounts'),
  usageRecent: () => req<any[]>('/usage/recent'),
  usageSummary: () => req<any>('/usage/summary'),
  usageCost: () => req<{ total: number; per_model: any[] }>('/usage/cost'),
  usageTimeline: (period: 'today' | '14days' | 'month' | 'all' | string = '14days', count?: number) =>
    req<UsageTimelineResponse>(`/usage/timeline?period=${period}${count ? `&count=${count}` : ''}`),
  getQuota: (email?: string) => req<any>(`/quota${email ? `?email=${encodeURIComponent(email)}` : ''}`),
};
