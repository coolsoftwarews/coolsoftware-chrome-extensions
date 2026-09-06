/**
 * The hook panel — the differentiator over a plain sorter (PRD §4). For the
 * outliers currently on screen, extract what they have in common and present
 * it as observations with counts, never as advice.
 *
 * PRD §10 flags pattern-counting across ~10 videos as thin evidence and asks
 * for a minimum sample below which the panel says so rather than showing
 * noise; §7 asks that hook extraction not assume English. Both are honoured
 * here: everything below is a count over punctuation/hashtags/numbers, never
 * a grammar parse, and the panel refuses to speak below MIN_HOOK_SAMPLE.
 */

import { looksLikeNumberOpener, looksLikeQuestion } from './parse';
import { lengthBandOf, LENGTH_BAND_LABELS } from './filters';
import { HashtagObservation, HookInsights, HookResult, MIN_HOOK_SAMPLE, OutlierVideo } from './types';

/** A hashtag counts as "shared" once at least this share of outliers use it. */
const SHARED_MIN_OUTLIER_PCT = 0.5;
/** ...and it counts as "rare in the baseline" below this share there. */
const RARE_BASELINE_MAX_PCT = 0.2;

function pct(count: number, of: number): number {
  return of === 0 ? 0 : Math.round((count / of) * 100);
}

function hashtagObservations(outliers: OutlierVideo[], baseline: OutlierVideo[]): HashtagObservation[] {
  const outlierTagCounts = new Map<string, number>();
  for (const video of outliers) {
    for (const tag of video.hashtags) outlierTagCounts.set(tag, (outlierTagCounts.get(tag) ?? 0) + 1);
  }

  const baselineTagCounts = new Map<string, number>();
  for (const video of baseline) {
    for (const tag of video.hashtags) baselineTagCounts.set(tag, (baselineTagCounts.get(tag) ?? 0) + 1);
  }

  const observations: HashtagObservation[] = [];
  for (const [tag, count] of outlierTagCounts) {
    const outlierPct = pct(count, outliers.length) / 100;
    const baselinePct = pct(baselineTagCounts.get(tag) ?? 0, baseline.length) / 100;
    if (outlierPct >= SHARED_MIN_OUTLIER_PCT && baselinePct <= RARE_BASELINE_MAX_PCT) {
      observations.push({ tag, outlierCount: count, outlierPct: outlierPct * 100, baselinePct: baselinePct * 100 });
    }
  }

  return observations.sort((a, b) => b.outlierCount - a.outlierCount);
}

function lengthObservation(outliers: OutlierVideo[], baseline: OutlierVideo[]): HookInsights['lengthBand'] {
  const outlierDurations = outliers.map(v => v.durationSeconds).filter((d): d is number => d !== null);
  const baselineDurations = baseline.map(v => v.durationSeconds).filter((d): d is number => d !== null);
  // Too thin a sample of readable durations to say anything honest.
  if (outlierDurations.length < Math.min(MIN_HOOK_SAMPLE, outliers.length) || baselineDurations.length < 3) {
    return null;
  }

  const outlierBand = bandRangeLabel(outlierDurations);
  const baselineBand = bandRangeLabel(baselineDurations);
  return { outlierBand, baselineBand };
}

function bandRangeLabel(durations: number[]): string {
  const order: Array<keyof typeof LENGTH_BAND_LABELS> = ['under15', '15to30', '30to60', 'over60'];
  const bands = new Set(
    durations.map(lengthBandOf).filter((band): band is (typeof order)[number] => band !== 'all')
  );
  if (bands.size === 0) return 'unknown';
  const present = order.filter(band => bands.has(band));
  if (present.length === 1) return LENGTH_BAND_LABELS[present[0]];
  return `${LENGTH_BAND_LABELS[present[0]]}–${LENGTH_BAND_LABELS[present[present.length - 1]]}`;
}

function postingTimeObservation(outliers: OutlierVideo[]): HookInsights['postingTime'] {
  const dated = outliers.filter(v => v.postedAt !== null);
  if (dated.length < Math.min(MIN_HOOK_SAMPLE, outliers.length)) return null;

  const hourBuckets: Record<string, number> = {};
  const dayBuckets: Record<string, number> = {};
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  for (const video of dated) {
    const date = new Date(video.postedAt as number);
    const hour = String(date.getUTCHours()).padStart(2, '0');
    const day = dayNames[date.getUTCDay()];
    hourBuckets[hour] = (hourBuckets[hour] ?? 0) + 1;
    dayBuckets[day] = (dayBuckets[day] ?? 0) + 1;
  }

  return { hourBuckets, dayBuckets };
}

/**
 * Computes the hook panel for a set of outliers against the full loaded set
 * as baseline. `outliers` should already be whatever the current filters put
 * on screen (PRD §4: "for the outliers on screen").
 */
export function computeHookInsights(outliers: OutlierVideo[], baseline: OutlierVideo[]): HookResult {
  if (outliers.length < MIN_HOOK_SAMPLE) {
    return { sufficientData: false, outlierCount: outliers.length, minimumRequired: MIN_HOOK_SAMPLE };
  }

  const withCaption = outliers.filter(v => v.captionFirstLine !== null);
  const observations: string[] = [];

  if (withCaption.length > 0) {
    const questionCount = withCaption.filter(v => looksLikeQuestion(v.captionFirstLine)).length;
    if (questionCount > 0) {
      observations.push(`${questionCount} of ${withCaption.length} outliers open with a question`);
    }

    const numberCount = withCaption.filter(v => looksLikeNumberOpener(v.captionFirstLine)).length;
    if (numberCount > 0) {
      observations.push(`${numberCount} of ${withCaption.length} outliers open with a number`);
    }
  } else {
    observations.push('No captions were readable for this set — hashtags and timing only.');
  }

  const sharedHashtags = hashtagObservations(outliers, baseline);
  for (const tag of sharedHashtags.slice(0, 5)) {
    observations.push(`${tag.outlierCount} of ${outliers.length} outliers use ${tag.tag}, vs ${Math.round(tag.baselinePct)}% of the baseline`);
  }

  const lengthBand = lengthObservation(outliers, baseline);
  if (lengthBand) {
    observations.push(`Outliers here run ${lengthBand.outlierBand}; the baseline is ${lengthBand.baselineBand}`);
  }

  const postingTime = postingTimeObservation(outliers);

  return {
    sufficientData: true,
    outlierCount: outliers.length,
    observations,
    sharedHashtags,
    lengthBand,
    postingTime,
  };
}
