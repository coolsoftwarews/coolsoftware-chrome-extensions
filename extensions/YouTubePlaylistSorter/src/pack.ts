/**
 * "Build a set that fits N minutes" — PRD §4's greedy quick filter.
 *
 * Greedy-by-shortest-first: sort candidates ascending by duration, add each
 * one that still fits under the remaining budget, skip (don't stop at) ones
 * that don't. This maximizes how many videos fit rather than optimizing for
 * exact-fill, which is the right trade for "give me enough for my commute"
 * rather than a bin-packing puzzle. Pure — no DOM, no chrome.*.
 */

import { PlaylistRow } from './types';

export interface PackResult {
  budgetSeconds: number;
  /** Rows chosen, in the order they were added (shortest-first). */
  included: PlaylistRow[];
  totalSeconds: number;
  /** Rows that would fit duration-wise but were skipped once the budget ran out. */
  excludedOverBudget: PlaylistRow[];
  /** Rows with no readable duration, or marked unavailable — never guessed into the set. */
  excludedUnusable: PlaylistRow[];
}

export function greedyPackToFit(rows: PlaylistRow[], budgetMinutes: number): PackResult {
  const budgetSeconds = Math.max(0, Math.round(budgetMinutes * 60));

  const withDuration = rows.filter((r) => r.durationSeconds !== null && !r.unavailable);
  const excludedUnusable = rows.filter((r) => r.durationSeconds === null || r.unavailable);

  const candidates = [...withDuration].sort(
    (a, b) => (a.durationSeconds as number) - (b.durationSeconds as number),
  );

  const included: PlaylistRow[] = [];
  const excludedOverBudget: PlaylistRow[] = [];
  let totalSeconds = 0;

  for (const row of candidates) {
    const duration = row.durationSeconds as number;
    if (totalSeconds + duration <= budgetSeconds) {
      included.push(row);
      totalSeconds += duration;
    } else {
      excludedOverBudget.push(row);
    }
  }

  // Report both back in the playlist's own position order — "what did we
  // include/exclude" reads more usefully that way than shortest-first.
  included.sort((a, b) => a.position - b.position);
  excludedOverBudget.sort((a, b) => a.position - b.position);

  return { budgetSeconds, included, totalSeconds, excludedOverBudget, excludedUnusable };
}
