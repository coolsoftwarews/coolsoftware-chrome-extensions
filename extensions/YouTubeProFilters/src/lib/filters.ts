import type { DatePreset, EnrichedResult, FilterState, ResultData, SortKey } from '../types';

const DAY_MS = 24 * 60 * 60 * 1000;

const PRESET_WINDOW_MS: Record<Exclude<DatePreset, 'any' | 'custom'>, number> = {
  '24h': DAY_MS,
  '7d': 7 * DAY_MS,
  '30d': 30 * DAY_MS,
  '90d': 90 * DAY_MS,
  '1y': 365 * DAY_MS,
};

/**
 * Derives the computed metrics. Kept separate from filtering so a result can
 * be re-derived cheaply when its channel enrichment lands, without rescanning
 * the DOM.
 */
export function deriveMetrics(
  result: ResultData,
  subscribers: number | null,
  channelMedianViews: number | null,
  now = Date.now(),
): EnrichedResult {
  let viewsPerDay: number | null = null;
  if (result.views !== null && result.publishedAt !== null && result.kind === 'video') {
    // Floor the divisor at one day: a 6-hour-old video would otherwise report
    // a views/day figure four times its real trajectory.
    const days = Math.max((now - result.publishedAt) / DAY_MS, 1);
    viewsPerDay = Math.round(result.views / days);
  }

  const outlierRatio =
    result.views !== null && channelMedianViews !== null && channelMedianViews > 0
      ? result.views / channelMedianViews
      : null;

  return { ...result, subscribers, channelMedianViews, viewsPerDay, outlierRatio };
}

/**
 * A bound only excludes a result when the value is known. An unknown value is
 * never evidence of a mismatch — hiding results because enrichment has not
 * landed yet would make the page flicker items out from under the user.
 */
function withinBounds(value: number | null, min: number | null, max: number | null): boolean {
  if (value === null) return true;
  if (min !== null && value < min) return false;
  if (max !== null && value > max) return false;
  return true;
}

function matchesDate(result: EnrichedResult, filters: FilterState, now: number): boolean {
  if (filters.datePreset === 'any') return true;
  if (result.publishedAt === null) return true;

  if (filters.datePreset === 'custom') {
    const from = filters.dateFrom ? Date.parse(`${filters.dateFrom}T00:00:00`) : null;
    const to = filters.dateTo ? Date.parse(`${filters.dateTo}T23:59:59`) : null;
    if (from !== null && Number.isFinite(from) && result.publishedAt < from) return false;
    if (to !== null && Number.isFinite(to) && result.publishedAt > to) return false;
    return true;
  }

  return result.publishedAt >= now - PRESET_WINDOW_MS[filters.datePreset];
}

export function matchesFilters(result: EnrichedResult, filters: FilterState, now = Date.now()): boolean {
  if (filters.excludeShorts && result.kind === 'short') return false;
  if (filters.excludeLive && (result.kind === 'live' || result.kind === 'upcoming')) return false;
  if (!matchesDate(result, filters, now)) return false;
  if (!withinBounds(result.views, filters.viewsMin, filters.viewsMax)) return false;
  if (!withinBounds(result.viewsPerDay, filters.vpdMin, filters.vpdMax)) return false;
  if (!withinBounds(result.subscribers, filters.subsMin, filters.subsMax)) return false;

  const durMin = filters.durationMinMinutes === null ? null : filters.durationMinMinutes * 60;
  const durMax = filters.durationMaxMinutes === null ? null : filters.durationMaxMinutes * 60;
  if (!withinBounds(result.durationSeconds, durMin, durMax)) return false;

  return true;
}

/**
 * Sort comparator. Results missing the sort key always sink to the bottom
 * rather than being scattered through the list by a null-as-zero comparison.
 */
export function compareBySort(a: EnrichedResult, b: EnrichedResult, sort: SortKey): number {
  if (sort === 'relevance') return 0;

  const value = (r: EnrichedResult): number | null => {
    switch (sort) {
      case 'vpd':
        // Live and upcoming have no meaningful velocity — never rank them.
        return r.kind === 'video' ? r.viewsPerDay : null;
      case 'views':
        return r.views;
      case 'date':
        return r.publishedAt;
      case 'outlier':
        return r.outlierRatio;
      default:
        return null;
    }
  };

  const av = value(a);
  const bv = value(b);
  if (av === null && bv === null) return 0;
  if (av === null) return 1;
  if (bv === null) return -1;
  return bv - av;
}

/** Which named filters are actually doing something — drives the metrics and the active-count chip. */
export function activeFilterKeys(filters: FilterState): string[] {
  const keys: string[] = [];
  if (filters.datePreset !== 'any') keys.push('date');
  if (filters.viewsMin !== null || filters.viewsMax !== null) keys.push('views');
  if (filters.vpdMin !== null || filters.vpdMax !== null) keys.push('vpd');
  if (filters.subsMin !== null || filters.subsMax !== null) keys.push('subs');
  if (filters.durationMinMinutes !== null || filters.durationMaxMinutes !== null) keys.push('duration');
  if (filters.excludeShorts || filters.excludeLive) keys.push('kind');
  return keys;
}

/** True when any channel-derived bound or sort is in play, so enrichment is worth running eagerly. */
export function needsEnrichment(filters: FilterState): boolean {
  return filters.subsMin !== null || filters.subsMax !== null || filters.sort === 'outlier';
}
