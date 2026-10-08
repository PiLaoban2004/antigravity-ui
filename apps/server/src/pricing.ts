import pricing from '../pricing.json';
import type { ProviderGroup } from './groups';

export interface Price {
  input: number;
  output: number;
}

const MODELS = pricing.models as Record<string, Price>;
const DEFAULTS = pricing.defaults as Record<ProviderGroup, Price>;

/** Single source of truth for per-model price (USD per 1M tokens). Unlisted models use their group's default. */
export function priceFor(model: string, group: ProviderGroup): Price {
  // WorkBuddy is credit-based, not USD-billed: never let a stray table entry make it cost money.
  if (group === 'workbuddy') return DEFAULTS.workbuddy;
  return MODELS[model] ?? DEFAULTS[group];
}

export function costOf(
  tokens: { input_tokens: number; output_tokens: number; reasoning_tokens: number },
  price: Price,
): number {
  // Reasoning tokens are billed at the output rate.
  return (tokens.input_tokens * price.input + (tokens.output_tokens + tokens.reasoning_tokens) * price.output) / 1e6;
}
