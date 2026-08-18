import type { AuthFile, AuthFilesResponse, ModelAliasMap, RoutingStrategy, HealthStatus } from '@antigravity-ui/shared';

const BASE = '/api';

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

export const api = {
  health: () => req<HealthStatus>('/health'),
  models: () => req<{ data: { id: string; owned_by?: string }[] }>('/models'),

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
  getLogs: () => req<any>('/mgmt/logs'),

  testModel: (model: string) =>
    req<{ ok: boolean; status: number; latency_ms: number; reply?: string; error?: string }>('/test/model', {
      method: 'POST',
      body: JSON.stringify({ model }),
    }),

  testAuthCred: (authIndex: string) =>
    req<any>('/mgmt/api-call', {
      method: 'POST',
      body: JSON.stringify({
        method: 'GET',
        url: 'https://oauth2.googleapis.com/tokeninfo',
        auth_index: authIndex,
        header: { Authorization: 'Bearer $TOKEN$' },
      }),
    }),

  usageModels: () => req<any[]>('/usage/models'),
  usageAccounts: () => req<any[]>('/usage/accounts'),
  usageRecent: () => req<any[]>('/usage/recent'),
  usageSummary: () => req<any>('/usage/summary'),
  usageCost: () => req<{ total: number; per_model: any[] }>('/usage/cost'),
  getQuota: () => req<any>('/quota'),
};
