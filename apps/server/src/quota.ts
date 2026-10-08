export function formatCountdownEn(ms: number): string {
  if (ms <= 0) return 'fully refreshed';
  const mins = Math.floor(ms / 60000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days} days, ${hours % 24} hours`;
  if (hours > 0) return `${hours} hours, ${mins % 60} minutes`;
  return `${mins} minutes`;
}

export function formatCountdownZh(ms: number): string {
  if (ms <= 0) return '已完全刷新';
  const mins = Math.floor(ms / 60000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days} 天 ${hours % 24} 小时`;
  if (hours > 0) return `${hours} 小时 ${mins % 60} 分钟`;
  return `${mins} 分钟`;
}

/** Bump when the shape written by saveQuotaCache changes; older snapshots are then treated as a miss. */
export const QUOTA_CACHE_VERSION = 2;
export const QUOTA_CACHE_MAX_AGE_MS = 12 * 3600 * 1000;

export type QuotaWindow = 'fiveHour' | 'weekly';
export const QUOTA_WINDOWS: QuotaWindow[] = ['fiveHour', 'weekly'];

/** Percentage (one decimal) from a 0..1 fraction; `null` means "we do not know", never "full". */
export function fractionToPct(fraction: number | null | undefined): number | null {
  return typeof fraction === 'number' ? Math.round(fraction * 1000) / 10 : null;
}

function msUntil(resetAt: string | null | undefined, now: number): number {
  const t = resetAt ? Date.parse(resetAt) : NaN;
  return Number.isNaN(t) ? 0 : Math.max(0, t - now);
}

export type WindowFields<W extends QuotaWindow> = {
  [K in `${W}LimitRemaining`]: number | null;
} & { [K in `${W}ResetAt`]: string | null } & { [K in `${W}ResetEn` | `${W}ResetZh`]: string };

/** The fields one quota window contributes to a summary group. `resetAt` is kept so a cached copy can be re-aged. */
function windowFields<W extends QuotaWindow>(
  w: W,
  pct: number | null,
  resetAt: string | null | undefined,
  now: number,
): WindowFields<W> {
  const left = msUntil(resetAt, now);
  return {
    [`${w}LimitRemaining`]: pct,
    [`${w}ResetAt`]: resetAt ?? null,
    [`${w}ResetEn`]: formatCountdownEn(left),
    [`${w}ResetZh`]: formatCountdownZh(left),
  } as WindowFields<W>;
}

export interface WindowInput {
  fraction: number | null | undefined;
  resetAt: string | null | undefined;
}

export function buildQuotaGroup(
  title: string,
  fiveHour: WindowInput,
  weekly: WindowInput,
  now: number,
): { title: string } & WindowFields<'fiveHour'> & WindowFields<'weekly'> {
  return {
    title,
    ...windowFields('fiveHour', fractionToPct(fiveHour.fraction), fiveHour.resetAt, now),
    ...windowFields('weekly', fractionToPct(weekly.fraction), weekly.resetAt, now),
  };
}

/**
 * Re-age a stored snapshot against `now` (pure; returns a copy).
 *
 * The snapshot only knows what the quota looked like when it was taken. Countdowns are recomputed from the
 * stored reset timestamps. Once a window's reset time has passed, the stored percentage no longer describes
 * anything real (usage since then is unknown), so it becomes `null` instead of being replayed.
 */
export function freshenQuotaSnapshot<T extends Record<string, any>>(snapshot: T, now: number): T {
  const out: any = { ...snapshot };

  if (snapshot.summary) {
    out.summary = {};
    for (const [groupKey, group] of Object.entries<any>(snapshot.summary)) {
      const next = { ...group };
      for (const w of QUOTA_WINDOWS) {
        const resetAt: string | null | undefined = group[`${w}ResetAt`];
        const elapsed = resetAt != null && !Number.isNaN(Date.parse(resetAt)) && Date.parse(resetAt) <= now;
        Object.assign(next, windowFields(w, elapsed ? null : (group[`${w}LimitRemaining`] ?? null), resetAt, now));
      }
      out.summary[groupKey] = next;
    }
  }

  if (Array.isArray(snapshot.models)) {
    out.models = snapshot.models.map((m: any) => {
      const left = msUntil(m.resetTime, now);
      const elapsed = m.resetTime != null && !Number.isNaN(Date.parse(m.resetTime)) && Date.parse(m.resetTime) <= now;
      return {
        ...m,
        ...(elapsed ? { remainingFraction: null, remainingPercentage: null, isExhausted: false } : {}),
        timeRemainingEn: formatCountdownEn(left),
        timeRemainingZh: formatCountdownZh(left),
      };
    });
  }

  return out;
}
