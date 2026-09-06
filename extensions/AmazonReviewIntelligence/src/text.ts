/**
 * Tokenizing, stopwords and a light stemmer. Pure string logic — no DOM, no
 * chrome.* — so scripts/selftest.mjs can check it headlessly.
 *
 * The stemmer is deliberately crude (strip a handful of common English
 * suffixes) rather than a real algorithm: it only has to make "battery" and
 * "batteries" collide for counting purposes. The *display* label always comes
 * from the most common raw surface form seen (see cluster.ts), so an
 * imperfect stem never leaks into the panel.
 */

/** Standard English stopwords. Kept generic on purpose — see NOISE_WORDS below
 * for the Amazon-specific terms the PRD calls out by name (§7). */
const STOPWORDS = new Set(
  (
    "a about above after again against all am an and any are aren't as at be because been before being below " +
    "between both but by can't cannot could couldn't did didn't do does doesn't doing don't down during each few " +
    "for from further had hadn't has hasn't have haven't having he he'd he'll he's her here here's hers herself " +
    "him himself his how how's i i'd i'll i'm i've if in into is isn't it it's its itself let's me more most " +
    "mustn't my myself no nor not of off on once only or other ought our ours ourselves out over own same shan't " +
    "she she'd she'll she's should shouldn't so some such than that that's the their theirs them themselves then " +
    "there there's these they they'd they'll they're they've this those through to under until up very was " +
    "wasn't we we'd we'll we're we've were weren't what what's when when's where where's which while who who's " +
    "whom why why's will with won't would wouldn't you you'd you'll you're you've your yours yourself yourselves"
  ).split(' ')
);

/** Amazon-review noise: words that describe the act of reviewing, not the
 * product, and would otherwise dominate every cluster (PRD §7: "product",
 * "amazon", "item" must not become themes). */
const NOISE_WORDS = new Set(
  (
    'amazon amazons product products item items order ordered ordering purchase purchased purchasing star stars ' +
    'review reviews reviewed reviewer one two three get got getting really also thing things im ive dont didnt ' +
    "wasnt isnt thats youre well much many just ok okay yes lot bit"
  ).split(' ')
);

/** Meaningful only as a modifier inside a phrase ("too small"), never as a
 * theme on their own — an unqualified "too" or "very" says nothing. */
const WEAK_MODIFIERS = new Set('too very so quite pretty kind sort rather fairly extremely somewhat'.split(' '));

export interface Token {
  /** Normalized (lowercased, stemmed) form used for counting and matching. */
  norm: string;
  /** Lowercased surface form, used to pick a display label. */
  raw: string;
  /** Position in the raw token stream — used to keep n-grams grammatically close. */
  idx: number;
}

/** Splits on Unicode letters/digits/apostrophes; drops everything else. */
export function tokenizeRaw(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+(?:'[\p{L}]+)?/gu) ?? []).map(t => t.replace(/'s$/, ''));
}

/** Crude suffix-stripping stemmer. See file header for why this is enough. */
export function stem(word: string): string {
  if (word.length > 5 && word.endsWith('ies')) return word.slice(0, -3) + 'y';
  if (word.length > 5 && word.endsWith('ing')) return word.slice(0, -3);
  if (word.length > 4 && word.endsWith('ed')) return word.slice(0, -2);
  if (word.length > 4 && word.endsWith('es') && !word.endsWith('ses')) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  // A base form ending in a silent "e" (charge, close, use) must land on the
  // same stem as its "-ing"/"-ed"/"-es" inflections, which the rules above
  // already strip the "e" from (charging/charged/charges -> "charg"). Without
  // this, "charge" and "charging" would never cluster together.
  if (word.length > 4 && word.endsWith('e') && !word.endsWith('ee')) return word.slice(0, -1);
  return word;
}

export function isStopword(word: string): boolean {
  return STOPWORDS.has(word) || NOISE_WORDS.has(word);
}

export function isWeakModifier(word: string): boolean {
  return WEAK_MODIFIERS.has(word);
}

/** Full pipeline: raw text -> tokens with idx preserved for gap checks. */
export function tokenize(text: string): Token[] {
  return tokenizeRaw(text).map((raw, idx) => ({ raw, norm: stem(raw), idx }));
}

/** Drops stopwords, noise words and anything too short or purely numeric. */
export function filterTokens(tokens: Token[]): Token[] {
  return tokens.filter(t => t.raw.length >= 2 && !/^\d+$/.test(t.raw) && !isStopword(t.raw));
}
