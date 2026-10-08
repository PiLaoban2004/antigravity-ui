import { describe, expect, test } from 'bun:test';
import { AGENTROUTER_MODELS, inferGroup } from './groups';
import { costOf, priceFor } from './pricing';

describe('priceFor', () => {
  test('listed model uses its own price, any group', () => {
    expect(priceFor('gemini-3.7-flash-high', 'antigravity')).toEqual({ input: 0.75, output: 3.75 });
  });

  test('unlisted models fall back per group, consistently', () => {
    expect(priceFor('some-new-model', 'antigravity')).toEqual({ input: 1.5, output: 9 });
    expect(priceFor('some-new-model', 'agentrouter')).toEqual({ input: 3, output: 15 });
  });

  test('workbuddy is always free', () => {
    expect(priceFor('cn:auto', 'workbuddy')).toEqual({ input: 0, output: 0 });
    expect(priceFor('gemini-3.7-flash-high', 'workbuddy')).toEqual({ input: 0, output: 0 });
  });

  test('every hardcoded AgentRouter model has an explicit price', () => {
    for (const m of AGENTROUTER_MODELS) expect(priceFor(m, 'agentrouter')).not.toBeUndefined();
  });

  test('reasoning tokens are billed as output', () => {
    const c = costOf({ input_tokens: 1_000_000, output_tokens: 500_000, reasoning_tokens: 500_000 }, { input: 1, output: 4 });
    expect(c).toBeCloseTo(5);
  });
});

describe('inferGroup', () => {
  test('account beats model name', () => {
    expect(inferGroup('gpt-6-astra', 'agentrouter')).toBe('agentrouter');
    expect(inferGroup('claude-opus-4-8', 'someone@gmail.com')).toBe('agentrouter'); // legacy list still applies
    expect(inferGroup('gemini-3.7-flash-high', 'someone@gmail.com')).toBe('antigravity');
  });

  test('workbuddy by realm prefix or account', () => {
    expect(inferGroup('global:deepseek', 'x')).toBe('workbuddy');
    expect(inferGroup('whatever', 'workbuddy')).toBe('workbuddy');
  });
});
