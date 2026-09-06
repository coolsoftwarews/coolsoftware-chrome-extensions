/**
 * Pure string parsing — no DOM, no chrome.* — so scripts/selftest.mjs can
 * check every one of these headlessly. The DOM-bound half that calls into
 * these lives in scrape.ts. Ported from XConversationSaver's parse.ts, the
 * closest sibling on this exact platform, plus one addition this product
 * needs and that one didn't: recognizing the Bookmarks page itself.
 */

/**
 * Parses X's compact count formatting — "12,345", "1.2K", "3.4M Views",
 * "1,204" from an aria-label. Returns null (not 0) when nothing usable is
 * present; a metric X didn't render should never be misrepresented as zero.
 */
export function parseCount(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/,/g, '');
  const match = cleaned.match(/([\d]+(?:\.\d+)?)\s*([kmb])?/i);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  const suffix = match[2]?.toLowerCase();
  const multiplier = suffix === 'k' ? 1_000 : suffix === 'm' ? 1_000_000 : suffix === 'b' ? 1_000_000_000 : 1;
  return Math.round(value * multiplier);
}

/** Extracts the numeric status id from a post URL or permalink path. */
export function parseStatusId(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = url.match(/\/status\/(\d+)/);
  return match ? match[1] : null;
}

/** Strips a leading "@" and lowercases, so the same person is always one key. */
export function normalizeHandle(handle: string | null | undefined): string {
  return (handle ?? '').trim().replace(/^@/, '').toLowerCase();
}

export function canonicalStatusUrl(handle: string, id: string): string {
  const normalized = normalizeHandle(handle);
  return normalized ? `https://x.com/${normalized}/status/${id}` : `https://x.com/i/status/${id}`;
}

/** Collapses accidental whitespace X's markup introduces without flattening
 *  intentional line breaks in the post's own text. */
export function cleanText(text: string | null | undefined): string {
  return (text ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** True for a tab whose content script this extension is allowed to talk to. */
export function isXUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    return /(^|\.)x\.com$/.test(parsed.hostname) || /(^|\.)twitter\.com$/.test(parsed.hostname);
  } catch {
    return false;
  }
}

/** True for X's own Bookmarks page — this is where indexing happens (PRD §5:
 *  "reads the user's own native X Bookmarks page"), narrower than isXUrl,
 *  which the panel/side-panel-enable logic uses for the whole site.
 *
 *  X later folded the dedicated `/i/bookmarks` URL into `/i/history`, a
 *  combined History page with Bookmarks and Likes as sub-tabs that share one
 *  path — so this URL-only check accepts both paths but cannot tell which
 *  tab is active on `/i/history`; that disambiguation needs the DOM and
 *  lives in scrape.ts's `isBookmarksTabActive`, which content.ts consults
 *  before indexing anything. Both old and new paths are matched here so
 *  neither URL shape regresses if X reverts or re-splits them. */
export function isBookmarksUrl(url: string | null | undefined): boolean {
  if (!isXUrl(url)) return false;
  try {
    const parsed = new URL(url as string);
    return /^\/i\/(bookmarks|history)(\/|$)/.test(parsed.pathname);
  } catch {
    return false;
  }
}

/** Splits a comma-separated tag input into normalized, deduped tags —
 *  trimmed, collapsed whitespace, case-insensitive dedupe keeping the first
 *  casing seen (PRD §4: "tag ... bookmarked posts"). */
export function parseTags(raw: string | null | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of (raw ?? '').split(',')) {
    const tag = part.trim().replace(/\s+/g, ' ');
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

export function tagsToInput(tags: string[]): string {
  return tags.join(', ');
}
