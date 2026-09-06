/**
 * Reddit DOM extraction, for both front-ends the target audience actually
 * uses (PRD §5): `old.reddit.com`, whose markup has been stable for over a
 * decade, and the current `www.reddit.com` redesign, which renders every
 * post inside a `<shreddit-post>` custom element carrying the data we need
 * as plain attributes (`post-title`, `score`, `comment-count`,
 * `created-timestamp`, `subreddit-prefixed-name`, `permalink`, `author`) —
 * more stable than the CSS soup around them, and the closest thing new
 * Reddit has to old Reddit's `data-*` attributes.
 *
 * Reddit redesigns periodically (PRD §7). When it next does, this is the one
 * file that needs updating — everything below is written to return null or
 * an empty snippet rather than guess wrong, and a hostile or missing element
 * never stops the rest of the feed from scanning.
 *
 * Text-only helpers are exported separately from the DOM-walking ones so the
 * string logic (comment-count parsing, subreddit-name cleanup, snippet
 * truncation) can be unit tested without a browser — see
 * scripts/selftest.mjs. The DOM-bound half needs a real Reddit tab and is
 * covered by the manual checklist in README.md instead.
 */

import { RedditFrontend } from './types';

export const MAX_SNIPPET_LENGTH = 400;

/* ── Pure text helpers (unit tested) ────────────────────────────────────── */

const COMMENT_PATTERN = /(\d[\d,]*)\s*comments?\b/i;

