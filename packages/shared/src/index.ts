// Shared API contract between server and web.

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
}

export interface ProxyModel {
  id: string;
  object?: string;
  created?: number;
  owned_by?: string;
}

export interface HealthStatus {
  ok: boolean;
  proxyReachable: boolean;
  authCount: number;
  activeCount: number;
  errorCount: number;
  strategy: RoutingStrategy;
  models: number;
}

export interface ClientConfig {
  id: string;
  label: string;
  description: string;
  generate: (baseUrl: string) => string;
}
