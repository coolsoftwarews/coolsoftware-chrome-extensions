/**
 * The outlier engine — median baseline, ratio badges, sample-size honesty.
 * Pure and DOM-free so scripts/selftest.mjs can check it headlessly.
 *
 * The whole product hinges on never presenting a wrong number (PRD §5, kill
 * criteria in §9): if Pinterest doesn't expose enough readable save counts in
 * a result set, this engine refuses the ratio badge entirely rather than
 * compute a median from a handful of data points and call it representative.
 */

import { OutlierBaseline, PinBadge, PinCard } from './types';

/** Below this fraction of pins exposing a save count, the spike's go/no-go threshold (PRD §5) says the badge framing doesn't hold for this result set. */
export const MIN_USABLE_FRACTION = 0.5;

/** Below this many numeric samples, a median is noise, not a baseline. */
export const MIN_SAMPLE_SIZE = 5;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Pins eligible to inform the baseline: not promoted (PRD §7 excludes them), not idea pins (different surface, not comparable), numeric save count. */
function eligiblePool(pins: PinCard[]): PinCard[] {
  return pins.filter(p => !p.isPromoted && !p.isIdeaPin);
}

export function computeBaseline(pins: PinCard[]): OutlierBaseline {
  const pool = eligiblePool(pins);
  const withCounts = pool.filter(p => p.saveCount != null);
  const usableFraction = pool.length ? withCounts.length / pool.length : 0;
  const trustworthy = usableFraction >= MIN_USABLE_FRACTION && withCounts.length >= MIN_SAMPLE_SIZE;

  return {
    median: trustworthy ? median(withCounts.map(p => p.saveCount as number)) : null,
    sampleSize: withCounts.length,
    usableFraction,
    trustworthy,
  };
}

/**
 * One badge per pin. Promoted and idea pins are always labelled as such —
 * never scored. Everything else gets a ratio badge only when the baseline is
 * trustworthy and the pin itself has a number; otherwise it falls back to its
 * position in the loaded results, explicitly labelled as a rank so it can
 * never be mistaken for a save count (PRD §5).
 */
export function computeBadges(pins: PinCard[], baseline: OutlierBaseline): Record<string, PinBadge> {
  const badges: Record<string, PinBadge> = {};

  for (const pin of pins) {
    if (pin.isPromoted) {
      badges[pin.id] = { pinId: pin.id, kind: 'promoted', sampleSize: baseline.sampleSize };
      continue;
    }
    if (pin.isIdeaPin) {
      badges[pin.id] = { pinId: pin.id, kind: 'idea-pin', sampleSize: baseline.sampleSize };
      continue;
    }
    if (baseline.trustworthy && baseline.median != null && pin.saveCount != null) {
      badges[pin.id] = {
        pinId: pin.id,
        kind: 'ratio',
        ratio: pin.saveCount / baseline.median,
        saveCount: pin.saveCount,
        sampleSize: baseline.sampleSize,
      };
      continue;
    }
    if (pin.saveCount == null && !baseline.trustworthy) {
      badges[pin.id] = { pinId: pin.id, kind: 'rank', rank: pin.rank, sampleSize: pins.length };
      continue;
    }
    if (!baseline.trustworthy) {
      // The pin does have a number, but the sample overall can't be trusted —
      // still degrade to rank so every badge in a result set means the same thing.
      badges[pin.id] = { pinId: pin.id, kind: 'rank', rank: pin.rank, sampleSize: pins.length };
      continue;
    }
    badges[pin.id] = { pinId: pin.id, kind: 'unknown', sampleSize: baseline.sampleSize };
  }

  return badges;
}

/** Pins whose ratio badge clears a threshold — the definition of "outlier" used to feed the keyword panel (PRD §4). Falls back to top-ranked pins when the ratio badge was dropped. */
export function outlierPins(pins: PinCard[], badges: Record<string, PinBadge>, minRatio = 2): PinCard[] {
  const ratioBadged = pins.filter(p => badges[p.id]?.kind === 'ratio' && (badges[p.id].ratio ?? 0) >= minRatio);
  if (ratioBadged.length) return ratioBadged;

  // No trustworthy ratio badges at all: fall back to the top quartile of the
  // loaded rank order (Pinterest's own ordering, PRD §5) rather than produce
  // an empty keyword panel.
  const eligible = pins.filter(p => !p.isPromoted).sort((a, b) => a.rank - b.rank);
  return eligible.slice(0, Math.max(1, Math.ceil(eligible.length / 4)));
}

export function formatRatio(ratio: number): string {
  return `${ratio.toFixed(1)}×`;
}

export function formatSaveCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(count % 1_000_000 === 0 ? 0 : 1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(count % 1_000 === 0 ? 0 : 1)}K`;
  return String(count);
}
