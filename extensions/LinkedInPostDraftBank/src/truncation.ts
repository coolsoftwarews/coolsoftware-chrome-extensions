/**
 * The "see more" cutoff marker — this product's mechanical differentiator
 * from a generic writing assistant. See PRD-35 §5 for why these numbers are
 * a documented approximation rather than a measured fact: public research
 * consistently lands in the 200-220 character range on desktop and 140-150
 * on mobile, but LinkedIn varies the real cutoff by device, viewport width
 * and app version, and changes it without announcing it. Never present this
 * as exact in any UI string that reads this module's output.
 *
 * Fully pure — no DOM, no chrome.* — so scripts/selftest.mjs covers it
 * headlessly.
 */

import { Device, TruncationLimits, TruncationResult } from './types';

/** Sourced from public research cited in PRD-35 §5, not a live LinkedIn measurement. */
export const DESKTOP_LIMITS: TruncationLimits = { charBudget: 210, lineBreakWeight: 14 };
export const MOBILE_LIMITS: TruncationLimits = { charBudget: 140, lineBreakWeight: 14 };

export function limitsFor(device: Device): TruncationLimits {
  return device === 'mobile' ? MOBILE_LIMITS : DESKTOP_LIMITS;
}

/**
 * Walks the text charging one unit of "weight" per character and an extra
 * `lineBreakWeight` for each line break (PRD §7: intentional line breaks near
 * the cutoff move the real "see more" point earlier than a plain character
 * count predicts). Returns the index the cut lands at, or null when the
 * whole text fits inside the budget.
 */
export function computeCutIndex(text: string, limits: TruncationLimits): number | null {
  let weight = 0;
  for (let i = 0; i < text.length; i++) {
    weight += text[i] === '\n' ? 1 + limits.lineBreakWeight : 1;
    if (weight > limits.charBudget) return i;
  }
  return null;
}

export function analyzeTruncation(text: string, device: Device = 'desktop'): TruncationResult {
  const limits = limitsFor(device);
  const cutIndex = computeCutIndex(text, limits);
  return {
    device,
    charBudget: limits.charBudget,
    cutIndex,
    visibleText: cutIndex === null ? text : text.slice(0, cutIndex),
    hiddenText: cutIndex === null ? '' : text.slice(cutIndex),
    truncated: cutIndex !== null,
    charCount: text.length,
  };
}

/** A short, honestly-hedged status line for the overlay — never claims certainty. */
export function truncationSummary(result: TruncationResult): string {
  if (!result.truncated) {
    const remaining = result.charBudget - result.charCount;
    return remaining <= 0
      ? `${result.charCount} characters — around where "see more" tends to appear (approximate)`
      : `${result.charCount} characters — about ${remaining} before "see more" typically appears (approximate)`;
  }
  return `${result.charCount} characters — "see more" would likely hide the rest (approximate, ${result.device})`;
}
