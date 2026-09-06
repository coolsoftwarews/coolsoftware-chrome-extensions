/**
 * Pure "should this be hidden" logic — no DOM, no chrome.* APIs, nothing that
 * needs a live LinkedIn session. Every function here takes a plain string (a
 * short label already read off the page by content.ts) and a toggle state,
 * and returns a boolean. This is the module scripts/selftest.mjs exercises
 * headlessly; the DOM traversal that finds these label strings on the live
 * page lives entirely in content.ts and is out of scope for unit tests (see
 * README.md's manual test checklist).
 *
 * Keeping this split (pure classification vs. DOM-bound extraction) is what
 * makes it possible to test the actual decision logic at all for a product
 * whose whole job is reading a third-party, frequently-redesigned page.
 */

export interface ToggleState {
  hidePromoted: boolean;
  hideSuggestions: boolean;
  hideTrending: boolean;
  hideAlgorithmic: boolean;
  hideReactionCounts: boolean;
  focusMode: boolean;
}

/**
 * PRD §4: declutter toggles default on; hiding reaction counts and focus
 * mode default off since both are more likely to surprise a first-time user
 * than removing ads/suggestions is.
 */
export const DEFAULT_TOGGLES: ToggleState = {
  hidePromoted: true,
  hideSuggestions: true,
  hideTrending: true,
  hideAlgorithmic: true,
  hideReactionCounts: false,
  focusMode: false,
};

export const TOGGLE_ORDER: Array<keyof ToggleState> = [
  'hidePromoted',
  'hideSuggestions',
  'hideTrending',
  'hideAlgorithmic',
  'hideReactionCounts',
  'focusMode',
];

export type HidableFeature = 'promoted' | 'suggestions' | 'trending' | 'algorithmic' | 'reactionCounts';

const TOGGLE_BY_FEATURE: Record<HidableFeature, keyof ToggleState> = {
  promoted: 'hidePromoted',
  suggestions: 'hideSuggestions',
  trending: 'hideTrending',
  algorithmic: 'hideAlgorithmic',
  reactionCounts: 'hideReactionCounts',
};

/**
 * LinkedIn ships several wordings for the same suggestion module over time
 * and across A/B variants (PRD §7) — kept as a list of known short headings,
 * matched at the start of the (normalized, trimmed) heading text rather than
 * as a substring anywhere, so a real post that happens to mention one of
 * these phrases mid-sentence is never misclassified as a module heading.
 */
const SUGGESTION_HEADINGS = [
  'people you may know',
  'add to your feed',
  'people also viewed',
  'grow your network',
  'follow to view more content',
  'suggested for you to follow',
];

const TRENDING_HEADINGS = ['linkedin news', "today's news and views", 'trending now', 'top stories', 'trending news'];

/**
 * Short annotations LinkedIn appends near a post's timestamp for a post it
 * picked algorithmically rather than one from someone the user follows.
 * LinkedIn does not expose an explicit, documented flag for this the way it
 * does for "Promoted" (PRD §5, §10) — this is the least certain of the five
 * hide features and is labelled as best-effort in the popup copy.
 */
const ALGORITHMIC_SIGNALS = [
  'suggested',
  'because you follow',
  'because you viewed',
  'recommended for you',
  'you might be interested in',
  'you may be interested',
];

function normalize(rawText: string): string {
  return rawText.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * LinkedIn marks a sponsored post with a short, standalone label — never a
 * label embedded inside a longer sentence. The length guard is what keeps a
 * real post whose *content* happens to contain the word "promoted" from ever
 * matching (a 25+ character string can't be just the label).
 */
export function isPromotedLabel(rawText: string): boolean {
  const text = normalize(rawText);
  if (!text || text.length > 24) return false;
  return /^(promoted|sponsored|ad)(\s(content|post))?$/.test(text);
}

export function isSuggestionHeading(rawText: string): boolean {
  const text = normalize(rawText);
  if (!text || text.length > 60) return false;
  return SUGGESTION_HEADINGS.some(phrase => text === phrase || text.startsWith(phrase));
}

export function isTrendingHeading(rawText: string): boolean {
  const text = normalize(rawText);
  if (!text || text.length > 60) return false;
  return TRENDING_HEADINGS.some(phrase => text === phrase || text.startsWith(phrase));
}

export function isAlgorithmicSignal(rawText: string): boolean {
  const text = normalize(rawText);
  if (!text || text.length > 80) return false;
  return ALGORITHMIC_SIGNALS.some(phrase => text.includes(phrase));
}

/**
 * The single decision point every hide operation in content.ts goes through:
 * given a feature, the short label text extracted for it, and the current
 * toggle state, should the matching node be hidden? A feature whose toggle
 * is off always returns false regardless of the label — content.ts never
 * needs to check the toggle separately before calling this.
 */
export function shouldHideByFeature(feature: HidableFeature, labelText: string, toggles: ToggleState): boolean {
  if (!toggles[TOGGLE_BY_FEATURE[feature]]) return false;
  switch (feature) {
    case 'promoted':
      return isPromotedLabel(labelText);
    case 'suggestions':
      return isSuggestionHeading(labelText);
    case 'trending':
      return isTrendingHeading(labelText);
    case 'algorithmic':
      return isAlgorithmicSignal(labelText);
    case 'reactionCounts':
      // Gating here is purely the toggle — content.ts only ever calls this
      // for a node it has already confirmed is a reaction-count element, not
      // an arbitrary one, so there is no label text to classify.
      return true;
    default:
      return false;
  }
}

export function mergeToggles(stored: Partial<ToggleState> | null | undefined): ToggleState {
  return { ...DEFAULT_TOGGLES, ...(stored ?? {}) };
}
