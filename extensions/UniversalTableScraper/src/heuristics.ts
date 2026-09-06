/**
 * Confidence scoring for the repeated-card/list heuristic (PRD §4–5).
 *
 * There is no semantic signal here the way `<table>`/`<tr>`/`<td>` gives the
 * table path — this is genuinely best-effort. The DOM walk that turns sibling
 * elements into `CandidateItemSignature[]` lives in content.ts; everything
 * here is pure so scripts/selftest.mjs can pin the scoring behaviour,
 * including the honest-refusal path required by PRD §5: low confidence must
 * produce a plain-language reason, never a best-guess export.
 */

import { CandidateItemSignature, ListDetectionResult } from './types';

const MIN_ITEMS = 3;
const MIN_SCORE = 0.6;
const SHAPE_WEIGHT = 0.6;
const FILL_WEIGHT = 0.4;

const NOT_ENOUGH_ITEMS_REASON = 'Not enough repeated items here to treat this as a list.';
const LOW_CONFIDENCE_REASON =
  "This doesn't look like a structured list — the items differ too much to line up as columns.";

function mostCommonShape(items: CandidateItemSignature[]): { shape: string; count: number } {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.shape, (counts.get(item.shape) ?? 0) + 1);
  let best = { shape: '', count: 0 };
  for (const [shape, count] of counts) {
    if (count > best.count) best = { shape, count };
  }
  return best;
}

/**
 * Scores how confidently a set of candidate items behaves like rows of a
 * table: how many share the page's most common internal shape (structural
 * similarity), and how consistently those matching items actually have a
 * value for each candidate column (field coverage). Both matter — a set of
 * items that are structurally identical but mostly empty is just as
 * unreliable to export as a set with inconsistent structure.
 */
export function detectRepeatedList(items: CandidateItemSignature[]): ListDetectionResult {
  if (items.length < MIN_ITEMS) {
    return { confident: false, score: 0, columns: [], rows: [], reason: NOT_ENOUGH_ITEMS_REASON };
  }

  const { shape, count } = mostCommonShape(items);
  const shapeScore = count / items.length;
  const matching = items.filter(item => item.shape === shape);

  const columns: string[] = [];
  const seen = new Set<string>();
  for (const item of matching) {
    for (const key of Object.keys(item.fields)) {
      if (!seen.has(key)) {
        seen.add(key);
        columns.push(key);
      }
    }
  }

  let filled = 0;
  let total = 0;
  for (const item of matching) {
    for (const key of columns) {
      total++;
      if (item.fields[key]?.trim()) filled++;
    }
  }
  const fillScore = total ? filled / total : 0;

  const score = Math.round((shapeScore * SHAPE_WEIGHT + fillScore * FILL_WEIGHT) * 100) / 100;
  // The blended score alone can't catch a set of items that are structurally
  // identical but mostly empty (high shapeScore hides a low fillScore, and
  // vice versa) — both signals have to individually clear a floor, not just
  // average out to something plausible.
  const confident =
    score >= MIN_SCORE &&
    shapeScore >= 0.5 &&
    fillScore >= 0.5 &&
    columns.length > 0 &&
    matching.length >= MIN_ITEMS;

  const rows = matching.map(item => columns.map(key => (item.fields[key] ?? '').trim()));

  return {
    confident,
    score,
    columns: confident ? columns : [],
    rows: confident ? rows : [],
    reason: confident ? undefined : LOW_CONFIDENCE_REASON,
  };
}
