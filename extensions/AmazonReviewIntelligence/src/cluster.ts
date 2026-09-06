/**
 * The whole "intelligence" in this product: frequent term clusters, grouped
 * by co-occurrence (PRD §4). Deliberately not sentiment AI and not an LLM —
 * every number here is a count of distinct reviews, so it is either right or
 * visibly wrong, and the reviews behind it are always attached.
 *
 * Pure — no DOM, no chrome.* — so scripts/selftest.mjs can check it directly.
 *
 * The algorithm, in order:
 *   1. Tokenize each review, drop stopwords/noise words (text.ts).
 *   2. Build 1-3 word candidate phrases from what survives, but only from
 *      tokens that were close together in the original text (PRD §7: a
 *      stop-word-heavy sentence must not glue two unrelated ideas together).
 *   3. Count each candidate once per review it appears in — never once per
 *      occurrence, or one long review dominates a theme (PRD §7).
 *   4. Drop anything below a mention floor that scales with corpus size.
 *   5. Greedily group candidates whose review-sets overlap heavily (Jaccard)
 *      into clusters — this is the "battery / charge / dies" grouping. Each
 *      cluster's count is the size of the *union* of its members' reviews,
 *      never the sum, so a review is never counted twice into one theme.
 */

import { filterTokens, isWeakModifier, tokenize } from './text';
import { ThemeCluster } from './types';

export interface ClusterableReview {
  id: string;
  text: string;
}

export interface ClusterOptions {
  /** Cap on the number of themes returned. */
  maxThemes?: number;
  /** Max raw-token distance allowed between adjacent words in a phrase. */
  maxGap?: number;
  /** Jaccard similarity (on review-id sets) required to merge two candidates. */
  mergeThreshold?: number;
  /** Absolute floor under the scaled threshold — never show something mentioned once or twice. */
  minMentionsFloor?: number;
}

const DEFAULTS: Required<ClusterOptions> = {
  maxThemes: 8,
  maxGap: 3,
  mergeThreshold: 0.35,
  minMentionsFloor: 3,
};

/** Below this many reviews in a band, clustering produces noise, not signal (PRD §7). */
export const MIN_REVIEWS_TO_CLUSTER = 20;

/** Mentions required before a candidate is even considered — scales gently with corpus size. */
export function minMentions(reviewsInBand: number, floor = DEFAULTS.minMentionsFloor): number {
  return Math.max(floor, Math.ceil(reviewsInBand / 15));
}

interface Candidate {
  key: string; // normalized n-gram, space-joined — the identity used for counting
  reviewIds: Set<string>;
  displayCounts: Map<string, number>; // raw surface form -> how often it was seen
}

function bestDisplay(candidate: Candidate): string {
  let best = '';
  let bestCount = -1;
  for (const [display, count] of [...candidate.displayCounts.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (count > bestCount) {
      best = display;
      bestCount = count;
    }
  }
  return best;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  let intersection = 0;
  for (const id of a) if (b.has(id)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function extractThemes(reviews: ClusterableReview[], options: ClusterOptions = {}): ThemeCluster[] {
  const opts = { ...DEFAULTS, ...options };
  const candidates = new Map<string, Candidate>();

  for (const review of reviews) {
    if (!review.text || !review.text.trim()) continue;
    const filtered = filterTokens(tokenize(review.text));

    for (let i = 0; i < filtered.length; i++) {
      for (let n = 1; n <= 3 && i + n <= filtered.length; n++) {
        const window = filtered.slice(i, i + n);

        let contiguous = true;
        for (let j = 1; j < window.length; j++) {
          if (window[j].idx - window[j - 1].idx > opts.maxGap) {
            contiguous = false;
            break;
          }
        }
        if (!contiguous) continue;
        if (n === 1 && isWeakModifier(window[0].raw)) continue;

        const key = window.map(t => t.norm).join(' ');
        if (!key.trim()) continue;
        const display = window.map(t => t.raw).join(' ');

        let candidate = candidates.get(key);
        if (!candidate) {
          candidate = { key, reviewIds: new Set(), displayCounts: new Map() };
          candidates.set(key, candidate);
        }
        candidate.reviewIds.add(review.id);
        candidate.displayCounts.set(display, (candidate.displayCounts.get(display) ?? 0) + 1);
      }
    }
  }

  const threshold = minMentions(reviews.length, opts.minMentionsFloor);
  const surviving = [...candidates.values()].filter(c => c.reviewIds.size >= threshold);
  // Deterministic order: most-mentioned first, ties broken by key so re-runs agree.
  surviving.sort((a, b) => b.reviewIds.size - a.reviewIds.size || (a.key < b.key ? -1 : 1));

  const clusters: Array<{ terms: Candidate[]; reviewIds: Set<string> }> = [];

  for (const candidate of surviving) {
    let target: (typeof clusters)[number] | null = null;
    let bestSim = 0;
    for (const cluster of clusters) {
      const sim = jaccard(candidate.reviewIds, cluster.reviewIds);
      if (sim > bestSim) {
        bestSim = sim;
        target = cluster;
      }
    }

    if (target && bestSim >= opts.mergeThreshold) {
      target.terms.push(candidate);
      for (const id of candidate.reviewIds) target.reviewIds.add(id);
      continue;
    }

    if (clusters.length < opts.maxThemes) {
      clusters.push({ terms: [candidate], reviewIds: new Set(candidate.reviewIds) });
    }
    // Otherwise: doesn't overlap enough with anything kept, and we're at the
    // cap — dropped rather than forced into an unrelated cluster.
  }

  const themes: ThemeCluster[] = clusters.map((cluster, i) => {
    const topTerms = [...cluster.terms]
      .sort((a, b) => b.reviewIds.size - a.reviewIds.size || (a.key < b.key ? -1 : 1))
      .slice(0, 3);
    return {
      id: `t${i}_${topTerms[0].key.replace(/\s+/g, '-')}`,
      label: topTerms.map(bestDisplay).join(' / '),
      terms: topTerms.map(t => t.key),
      count: cluster.reviewIds.size,
      reviewIds: [...cluster.reviewIds].sort(),
    };
  });

  themes.sort((a, b) => b.count - a.count || (a.label < b.label ? -1 : 1));
  return themes;
}
