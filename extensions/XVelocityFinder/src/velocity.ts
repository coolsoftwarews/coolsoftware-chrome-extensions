/**
 * The outlier engine, applied to velocity rather than absolute totals: parse
 * the counts X shows, turn them into engagement-per-hour, and rate that
 * against the author's own recent median. Deliberately pure — no DOM, no
 * chrome.* — so scripts/selftest.mjs can check every rule headlessly. The
 * DOM-bound half (selectors.ts, scan.ts) hands this file numbers; this file
 * never reaches back into the page.
 */

import {
  AuthorBaseline,
  FilterSettings,
  MAX_BASELINE_SAMPLES,
  MIN_BASELINE_SAMPLES,
  ParsedCount,
  Post,
  RawPost,
} from './types';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** Below this age a velocity is statistically meaningless (PRD §7). */
export const TOO_NEW_MS = 5 * MINUTE_MS;

const MULTIPLIERS: Record<string, number> = { k: 1e3, m: 1e6, b: 1e9 };

/**
 * "1.2K" → { value: 1200, approx: true }, "1,234" → { value: 1234, approx: false }.
 * Never throws; an unparsable string is null so a missing count degrades to
 * "unknown" rather than a wrong number.
 */
export function parseCount(input: string | null | undefined): ParsedCount | null {
  if (!input) return null;
  const text = input.trim().toLowerCase();
  if (text === '') return null;

  const match = text.match(/^([\d.,]+)\s*([kmb])?$/);
  if (!match) return null;

  const digits = match[1];
  const suffix = match[2];
  const numeric = Number(digits.replace(/,/g, ''));
  if (!Number.isFinite(numeric)) return null;

  if (suffix) {
    return { value: Math.round(numeric * MULTIPLIERS[suffix]), approx: true };
  }
  // A bare number with a decimal point ("1.2") outside of a K/M/B suffix
  // isn't a count X ever shows; treat it as unparsable rather than truncate it.
  if (!Number.isInteger(numeric)) return null;
  return { value: numeric, approx: false };
}

/** Median of a numeric list; null for an empty list. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** "2h old", "45m old", "3d old". Caps at days — nothing in this product cares about weeks-old posts. */
export function ageLabel(ageMs: number): string {
  if (ageMs < MINUTE_MS) return 'just now';
  if (ageMs < HOUR_MS) return `${Math.floor(ageMs / MINUTE_MS)}m old`;
  if (ageMs < DAY_MS) return `${Math.floor(ageMs / HOUR_MS)}h old`;
  return `${Math.floor(ageMs / DAY_MS)}d old`;
}

/**
 * Turns a raw, DOM-derived post into the numbers the badge and filters need.
 * Any missing input (no timestamp, an unparsable count) degrades to a null
 * field rather than a wrong number or a thrown error — a parse failure must
 * disable that post's badge quietly, never break the timeline (PRD §6).
 */
export function deriveMetrics(raw: RawPost, baseline: AuthorBaseline | undefined, now = Date.now()): Post {
  const counts = [raw.likes, raw.reposts, raw.replies];
  const engagement = counts.every(c => c !== null) ? counts.reduce((sum, c) => sum + (c as ParsedCount).value, 0) : null;
  const approx = counts.some(c => c?.approx);

  const ageMs = raw.publishedAt !== null ? Math.max(now - raw.publishedAt, 0) : null;
  const tooNew = ageMs !== null && ageMs < TOO_NEW_MS;

  let velocityPerHour: number | null = null;
  if (engagement !== null && ageMs !== null && !tooNew) {
    velocityPerHour = engagement / (ageMs / HOUR_MS);
  }

  const samples = baseline?.samples ?? [];
  const baselineMedian = samples.length >= MIN_BASELINE_SAMPLES ? median(samples) : null;
  const outlierRatio =
    velocityPerHour !== null && baselineMedian !== null && baselineMedian > 0 ? velocityPerHour / baselineMedian : null;

  return { ...raw, engagement, velocityPerHour, tooNew, outlierRatio, approx, ageMs };
}

/**
 * Rolls a new observation into an author's baseline, capped at the most
 * recent MAX_BASELINE_SAMPLES. Only called with posts that produced a real
 * velocity (never "too new", never one missing a count) — a baseline built
 * from noisy inputs would make every ratio built on it noise too.
 */
