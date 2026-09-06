/**
 * Facebook group DOM extraction — the hostile half (PRD §5: "Facebook's DOM
 * is hostile and obfuscated. Expect breakage... degrade to 'highlighting
 * unavailable' rather than mangling someone's feed").
 *
 * Facebook ships no stable class names, but it does keep a handful of
 * semantic anchors for accessibility that survive far more rewrites than the
 * class soup around them: `[role="article"]` for a feed post, `<abbr>` for
 * the relative timestamp, and permalink URLs that always contain `/posts/`,
 * `/permalink/` or `story_fbid=`. Everything below is built on those, with
 * plain-text fallbacks, and every function is written to return "unknown"
 * cleanly rather than guess wrong.
 *
 * Text-only helpers are exported separately from the DOM-walking ones so the
 * string logic (comment-count parsing, permalink detection, truncation,
 * title cleanup) can be unit tested without a browser — see
 * scripts/selftest.mjs. The DOM-bound half needs a real Facebook group and is
 * covered by the manual checklist in README.md instead.
 */

import { MAX_CARD_TEXT_LENGTH } from './types';

/* ── Pure text helpers (unit tested) ────────────────────────────────────── */

const COMMENT_PATTERN = /(\d[\d,]*)\s*(?:comments?|Comments?)\b/;

/** Reads a comment count out of a label like "12 comments" or "1 Comment". */
export function parseCommentCount(text: string): number | null {
  const match = text.match(COMMENT_PATTERN);
  if (!match) return null;
  const n = Number(match[1].replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

const PERMALINK_PATTERN = /\/(posts|permalink|permalink\.php)\/|story_fbid=|multi_permalinks=/i;

/**
 * True for a facebook.com href that plausibly points at one specific post,
 * not the feed. Requires the facebook.com host too — a post's own text can
 * legitimately contain a link to someone else's `/posts/123` on an unrelated
 * site, and that must never be mistaken for this post's permalink.
 */
export function isPermalinkHref(href: string): boolean {
  try {
    const url = new URL(href);
    if (!/(^|\.)facebook\.com$/i.test(url.hostname)) return false;
  } catch {
    return false;
  }
  return PERMALINK_PATTERN.test(href);
}

/** "Bookkeepers of North Texas | Facebook" → "Bookkeepers of North Texas". */
export function cleanGroupName(rawTitle: string): string {
  return rawTitle
    .replace(/\s*[|–-]\s*Facebook\s*$/i, '')
    .trim()
    .slice(0, 160);
}

const NON_NAME_STRINGS = new Set([
  'like',
  'comment',
  'share',
  'see more',
  'see less',
  'join group',
  'follow',
  'message',
  'add friend',
  'most relevant',
  'write a comment',
  'top contributor',
]);

/** Filters out UI chrome text that sits near a post's byline but isn't a name. */
export function looksLikeAuthorName(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 2 || trimmed.length > 100) return false;
  if (NON_NAME_STRINGS.has(trimmed.toLowerCase())) return false;
  if (/^\d+$/.test(trimmed)) return false;
  return true;
}

/** Card display copy: full text kept in storage, this only shortens the card. */
export function truncateForCard(text: string, max = MAX_CARD_TEXT_LENGTH): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  const cut = trimmed.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${cut.slice(0, lastSpace > max * 0.6 ? lastSpace : max)}…`;
}

/* ── DOM extraction (needs a browser; manual checklist in README) ────────── */

export interface ExtractedPost {
  author: string;
  text: string;
  postUrl: string | null;
  commentCount: number | null;
  postedAt: string | null;
}

/** Best-effort group name for the current tab: page header, else document title. */
export function readGroupContext(): { groupName: string; groupUrl: string | null } {
  const heading = document.querySelector('h1');
  const headingText = heading?.textContent?.trim();
  const groupName = headingText && headingText.length > 1 ? headingText : cleanGroupName(document.title);

  const match = location.pathname.match(/^\/groups\/([^/]+)/);
  const groupUrl = match ? `https://www.facebook.com/groups/${match[1]}` : null;

  return { groupName: groupName.slice(0, 160) || 'Facebook group', groupUrl };
}

/** Every feed post container currently in the DOM that looks like a real post. */
export function findPostArticles(root: ParentNode = document): HTMLElement[] {
  const candidates = Array.from(root.querySelectorAll<HTMLElement>('[role="article"]'));
  // A post has a decent amount of its own text; nav/aside chrome that also
  // carries role="article" in Facebook's markup (rare, but seen) does not.
  return candidates.filter(el => (el.innerText || '').trim().length >= 20);
}

/**
 * Cuts a post's own text off before the reaction/comment bar, so a captured
 * "post" doesn't silently absorb the first comment (PRD §7: "comment threads
 * containing the real opportunity — V1 reads the post only, say so").
 * Heuristic: Facebook renders "Like Comment Share" (or a localized
 * equivalent count strip) as a dedicated row; anything after the first such
 * row belongs to engagement UI or comments, not the post.
 */
function extractOwnText(article: HTMLElement): string {
  const blocks = Array.from(article.querySelectorAll<HTMLElement>('div[dir="auto"]'));
  const parts: string[] = [];
  for (const block of blocks) {
    const text = (block.innerText || '').trim();
    if (!text) continue;
    if (/^(like|comment|share)$/i.test(text)) break;
    if (COMMENT_PATTERN.test(text) && text.length < 40) break;
    parts.push(text);
    if (parts.join(' ').length > 4000) break; // long-post safety valve, not a hard cap
  }
  const own = parts.join('\n').trim();
  return own || (article.innerText || '').trim();
}

function findPermalink(article: HTMLElement): string | null {
  const links = Array.from(article.querySelectorAll<HTMLAnchorElement>('a[href]'));
  for (const link of links) {
    if (isPermalinkHref(link.href)) {
      try {
        return new URL(link.href, location.href).toString();
      } catch {
        continue;
      }
    }
  }
  // Fallback: the classic <a><abbr>timestamp</abbr></a> permalink pattern.
  const abbrLink = article.querySelector<HTMLAnchorElement>('a:has(abbr)');
  if (abbrLink?.href) {
    try {
      return new URL(abbrLink.href, location.href).toString();
    } catch {
      return null;
    }
  }
  return null;
}

function findAuthor(article: HTMLElement): string {
  const links = Array.from(article.querySelectorAll<HTMLAnchorElement>('a[role="link"], a[href]')).slice(0, 12);
  for (const link of links) {
    const text = (link.innerText || link.textContent || '').trim();
    if (looksLikeAuthorName(text)) return text.slice(0, 120);
  }
  return 'Anonymous member';
}

function findPostedAt(article: HTMLElement): string | null {
  const abbr = article.querySelector('abbr');
  const label = abbr?.getAttribute('aria-label') || abbr?.textContent;
  return label?.trim() || null;
}

function findCommentCount(article: HTMLElement): number | null {
  const text = article.innerText || '';
  return parseCommentCount(text);
}

/** Returns null when the container doesn't look like a real, readable post. */
export function extractPost(article: HTMLElement): ExtractedPost | null {
  const text = extractOwnText(article);
  if (!text || text.length < 15) return null;

  return {
    author: findAuthor(article),
    text,
    postUrl: findPermalink(article),
    commentCount: findCommentCount(article),
    postedAt: findPostedAt(article),
  };
}
