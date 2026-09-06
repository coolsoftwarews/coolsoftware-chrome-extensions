/**
 * Wires the pure pieces together: apply the panel's filters, split reviews
 * into language buckets (PRD §7 — don't blend languages) and star bands, and
 * run the clusterer per band. Still pure — takes Review[], returns data — so
 * it is covered by scripts/selftest.mjs without a browser.
 */

import { extractThemes, MIN_REVIEWS_TO_CLUSTER } from './cluster';
import { AnalysisResult, Filters, LanguageBucket, ProductSnapshot, Review, ThemeBand } from './types';

export function applyFilters(reviews: Review[], filters: Filters): Review[] {
  return reviews.filter(review => {
    if (filters.starBand !== 0 && review.rating !== filters.starBand) return false;
    if (filters.verifiedOnly && !review.verified) return false;
    if (filters.keyword.trim()) {
      const needle = filters.keyword.trim().toLowerCase();
      if (!review.text.toLowerCase().includes(needle) && !review.title.toLowerCase().includes(needle)) return false;
    }
    if (filters.dateFrom && review.dateIso && review.dateIso < filters.dateFrom) return false;
    if (filters.dateTo && review.dateIso && review.dateIso > filters.dateTo) return false;
    return true;
  });
}

export function summarize(reviews: Review[]): ProductSnapshot {
  const languages: Partial<Record<LanguageBucket, number>> = {};
  let negativeCount = 0;
  let positiveCount = 0;
  let neutralCount = 0;

  for (const review of reviews) {
    languages[review.language] = (languages[review.language] ?? 0) + 1;
    if (review.rating <= 2) negativeCount++;
    else if (review.rating >= 4) positiveCount++;
    else neutralCount++;
  }

  return {
    asin: '',
    totalReviews: reviews.length,
    negativeCount,
    positiveCount,
    neutralCount,
    languages,
  };
}

/** Language buckets with at least this many reviews get their own analysis. */
const MIN_BUCKET_SIZE = 5;

/**
 * One AnalysisResult per (language bucket x band) that has enough reviews to
 * be worth showing at all. A bucket below MIN_BUCKET_SIZE is folded away
 * entirely rather than shown as an "insufficient" card nobody asked to see —
 * the PRD's insufficiency message is about the *primary* language, not every
 * stray review in a language the seller doesn't operate in.
 */
export function analyze(reviews: Review[]): AnalysisResult[] {
  const withText = reviews.filter(r => !r.mediaOnly);
  const byLanguage = new Map<LanguageBucket, Review[]>();
  for (const review of withText) {
    const list = byLanguage.get(review.language) ?? [];
    list.push(review);
    byLanguage.set(review.language, list);
  }

  const results: AnalysisResult[] = [];
  const buckets = [...byLanguage.entries()]
    .filter(([, list]) => list.length >= MIN_BUCKET_SIZE)
    .sort(([, a], [, b]) => b.length - a.length);

  for (const [language, list] of buckets) {
    for (const band of ['negative', 'praise'] as ThemeBand[]) {
      const inBand = list.filter(r => (band === 'negative' ? r.rating <= 2 : r.rating >= 4));
      const insufficient = inBand.length < MIN_REVIEWS_TO_CLUSTER;
      results.push({
        language,
        band,
        reviewsInBand: inBand.length,
        themes: insufficient ? [] : extractThemes(inBand.map(r => ({ id: r.id, text: r.text }))),
        insufficient,
      });
    }
  }

  return results;
}
