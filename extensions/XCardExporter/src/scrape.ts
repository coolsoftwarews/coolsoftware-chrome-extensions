/**
 * The DOM half: finding a post's <article> and reading whatever X has
 * already rendered for it (PRD S5 - "only what's already rendered for the
 * post the user clicked... on"). Same instinct as XConversationSaver's
 * scrape.ts in this portfolio (data-testid attributes over class names,
 * every field optional, never throws), extended with an avatar reader that
 * extension didn't need.
 *
 * This file is DOM-bound and cannot be checked headlessly by
 * scripts/selftest.mjs; it is covered by the manual checklist in README.md.
 * The X DOM could not be verified against a live page in this build
 * environment (no network access) - flagged here and in the README per the
 * portfolio's standing "say so, don't silently guess" rule.
 */

import { ScrapedPost } from './types';
import { cleanText } from './text';
import { upgradeAvatarUrl } from './avatar';

export const TWEET_SELECTOR = 'article[data-testid="tweet"]';
const ACTION_ROW_SELECTOR = '[role="group"]';

function text(el: Element | null | undefined): string {
  return (el?.textContent ?? '').trim();
}

function readAuthor(root: ParentNode): { author: string; handle: string } {
  const nameBlock = root.querySelector('[data-testid="User-Name"]');
  if (!nameBlock) return { author: '', handle: '' };

  const link = nameBlock.querySelector<HTMLAnchorElement>('a[role="link"][href^="/"]');
  const href = link?.getAttribute('href') ?? '';
  const handle = href.replace(/^\//, '').split(/[/?#]/)[0] ?? '';

  const spans = Array.from(nameBlock.querySelectorAll('span'))
    .map(span => text(span))
    .filter(Boolean);
  const author = spans.find(s => !s.startsWith('@')) ?? spans[0] ?? '';

  return { author, handle: handle ? `@${handle}` : '' };
}

/** X renders the avatar inside a dedicated container next to (not inside)
 *  the User-Name block; when that container is missing (a DOM change, or a
 *  layout this extension hasn't seen) fall back to the first image whose
 *  src looks like X's own avatar CDN, anywhere in the article. */
function readAvatarUrl(root: ParentNode): string {
  const dedicated = root.querySelector<HTMLImageElement>('[data-testid="Tweet-User-Avatar"] img');
  if (dedicated?.src) return dedicated.src;

  const fallback = root.querySelector<HTMLImageElement>('img[src*="profile_images"]');
  return fallback?.src ?? '';
}

function readMetric(root: ParentNode, testId: string): number | null {
  const button = root.querySelector(`[data-testid="${testId}"]`);
  const label = button?.getAttribute('aria-label') ?? text(button);
  const match = label.match(/[\d,.]+[KkMm]?/);
  if (!match) return null;
  return parseAbbreviatedCount(match[0]);
}

function parseAbbreviatedCount(raw: string): number | null {
  const cleaned = raw.replace(/,/g, '');
  const multiplierMatch = cleaned.match(/^([\d.]+)([KkMm]?)$/);
  if (!multiplierMatch) return null;
  const value = Number(multiplierMatch[1]);
  if (!Number.isFinite(value)) return null;
  const suffix = multiplierMatch[2].toLowerCase();
  if (suffix === 'k') return Math.round(value * 1000);
  if (suffix === 'm') return Math.round(value * 1_000_000);
  return Math.round(value);
}

function readStatusId(root: ParentNode): string | null {
  const timeEl = root.querySelector('time');
  const link = timeEl?.closest('a');
  const href = link?.getAttribute('href') ?? '';
  const match = href.match(/\/status\/(\d+)/);
  return match ? match[1] : null;
}

/** Reads one tweet <article> into a card-input shape. Never throws - a post
 *  that fails to parse is skipped by the caller, not the whole export
 *  (same "never break the whole action over one field" rule as every other
 *  DOM-scraping extension in this portfolio). */
export function extractPost(article: Element): ScrapedPost | null {
  try {
    const { author, handle } = readAuthor(article);
    const textEl = article.querySelector('[data-testid="tweetText"]');
    const bodyText = cleanText(text(textEl));
    if (!author && !handle && !bodyText) return null;

    return {
      id: readStatusId(article),
      author,
      handle,
      avatarUrl: upgradeAvatarUrl(readAvatarUrl(article)),
      text: bodyText,
      postDate: article.querySelector('time')?.getAttribute('datetime') ?? '',
      metrics: {
        replies: readMetric(article, 'reply'),
        reposts: readMetric(article, 'retweet'),
        likes: readMetric(article, 'like'),
      },
    };
  } catch {
    return null;
  }
}

export function findTweetArticles(root: ParentNode = document): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(TWEET_SELECTOR));
}

/** The action row (reply/repost/like/share) within one article - the badge
 *  is positioned near this, not the whole card (PRD S4: "injected near each
 *  post's action row"). Falls back to the article's own bottom edge when the
 *  row can't be found. */
export function findActionRow(article: Element): Element | null {
  const groups = Array.from(article.querySelectorAll(ACTION_ROW_SELECTOR));
  return groups.find(g => g.querySelector('[data-testid="reply"]')) ?? groups[groups.length - 1] ?? null;
}

/** Every tweet in the same thread as `origin`, gathered from what's
 *  currently rendered on the page (PRD S4 thread export). Mirrors
 *  XConversationSaver's collectThread boundary/truncation rules so a
 *  thread export never wanders into algorithmic "More Tweets" suggestions. */
export interface ThreadCollection {
  articles: Element[];
  truncated: boolean;
}

const BOUNDARY_TEXT = /more (tweets|posts)|discover more|you might like/i;
const SHOW_MORE_TEXT = /show (more|additional) (repl(y|ies))/i;

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

/**
 * `allArticles` lets a caller that's already scanned the page (content.ts's
 * badge sync) share one findTweetArticles() pass across every badge instead
 * of paying an O(n) DOM query per badge per sync (O(n^2) on a busy
 * timeline) - it defaults to a fresh scan for callers that just want one
 * thread's worth of posts.
 */
export function collectThread(origin: Element, maxPosts = 25, allArticles?: HTMLElement[]): ThreadCollection {
  const all = allArticles ?? findTweetArticles(document);
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

  return { articles, truncated };
}