/** Reads a comment count out of a label like "34 comments" or "1 comment". */
export function parseCommentCountLabel(text: string): number | null {
  const match = text.match(COMMENT_PATTERN);
  if (!match) return null;
  const n = Number(match[1].replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** "r/freelance" → "freelance"; "freelance" stays "freelance". */
export function stripSubredditPrefix(value: string): string {
  return value.replace(/^\s*\/?r\//i, '').trim();
}

/** Best-effort integer parse for a score string that may carry "k"/"m" or a
 * hyphen for a hidden/negative score old Reddit sometimes renders. */
export function parseScoreLabel(value: string): number | null {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed || trimmed === '•' || trimmed === '-') return null;
  const multiplier = trimmed.endsWith('k') ? 1000 : trimmed.endsWith('m') ? 1_000_000 : 1;
  const numeric = Number(trimmed.replace(/[km]$/, '').replace(/,/g, ''));
  if (!Number.isFinite(numeric)) return null;
  return Math.round(numeric * multiplier);
}

/** Card/storage snippet: keeps the whole thing short and single-paragraph. */
export function truncateSnippet(text: string, max = MAX_SNIPPET_LENGTH): string {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  if (trimmed.length <= max) return trimmed;
  const cut = trimmed.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${cut.slice(0, lastSpace > max * 0.6 ? lastSpace : max)}…`;
}

/** Which front-end this document is. `null` on a page this extension does
 * not run on (the manifest's host permission already restricts to
 * reddit.com, so this only distinguishes old vs. new). */
export function detectFrontend(hostname: string): RedditFrontend {
  return hostname === 'old.reddit.com' ? 'old' : 'new';
}

/** Reddit's own multi-subreddit aggregates — not a single community, so the
 * subreddit read (which promises a judgement about "this community") should
 * not run on them. */
const RESERVED_SUBREDDIT_NAMES = new Set(['all', 'popular', 'friends', 'mod']);

/**
 * The subreddit for the *current listing page*, when it is exactly one real
 * subreddit (PRD §4's "current subreddit" read) — null on the home feed,
 * r/popular/r/all, a multi-subreddit feed, or a user profile.
 */
export function subredditFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/r\/([A-Za-z0-9_]+)\/?(?:$|\/(?:new|hot|top|rising|comments)\b)/);
  if (!match) return null;
  const name = match[1];
  return RESERVED_SUBREDDIT_NAMES.has(name.toLowerCase()) ? null : name;
}

/* ── Raw post shape shared by both front-ends ───────────────────────────── */

export interface RawPost {
  id: string;
  subreddit: string;
  title: string;
  snippet: string;
  permalink: string;
  score: number | null;
  numComments: number | null;
  postedAtLabel: string | null;
  createdAtMs: number | null;
}

function absoluteUrl(href: string): string {
  try {
    return new URL(href, location.href).toString();
  } catch {
    return href;
  }
}

/* ── new Reddit (shreddit-post) ─────────────────────────────────────────── */

export function findNewRedditPosts(root: ParentNode = document): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('shreddit-post'));
}

function newRedditSnippet(post: HTMLElement): string {
  // The self-text preview, when the redesign renders one, lives in a slotted
  // node. Attribute names for this are undocumented and have moved before,
  // so this tries a short, ordered list of best-effort selectors and accepts
  // an empty snippet rather than risk pulling in unrelated UI text.
  const candidate =
    post.querySelector<HTMLElement>('[slot="text-body"]') ??
    post.querySelector<HTMLElement>('[data-post-click-location="text-body"]');
  return candidate ? truncateSnippet(candidate.innerText || candidate.textContent || '') : '';
}

export function extractNewRedditPost(post: HTMLElement): RawPost | null {
  const id = post.getAttribute('id') || post.getAttribute('post-id') || '';
  const title = post.getAttribute('post-title') || '';
  if (!id || !title) return null;

  const subredditRaw = post.getAttribute('subreddit-prefixed-name') || post.getAttribute('subreddit-name') || '';
  const subreddit = stripSubredditPrefix(subredditRaw);
  if (!subreddit) return null;

  const permalinkAttr = post.getAttribute('permalink') || post.getAttribute('content-href') || '';
  const permalink = permalinkAttr ? absoluteUrl(permalinkAttr) : `${location.origin}/r/${subreddit}/comments/${id.replace(/^t3_/, '')}/`;

  const scoreAttr = post.getAttribute('score');
  const score = scoreAttr !== null ? parseScoreLabel(scoreAttr) : null;

  const commentAttr = post.getAttribute('comment-count');
  const numComments = commentAttr !== null ? parseScoreLabel(commentAttr) : null;

  const createdAttr = post.getAttribute('created-timestamp');
  const createdAtMs = createdAttr ? Date.parse(createdAttr) : NaN;

  return {
    id,
    subreddit,
    title: title.trim(),
    snippet: newRedditSnippet(post),
    permalink,
    score,
    numComments,
    postedAtLabel: createdAttr,
    createdAtMs: Number.isFinite(createdAtMs) ? createdAtMs : null,
  };
}

/* ── old Reddit (.thing.link) ────────────────────────────────────────────── */

export function findOldRedditPosts(root: ParentNode = document): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('div.thing.link[data-fullname]'));
}

function oldRedditSnippet(thing: HTMLElement): string {
  // Only visible when the user (or the subreddit's auto-expand setting) has
  // opened the self-text expando; most listing rows show none, which is fine
  // — PRD §4 says "when available".
  const body = thing.querySelector<HTMLElement>('.expando .usertext-body .md');
  if (!body) return '';
  return truncateSnippet(body.innerText || body.textContent || '');
}

export function extractOldRedditPost(thing: HTMLElement): RawPost | null {
  const id = thing.getAttribute('data-fullname') || '';
  const subreddit = thing.getAttribute('data-subreddit') || '';
  if (!id || !subreddit) return null;

  const titleLink = thing.querySelector<HTMLAnchorElement>('a.title');
  const title = (titleLink?.textContent || '').trim();
  if (!title) return null;

  const permalinkAttr = thing.getAttribute('data-permalink') || titleLink?.getAttribute('href') || '';
  const permalink = permalinkAttr ? absoluteUrl(permalinkAttr) : location.href;

  const scoreAttr = thing.getAttribute('data-score');
  const score = scoreAttr !== null ? parseScoreLabel(scoreAttr) : null;

  const commentsAttr = thing.getAttribute('data-comments-count');
  const commentsLink = thing.querySelector<HTMLElement>('a.comments');
  const numComments =
    commentsAttr !== null ? parseScoreLabel(commentsAttr) : parseCommentCountLabel(commentsLink?.textContent || '');

  const timeEl = thing.querySelector<HTMLTimeElement>('time[datetime]');
  const datetime = timeEl?.getAttribute('datetime') || '';
  const createdAttr = thing.getAttribute('data-timestamp');
  const createdAtMs = createdAttr ? Number(createdAttr) : datetime ? Date.parse(datetime) : NaN;

  return {
    id,
    subreddit,
    title,
    snippet: oldRedditSnippet(thing),
    permalink,
    score,
    numComments,
    postedAtLabel: timeEl?.textContent?.trim() || null,
    createdAtMs: Number.isFinite(createdAtMs) ? createdAtMs : null,
  };
}

/* ── Dispatch ────────────────────────────────────────────────────────────── */

export function findPosts(frontend: RedditFrontend, root: ParentNode = document): HTMLElement[] {
  return frontend === 'old' ? findOldRedditPosts(root) : findNewRedditPosts(root);
}

export function extractPost(frontend: RedditFrontend, el: HTMLElement): RawPost | null {
  try {
    return frontend === 'old' ? extractOldRedditPost(el) : extractNewRedditPost(el);
  } catch {
    // One hostile post's markup must not stop the rest of the feed (PRD §7:
    // "expect breakage; degrade rather than mangle the page").
    return null;
  }
}
