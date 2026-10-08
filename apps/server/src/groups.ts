export type ProviderGroup = 'antigravity' | 'agentrouter' | 'workbuddy';

export const PROVIDER_GROUPS: readonly ProviderGroup[] = ['antigravity', 'agentrouter', 'workbuddy'];

export function isProviderGroup(x: unknown): x is ProviderGroup {
  return typeof x === 'string' && (PROVIDER_GROUPS as readonly string[]).includes(x);
}

export const AGENTROUTER_MODELS = [
  'agentrouter-race',
  'claude-opus-4-8',
  'claude-opus-5',
  'deepseek-v4-flash',
  'glm-5.3',
  'gpt-5.6-sol',
];

/**
 * WorkBuddy 的模型 id 天然带 realm 前缀（cn: / global:），是可靠的判别特征，
 * 不像 AgentRouter 那样需要维护一份模型清单。
 */
export function isWorkBuddyModel(modelName: string): boolean {
  return modelName.startsWith('cn:') || modelName.startsWith('global:');
}

/**
 * Best-effort group for a usage row whose provider is not known from where it was recorded
 * (legacy rows, clients that did not say). The row's `account` beats the model name: the same
 * model id can be served by different providers, and AgentRouter adds models faster than the
 * hardcoded list is updated (e.g. `gpt-6-astra`).
 */
export function inferGroup(model: string, account?: string): ProviderGroup {
  if (isWorkBuddyModel(model) || account === 'workbuddy') return 'workbuddy';
  if (account === 'agentrouter' || AGENTROUTER_MODELS.includes(model)) return 'agentrouter';
  return 'antigravity';
}
