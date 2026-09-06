/**
 * The DOM-bound half: finding posts and comment threads on a live LinkedIn
 * page and reading what is already rendered. Nothing here is pure enough to
 * unit test — it needs a real page — so it is exercised by hand against
 * LinkedIn (see README "Manual test checklist"), same split as
 * WebHighlighter's src/anchor.ts and src/extract.ts.
 *
 * Every selector list has fallbacks because LinkedIn's class names are
 * unstable (PRD §7, "LinkedIn DOM rewrites") and differ a little between the
 * main feed and a single post's permalink page. When LinkedIn next reshuffles
 * its markup, this is the file to update — nothing else in the extension
 * needs to change.
 */

import { cleanText, extractLeadingNumber, parseCount } from './text';
import { RawCapture } from './types';

const POST_SELECTORS = [
  'div.feed-shared-update-v2[data-urn]',
  'div[data-urn].occludable-update',
  'div[data-urn][data-id]',
];

const COMMENTS_CONTAINER_SELECTORS = [
  '.comments-comments-list',
  '.comments-comment-list__container',
  '.comments-comment-list',
  '.comments-comments-list-content',
];

const COMMENT_ITEM_SELECTORS = ['article.comments-comment-item', '.comments-comment-item'];

const ACTOR_LINK_SELECTORS = [
  'a.comments-comment-meta__actor-link',
  'a.comments-post-meta__actor-link',
  'a[href*="/in/"]',
  'a[href*="/company/"]',
];

const HEADLINE_SELECTORS = [
  '.comments-comment-meta__description-title',
  '.comments-post-meta__headline',
  '.comments-comment-meta__description',
];

const COMMENT_TEXT_SELECTORS = [
  '.comments-comment-item__main-content',
  '.comments-comment-item-content-body',
  '.update-components-text',
];

const REACTION_SELECTORS = ['.comments-comment-social-bar__reactions-count', 'button[aria-label*="reaction" i]'];

const DATE_SELECTORS = ['.comments-comment-meta__data time', 'time', '.comments-comment-meta__data'];

const COMMENT_COUNT_LABEL_SELECTORS = [
  '.social-details-social-counts__comments',
  'li.social-details-social-counts__comments button',
  'button[aria-label*="comment" i]',
];

const AUTHOR_SELECTORS = ['.update-components-actor__name', '.feed-shared-actor__name'];
const POST_TEXT_SELECTORS = ['.update-components-text', '.feed-shared-update-v2__description'];

function firstMatch<T extends Element>(root: ParentNode, selectors: string[]): T | null {
  for (const selector of selectors) {
    try {
      const el = root.querySelector<T>(selector);
      if (el) return el;
    } catch {
      /* an invalid selector on an old LinkedIn build should not break the rest */
    }
  }
  return null;
}

function allMatches<T extends Element>(root: ParentNode, selectors: string[]): T[] {
  for (const selector of selectors) {
    try {
      const found = Array.from(root.querySelectorAll<T>(selector));
      if (found.length) return found;
    } catch {
      /* ignore and try the next fallback */
    }
  }
  return [];
}

export function findPosts(root: ParentNode): HTMLElement[] {
  return allMatches<HTMLElement>(root, POST_SELECTORS);
}

export function findCommentsContainer(post: HTMLElement): HTMLElement | null {
  return firstMatch<HTMLElement>(post, COMMENTS_CONTAINER_SELECTORS);
}

export function findCommentItems(container: HTMLElement): HTMLElement[] {
  return allMatches<HTMLElement>(container, COMMENT_ITEM_SELECTORS);
}

function postUrn(post: HTMLElement): string | null {
  return post.getAttribute('data-urn') || post.getAttribute('data-id');
}

export function postPermalink(post: HTMLElement): string {
  const urn = postUrn(post);
  if (urn) return `https://www.linkedin.com/feed/update/${encodeURIComponent(urn)}/`;
  return location.href.split('#')[0];
}

export function postLabel(post: HTMLElement): string {
  const authorEl = firstMatch<HTMLElement>(post, AUTHOR_SELECTORS);
  const textEl = firstMatch<HTMLElement>(post, POST_TEXT_SELECTORS);
  const author = cleanText(authorEl?.textContent);
  const snippet = cleanText(textEl?.textContent).slice(0, 80);
  return [author, snippet].filter(Boolean).join(' — ') || 'LinkedIn post';
}

/** The thread's own stated total ("34 comments"), when LinkedIn shows one — used to report skipped comments. */
export function declaredCommentTotal(post: HTMLElement): number | null {
  const el = firstMatch<HTMLElement>(post, COMMENT_COUNT_LABEL_SELECTORS);
  if (!el) return null;
  return extractLeadingNumber(el.textContent || el.getAttribute('aria-label'));
}

/** True for a company page's own comment (PRD §7, "company pages commenting rather than people"). */
function isCompanyHref(href: string | null): boolean {
  return Boolean(href && /\/company\//i.test(href));
}

export function extractComment(item: HTMLElement, postUrl: string, label: string): RawCapture {
  const actorLink = firstMatch<HTMLAnchorElement>(item, ACTOR_LINK_SELECTORS);
  const href = actorLink?.getAttribute('href') || null;
  const rawName = cleanText(actorLink?.textContent);
  // LinkedIn shows "LinkedIn Member" (no link) for deleted/anonymized commenters.
  const isAnonymized = !href || !rawName || /^linkedin member$/i.test(rawName);

  const headlineEl = firstMatch<HTMLElement>(item, HEADLINE_SELECTORS);
  const textEl = firstMatch<HTMLElement>(item, COMMENT_TEXT_SELECTORS);
  const reactionEl = firstMatch<HTMLElement>(item, REACTION_SELECTORS);
  const dateEl = firstMatch<HTMLElement>(item, DATE_SELECTORS);

  return {
    name: rawName || 'LinkedIn Member',
    headline: cleanText(headlineEl?.textContent),
    profileUrl: href,
    isCompany: isCompanyHref(href),
    isAnonymized,
    commentText: cleanText(textEl?.textContent),
    reactionCount: parseCount(reactionEl?.textContent || reactionEl?.getAttribute('aria-label') || null),
    commentDate: cleanText(dateEl?.getAttribute('datetime') || dateEl?.textContent),
    postUrl,
    postLabel: label,
  };
}
