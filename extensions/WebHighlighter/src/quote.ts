/**
 * Text-quote anchoring — the part of this extension that decides whether it
 * feels solid or broken (PRD §7).
 *
 * A highlight is stored as the quoted text plus a short prefix and suffix, and
 * re-found next visit by searching the page's text. Nothing here touches the
 * DOM: it is all string work over the page's flattened text, which is what
 * makes it testable without a browser (scripts/selftest.mjs).
 *
 * Three passes, cheapest first:
 *   1. exact substring match, disambiguated by prefix/suffix and position
 *   2. whitespace-insensitive match (sites reflow, minify and re-indent text)
 *   3. head/tail match — the quote's first and last few characters, with the
 *      middle allowed to have drifted (an edit, an inserted link, a footnote)
 *
 * A miss returns null, and a null must never mean "delete the highlight".
 */

export const CONTEXT_LENGTH = 32;

export interface QuoteSelector {
  exact: string;
  prefix: string;
  suffix: string;
  /** Character offset at capture time. Tiebreaker only — never a requirement. */
  hint: number;
}

export interface QuoteMatch {
  start: number;
  end: number;
  /** 0–1. Below ~0.5 the match came from the fuzzy pass. */
  score: number;
  pass: 'exact' | 'whitespace' | 'fuzzy';
}

/** Builds the stored selector for a span of the page's flattened text. */
export function describeQuote(text: string, start: number, end: number): QuoteSelector {
  return {
    exact: text.slice(start, end),
    prefix: text.slice(Math.max(0, start - CONTEXT_LENGTH), start),
    suffix: text.slice(end, Math.min(text.length, end + CONTEXT_LENGTH)),
    hint: start,
  };
}

/* ── Whitespace-normalized view ──────────────────────────────────────── */

interface NormalizedText {
  text: string;
  /** map[i] = index in the original string of normalized character i. */
  map: number[];
}

/**
 * Collapses every run of whitespace to a single space and lowercases, keeping
 * an index map back to the original. Lowercasing is safe here because the
 * fallback passes only need to *locate* the quote — the text that gets
 * highlighted always comes from the live page, not from storage.
 */
function normalize(text: string): NormalizedText {
  let out = '';
  const map: number[] = [];
  let pendingSpace = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (/\s/.test(ch)) {
      pendingSpace = out.length > 0;
      continue;
    }
    if (pendingSpace) {
      out += ' ';
      map.push(i);
      pendingSpace = false;
    }
    out += ch.toLowerCase();
    map.push(i);
  }

  return { text: out, map };
}

/** Maps a span in normalized coordinates back onto the original string. */
function denormalize(norm: NormalizedText, original: string, start: number, end: number): [number, number] {
  const from = norm.map[start];
  const lastIndex = norm.map[end - 1];
  // The last normalized character may stand for a collapsed space run; walk to
  // the end of the original character it came from.
  const to = Math.min(original.length, lastIndex + 1);
  return [from, to];
}

/* ── Scoring ─────────────────────────────────────────────────────────── */

function commonSuffixLength(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}

function commonPrefixLength(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

/**
 * How well a candidate position agrees with the stored context. Context is
 * worth far more than the position hint: a page that re-orders its sections
 * still surrounds the sentence with the same words.
 */
function scoreCandidate(text: string, start: number, end: number, selector: QuoteSelector): number {
  const before = text.slice(Math.max(0, start - CONTEXT_LENGTH), start);
  const after = text.slice(end, end + CONTEXT_LENGTH);

  const prefixScore = selector.prefix ? commonSuffixLength(before, selector.prefix) / selector.prefix.length : 1;
  const suffixScore = selector.suffix ? commonPrefixLength(after, selector.suffix) / selector.suffix.length : 1;

  // Position agreement decays over ~4000 characters, so it can break a tie
  // between two identical sentences without ever outvoting the context.
  const drift = Math.abs(start - selector.hint);
  const hintScore = 1 / (1 + drift / 4000);

  return prefixScore * 0.45 + suffixScore * 0.45 + hintScore * 0.1;
}

function allIndexes(haystack: string, needle: string, limit = 200): number[] {
  const out: number[] = [];
  if (!needle) return out;
  let from = 0;
  while (out.length < limit) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) break;
    out.push(at);
    from = at + 1;
  }
  return out;
}

