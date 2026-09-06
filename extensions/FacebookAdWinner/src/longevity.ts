/**
 * Longevity is the whole product (PRD §4: "an ad still running after 90 days
 * is a winner"). This file turns a start/stop date into the one number the
 * Ad Library's own UI buries, plus the badge text that surfaces it.
 */

import { AdFormat, AdStatus, ComputedAd } from './types';

const DAY_MS = 24 * 60 * 60 * 1000;

function parseIsoDate(value: string | null): Date | null {
  if (!value) return null;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Days from start to (stop date, or today if still active). Never negative —
 * a clock-skewed or same-day start reads as 0, not -1 (PRD §7: "ads with no
 * end date vs. ads stopped yesterday" must both resolve to a sane number).
 */
export function daysRunning(startDate: string | null, stopDate: string | null, now: Date = new Date()): number {
  const start = parseIsoDate(startDate);
  if (!start) return 0;
  const end = stopDate ? parseIsoDate(stopDate) ?? now : now;
  const diff = Math.round((end.getTime() - start.getTime()) / DAY_MS);
  return Math.max(0, diff);
}

const FORMAT_LABEL: Record<AdFormat, string> = {
  image: 'image',
  video: 'video',
  carousel: 'carousel',
  unknown: '',
};

/** "🏆 127 days running · 9 variants · still active" — the PRD's own example (§4). */
export function formatBadge(ad: {
  daysRunning: number;
  variantCount: number;
  status: AdStatus;
  format: AdFormat;
}): string {
  const parts = [
    `${ad.daysRunning} day${ad.daysRunning === 1 ? '' : 's'} running`,
    `${ad.variantCount} variant${ad.variantCount === 1 ? '' : 's'}`,
    ad.status === 'active' ? 'still active' : 'stopped',
  ];
  const label = FORMAT_LABEL[ad.format];
  if (label) parts.push(label);
  return `🏆 ${parts.join(' · ')}`;
}

/** Whether an ad clears the "winner" bar this product is built around. */
export function isLikelyWinner(ad: Pick<ComputedAd, 'daysRunning'>, thresholdDays = 90): boolean {
  return ad.daysRunning >= thresholdDays;
}
