/**
 * The DOM half: finding tweets on the page and reading whatever X has
 * rendered for them (PRD §6 — "Only what X renders for the user in the
 * current tab, at the moment they click save. No API, no background
 * collection, no automation.").
 *
 * X ships obfuscated, frequently-changing class names but keeps a fairly
 * stable set of `data-testid` attributes; every selector here is a
 * best-effort heuristic with a fallback, and every field is optional — a
 * field X didn't render becomes null/empty rather than throwing (PRD §8:
 * media-only posts with no text, protected accounts, deleted posts). This
 * file is DOM-bound and cannot be checked headlessly; it is covered by the
 * manual checklist in README.md, the same split WebHighlighter's anchor.ts
 * and Instagram Research Saver's scrape.ts use. PRD §8 also names "X DOM
 * rewrites" as an expected edge case — when X changes these attributes,
 * fields degrade to empty rather than the save failing outright.
 */

import { CapturedPost, QuotedPost } from './types';
import { canonicalStatusUrl, cleanText, normalizeHandle, parseCount, parseStatusId } from './parse';

export const TWEET_SELECTOR = 'article[data-testid="tweet"]';

/** X's own boundary between a conversation and its algorithmic suggestions. */
const BOUNDARY_TEXT = /more (tweets|posts)|discover more|you might like/i;
const SHOW_MORE_TEXT = /show (more|additional) (repl(y|ies))/i;

function text(el: Element | null | undefined): string {
  return (el?.textContent ?? '').trim();
}

/** Reads the display name + handle out of a tweet's `User-Name` block. */
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

/** Best-effort quoted-post text: a nested User-Name/tweetText pair beyond the
 *  main post's own (PRD §8: "quote posts — save both the quote and the
 *  quoted post's text"). Returns null rather than guessing when ambiguous. */
function readQuoted(root: ParentNode, mainTextEl: Element | null): QuotedPost | null {
  const nameBlocks = Array.from(root.querySelectorAll('[data-testid="User-Name"]'));
  const textBlocks = Array.from(root.querySelectorAll('[data-testid="tweetText"]')).filter(el => el !== mainTextEl);
  if (nameBlocks.length < 2 || !textBlocks.length) return null;

  const quotedNameBlock = nameBlocks[nameBlocks.length - 1];
  const { author, handle } = readAuthor(quotedNameBlock.parentElement ?? quotedNameBlock);
  const quotedText = cleanText(text(textBlocks[textBlocks.length - 1]));
  if (!handle && !quotedText) return null;
  return { author, handle, text: quotedText };
}

function readMedia(root: ParentNode): { count: number; thumbnail: string } {
  const media = root.querySelectorAll(
    '[data-testid="tweetPhoto"], [data-testid="videoPlayer"], [data-testid="videoComponent"]'
  );
  const img = root.querySelector<HTMLImageElement>('[data-testid="tweetPhoto"] img');
  const video = root.querySelector<HTMLVideoElement>('video');
  return { count: media.length, thumbnail: img?.src ?? video?.poster ?? '' };
}

/** Reads one tweet `<article>` into a capture card's post shape. Never throws
 *  — a post that fails to parse is skipped by the caller, not the whole save. */
export function extractPost(article: Element): CapturedPost | null {
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
      quoted: readQuoted(article, textEl),
      mediaCount: count,
      thumbnail,
    };
  } catch {
    return null;
  }
}

/** Every tweet article currently rendered on the page, in document order. */
export function findTweetArticles(root: ParentNode = document): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(TWEET_SELECTOR));
}

/** Text of whatever X rendered directly between two tweet articles (not
 *  inside either one) — where boundary markers and "show more" cells live. */
function betweenText(from: Element, to: Element | null): string {
  let node: Element | null = from.nextElementSibling ?? from.parentElement?.nextElementSibling ?? null;
  let out = '';
  let guard = 0;
  while (node && node !== to && guard < 20) {
    if (node.matches(TWEET_SELECTOR)) break;
    out += ' ' + text(node);
    node = node.nextElementSibling;
    guard++;
  }
  return out;
}

export interface ThreadCollection {
  articles: Element[];
  truncated: boolean;
}

/**
 * Gathers "the whole visible thread" starting at `origin`, in document order
 * (PRD §6). Stops at X's own "More Tweets" boundary so algorithmic
 * suggestions never get pulled into a save, and reports `truncated: true`
 * rather than clicking anything when a "Show more replies" affordance is
 * visible — PRD §11's answer to "how much should we chase": default to
 * what's rendered, let the user expand manually first.
 */
export function collectThread(origin: Element, maxPosts = 200): ThreadCollection {
  const all = findTweetArticles(document);
  const startIndex = all.indexOf(origin as HTMLElement);
  if (startIndex === -1) return { articles: [origin], truncated: false };

  const articles: Element[] = [];
  let truncated = false;

  for (let i = startIndex; i < all.length && articles.length < maxPosts; i++) {
    const candidate = all[i];
    if (i > startIndex) {
      const between = betweenText(all[i - 1], candidate);
      if (BOUNDARY_TEXT.test(between)) break;
      if (SHOW_MORE_TEXT.test(between)) truncated = true;
    }
    articles.push(candidate);
  }

  if (!truncated && articles.length) {
    const after = betweenText(articles[articles.length - 1] as HTMLElement, null);
    if (SHOW_MORE_TEXT.test(after)) truncated = true;
  }

  return { articles, truncated };
}