/* ── The three passes ────────────────────────────────────────────────── */

function exactPass(text: string, selector: QuoteSelector): QuoteMatch | null {
  const hits = allIndexes(text, selector.exact);
  if (!hits.length) return null;

  let best = hits[0];
  let bestScore = -1;
  for (const at of hits) {
    const score = scoreCandidate(text, at, at + selector.exact.length, selector);
    if (score > bestScore) {
      bestScore = score;
      best = at;
    }
  }

  return { start: best, end: best + selector.exact.length, score: bestScore, pass: 'exact' };
}

function whitespacePass(text: string, selector: QuoteSelector): QuoteMatch | null {
  const norm = normalize(text);
  const needle = normalize(selector.exact).text;
  if (!needle) return null;

  const hits = allIndexes(norm.text, needle);
  if (!hits.length) return null;

  const normPrefix = normalize(selector.prefix).text;
  const normSuffix = normalize(selector.suffix).text;
  const normHint = { ...selector, prefix: normPrefix, suffix: normSuffix, exact: needle };

  let best = hits[0];
  let bestScore = -1;
  for (const at of hits) {
    const score = scoreCandidate(norm.text, at, at + needle.length, normHint);
    if (score > bestScore) {
      bestScore = score;
      best = at;
    }
  }

  const [start, end] = denormalize(norm, text, best, best + needle.length);
  return { start, end, score: bestScore * 0.9, pass: 'whitespace' };
}

const FUZZY_ANCHOR_LENGTH = 24;
const FUZZY_MIN_QUOTE_LENGTH = 40;

/**
 * Last resort: find the quote's opening and closing runs and accept whatever
 * sits between them, as long as the span hasn't ballooned. Restores a
 * highlight over an edited paragraph — deliberately conservative, because a
 * mark on the wrong sentence is worse than an honest "couldn't locate".
 */
function fuzzyPass(text: string, selector: QuoteSelector): QuoteMatch | null {
  const norm = normalize(text);
  const needle = normalize(selector.exact).text;
  if (needle.length < FUZZY_MIN_QUOTE_LENGTH) return null;

  const head = needle.slice(0, FUZZY_ANCHOR_LENGTH);
  const tail = needle.slice(-FUZZY_ANCHOR_LENGTH);

  const maxSpan = Math.round(needle.length * 1.6) + 40;
  let best: QuoteMatch | null = null;

  for (const headAt of allIndexes(norm.text, head, 40)) {
    const searchEnd = Math.min(norm.text.length, headAt + maxSpan);
    const tailAt = norm.text.slice(headAt, searchEnd).lastIndexOf(tail);
    if (tailAt === -1) continue;

    const endNorm = headAt + tailAt + tail.length;
    const span = endNorm - headAt;
    if (span < needle.length * 0.5) continue;

    const [start, end] = denormalize(norm, text, headAt, endNorm);
    // Halved, so a fuzzy hit can never outrank a real one.
    const score = scoreCandidate(norm.text, headAt, endNorm, selector) * 0.5;
    if (!best || score > best.score) best = { start, end, score, pass: 'fuzzy' };
  }

  return best;
}

/**
 * Re-finds a stored quote in the page's current text.
 * Returns null when it genuinely isn't there — the caller must keep the
 * highlight and its note, and say so in the panel.
 */
export function findQuote(text: string, selector: QuoteSelector): QuoteMatch | null {
  if (!selector.exact) return null;
  return exactPass(text, selector) ?? whitespacePass(text, selector) ?? fuzzyPass(text, selector);
}
