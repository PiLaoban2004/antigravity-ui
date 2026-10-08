import { describe, expect, test } from 'bun:test';
import { buildQuotaGroup, formatCountdownEn, formatCountdownZh, fractionToPct, freshenQuotaSnapshot } from './quota';

const T0 = Date.parse('2026-10-08T00:00:00Z');
const at = (ms: number) => new Date(T0 + ms).toISOString();
const H = 3600_000;

describe('countdown formatting', () => {
  test('en/zh at each magnitude', () => {
    expect(formatCountdownEn(0)).toBe('fully refreshed');
    expect(formatCountdownZh(-5)).toBe('已完全刷新');
    expect(formatCountdownEn(45 * 60_000)).toBe('45 minutes');
    expect(formatCountdownEn(4 * H + 5 * 60_000)).toBe('4 hours, 5 minutes');
    expect(formatCountdownZh(4 * H + 5 * 60_000)).toBe('4 小时 5 分钟');
    expect(formatCountdownEn(6 * 24 * H + 23 * H)).toBe('6 days, 23 hours');
  });
});

describe('fractionToPct', () => {
  test('keeps unknown unknown', () => {
    expect(fractionToPct(undefined)).toBeNull();
    expect(fractionToPct(null)).toBeNull();
    expect(fractionToPct(0)).toBe(0);
    expect(fractionToPct(0.8567)).toBe(85.7);
  });
});

describe('freshenQuotaSnapshot', () => {
  const snapshot = {
    summary: {
      gemini: buildQuotaGroup(
        'Gemini Models',
        { fraction: 0.86, resetAt: at(5 * H) },
        { fraction: 0.98, resetAt: at(7 * 24 * H) },
        T0,
      ),
    },
    models: [
      { modelId: 'a', resetTime: at(5 * H), remainingFraction: 0.5, remainingPercentage: 50, isExhausted: false },
      { modelId: 'b', resetTime: at(H), remainingFraction: 0, remainingPercentage: 0, isExhausted: true },
    ],
  };

  test('builds groups with unknown windows as null', () => {
    const g = buildQuotaGroup('x', { fraction: undefined, resetAt: undefined }, { fraction: 0.5, resetAt: null }, T0);
    expect(g.fiveHourLimitRemaining).toBeNull();
    expect(g.weeklyLimitRemaining).toBe(50);
  });

  test('countdowns move with the clock instead of being replayed', () => {
    const later: any = freshenQuotaSnapshot(snapshot, T0 + 2 * H);
    expect(later.summary.gemini.fiveHourResetEn).toBe('3 hours, 0 minutes');
    expect(later.summary.gemini.fiveHourLimitRemaining).toBe(86);
    expect(later.models[0].timeRemainingEn).toBe('3 hours, 0 minutes');
  });

  test('an elapsed window drops its stale percentage', () => {
    const later: any = freshenQuotaSnapshot(snapshot, T0 + 6 * H);
    expect(later.summary.gemini.fiveHourLimitRemaining).toBeNull();
    expect(later.summary.gemini.fiveHourResetEn).toBe('fully refreshed');
    expect(later.summary.gemini.weeklyLimitRemaining).toBe(98); // weekly window still open
    expect(later.models[0].remainingPercentage).toBeNull();
    expect(later.models[1]).toMatchObject({ remainingPercentage: null, isExhausted: false });
  });

  test('does not mutate the input', () => {
    freshenQuotaSnapshot(snapshot, T0 + 6 * H);
    expect(snapshot.summary.gemini.fiveHourLimitRemaining).toBe(86);
    expect(snapshot.models[1].isExhausted).toBe(true);
  });
});