export function updateBaseline(existing: AuthorBaseline | undefined, handle: string, velocity: number, now = Date.now()): AuthorBaseline {
  const samples = [...(existing?.samples ?? []), velocity].slice(-MAX_BASELINE_SAMPLES);
  return { handle, samples, updatedAt: now };
}

/* ── Badge text ──────────────────────────────────────────────────────── */

function formatVelocity(value: number): string {
  const rounded = value >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  return rounded.toLocaleString('en-US', { maximumFractionDigits: 1 });
}

function formatRatio(value: number): string {
  return `${(Math.round(value * 10) / 10).toFixed(1)}×`;
}

/**
 * `⚡ 620/h · 3.4× · 2h old` — the exact shape from PRD §4. The formula is
 * stated plainly rather than hidden (PRD §10): likes + reposts + replies,
 * per hour since posting. Approximate inputs get a `~`, per PRD §7 — round
 * abbreviated counts trip honestly rather than pretend precision.
 */
export function formatBadge(post: Post): string {
  if (post.ageMs === null) return '⚡ age unknown';
  if (post.tooNew) return `⚡ too new · ${ageLabel(post.ageMs)}`;
  if (post.velocityPerHour === null) return `⚡ ${ageLabel(post.ageMs)}`;

  const tilde = post.approx ? '~' : '';
  const parts = [`⚡ ${tilde}${formatVelocity(post.velocityPerHour)}/h`];
  if (post.outlierRatio !== null) parts.push(formatRatio(post.outlierRatio));
  parts.push(ageLabel(post.ageMs));
  return parts.join(' · ');
}

/** The tooltip text explaining the formula, so it's never hidden behind the badge alone. */
export function badgeExplainer(post: Post): string {
  const base = 'Velocity = (likes + reposts + replies) ÷ hours since posting.';
  if (post.outlierRatio === null) return `${base} No author baseline yet.`;
  return `${base} ${formatRatio(post.outlierRatio)} the author's recent median.`;
}

/* ── Filtering ───────────────────────────────────────────────────────── */

const AGE_BAND_MS: Record<Exclude<FilterSettings['ageBand'], 'any'>, number> = {
  '1h': HOUR_MS,
  '6h': 6 * HOUR_MS,
  '24h': 24 * HOUR_MS,
};

/**
 * A bound only excludes a post when the value is known, and ads are never
 * touched (PRD §7) — this function is not even called for them.
 */
export function matchesFilters(post: Post, filters: FilterSettings): boolean {
  if (filters.minVelocity !== null && (post.velocityPerHour === null || post.velocityPerHour < filters.minVelocity)) {
    return false;
  }
  if (filters.minRatio !== null && (post.outlierRatio === null || post.outlierRatio < filters.minRatio)) {
    return false;
  }
  if (filters.ageBand !== 'any') {
    if (post.ageMs === null || post.ageMs > AGE_BAND_MS[filters.ageBand]) return false;
  }
  return true;
}

/** True when any bound is actually set — drives the "N active" summary and the metrics. */
export function hasActiveFilters(filters: FilterSettings): boolean {
  return filters.minVelocity !== null || filters.minRatio !== null || filters.ageBand !== 'any';
}

/** Sort comparator for "sort a search result by velocity" (PRD §4). Missing
 * velocities always sink to the bottom rather than scattering through the list. */
export function compareByVelocity(a: Post, b: Post): number {
  if (a.velocityPerHour === null && b.velocityPerHour === null) return 0;
  if (a.velocityPerHour === null) return 1;
  if (b.velocityPerHour === null) return -1;
  return b.velocityPerHour - a.velocityPerHour;
}

/**
 * Threads (PRD §7): badge the head post, not every reply. The only reliable
 * signal available without an API is DOM adjacency — X renders a self-thread
 * as consecutive timeline entries by the same author with no repost/quote
 * wrapper between them. That is a heuristic, not a guarantee; it is
 * documented as a known limit in README.md rather than presented as exact.
 */
export function isThreadContinuation(previousAuthorHandle: string | null, currentAuthorHandle: string): boolean {
  return previousAuthorHandle !== null && previousAuthorHandle === currentAuthorHandle;
}
