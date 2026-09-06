/**
 * The DOM half: finding bookmarked posts on X's own Bookmarks page and
 * reading whatever X has rendered for them (PRD §5 — "reads the user's own
 * native X Bookmarks page ... NOT the Bookmarks API"). Ported from
 * XConversationSaver's scrape.ts (the closest sibling on this exact
 * platform) with the thread/quote-collection logic dropped — a bookmark is
 * always a single post, never a thread, so this file only ever needs to read
 * one card at a time.
 *
 * X ships obfuscated, frequently-changing class names but keeps a fairly
 * stable set of `data-testid` attributes; every selector here is a
 * best-effort heuristic, and every field is optional — a field X didn't
 * render becomes null/empty rather than throwing (PRD §7: media-only
 * bookmarks, deleted posts). This file is DOM-bound and cannot be checked
 * headlessly; it is covered by the manual checklist in README.md, the same
 * split every DOM-reading extension in this portfolio uses.
 */

import { BookmarkPost } from './types';
import { canonicalStatusUrl, cleanText, normalizeHandle, parseCount, parseStatusId } from './parse';

export const TWEET_SELECTOR = 'article[data-testid="tweet"]';

function text(el: Element | null | undefined): string {
  return (el?.textContent ?? '').trim();
}

/** Reads the display name + handle out of a post's `User-Name` block. */
function readAuthor(root: ParentNode): { author: string; handle: string } {
  const nameBlock = root.querySelector('[data-testid="User-Name"]');
  if (!nameBlock) return { author: '', handle: '' };

  const link = nameBlock.querySelector<HTMLAnchorElement>('a[role="link"][href^="/"]');
  const href = link?.getAttribute('href') ?? '';
  const handle = normalizeHandle(href.replace(/^\//, '').split(/[/?#]/)[0] ?? '');

  // The display name is the first non-empty span that isn't the "@handle" line.
  const spans = Array.from(nameBlock.querySelectorAll('span'))
    .map(span => text(span))
    .filter(Boolean);
  const author = spans.find(s => !s.startsWith('@')) ?? spans[0] ?? '';

  return { author, handle };
}

function readPermalink(root: ParentNode, handle: string): { id: string | null; url: string } {
  const timeEl = root.querySelector('time');
  const link = timeEl?.closest('a');
  const href = link?.getAttribute('href') ?? '';
  const id = parseStatusId(href);
  if (!id) return { id: null, url: '' };
  return { id, url: handle ? canonicalStatusUrl(handle, id) : new URL(href, 'https://x.com').toString() };
}

function readMetric(root: ParentNode, testId: string): number | null {
  const button = root.querySelector(`[data-testid="${testId}"]`);
  const label = button?.getAttribute('aria-label') ?? text(button);
  return parseCount(label);
}

/** Views live in an analytics link, not the reply/retweet/like action group. */
function readViews(root: ParentNode): number | null {
  const analytics = root.querySelector('a[href$="/analytics"]');
  if (!analytics) return null;
  return parseCount(analytics.getAttribute('aria-label') ?? text(analytics));
}

function readMedia(root: ParentNode): { count: number; thumbnail: string } {
  const media = root.querySelectorAll(
    '[data-testid="tweetPhoto"], [data-testid="videoPlayer"], [data-testid="videoComponent"]'
  );
  const img = root.querySelector<HTMLImageElement>('[data-testid="tweetPhoto"] img');
  const video = root.querySelector<HTMLVideoElement>('video');
  return { count: media.length, thumbnail: img?.src ?? video?.poster ?? '' };
}

/** Reads one bookmarked post `<article>` into a bookmark card's post shape.
 *  Never throws — a bookmark that fails to parse is skipped by the caller,
 *  not the whole indexing pass. */
export function extractBookmark(article: Element): BookmarkPost | null {
  try {
    const { author, handle } = readAuthor(article);
    const { id, url } = readPermalink(article, handle);
    if (!id) return null;

    const textEl = article.querySelector('[data-testid="tweetText"]');
    const { count, thumbnail } = readMedia(article);

    return {
      id,
      author,
      handle,
      text: cleanText(text(textEl)),
      url,
      postDate: article.querySelector('time')?.getAttribute('datetime') ?? '',
      metrics: {
        replies: readMetric(article, 'reply'),
        reposts: readMetric(article, 'retweet'),
        likes: readMetric(article, 'like'),
        views: readViews(article),
      },
      mediaCount: count,
      thumbnail,
    };
  } catch {
    return null;
  }
}

/** Every bookmarked-post article currently rendered on the page, in document order. */
export function findBookmarkArticles(root: ParentNode = document): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(TWEET_SELECTOR));
}

/** Reads every bookmark currently rendered into the DOM. Skips anything that
 *  fails to parse rather than aborting the whole pass (PRD §7). */
export function extractVisibleBookmarks(root: ParentNode = document): BookmarkPost[] {
  return findBookmarkArticles(root)
    .map(extractBookmark)
    .filter((post): post is BookmarkPost => post !== null);
}
