/**
 * Every assumption about LinkedIn's DOM lives in this file and nowhere else.
 * LinkedIn ships markup rewrites often and undocumented (PRD §5/§7) — when
 * that happens, this is the only module that needs touching, and every
 * lookup here returns null/[] rather than throwing, so a changed selector
 * degrades one field instead of taking the post list down.
 *
 * Not verified against a live, logged-in LinkedIn session in this build
 * environment — built from the same DOM shape LinkedInCreatorWatchlist's
 * content.ts already uses (`[data-urn]` post containers, `a[href*="/in/"]`
 * author links, a visible-text regex over the social-counts bar rather than
 * a brittle class-name chain). Re-validate against a real page before
 * shipping; content.ts's quiet-notice + parse-failure counter exist
 * precisely for the day this drifts. See README.md's manual test checklist.
 */

import { PostType } from './types';

const POST_URN_RE = /^urn:li:(activity|share|ugcPost):/;

/** The results/history root each page shape renders posts into. */
export function resultsContainer(): HTMLElement | null {
  return document.querySelector<HTMLElement>('main') ?? document.body;
}

/** One post per `[data-urn]` node whose urn is an actual post (not a comment, reaction, etc). */
export function postContainers(): HTMLElement[] {
  const root = resultsContainer() ?? document;
  return Array.from(root.querySelectorAll<HTMLElement>('[data-urn]')).filter(el => {
    const urn = el.getAttribute('data-urn') ?? '';
    return POST_URN_RE.test(urn);
  });
}

export function postUrn(container: Element): string | null {
  let node: Element | null = container;
  while (node) {
    const urn = node.getAttribute('data-urn');
    if (urn && POST_URN_RE.test(urn)) return urn;
    node = node.parentElement;
  }
  return null;
}

function firstMatch(root: ParentNode, selectors: string[]): HTMLElement | null {
  for (const selector of selectors) {
    const el = root.querySelector<HTMLElement>(selector);
    if (el) return el;
  }
  return null;
}

export function findAuthorLinks(container: Element): Array<{ href: string; name: string }> {
  const anchors = Array.from(container.querySelectorAll<HTMLAnchorElement>('a[href*="/in/"]'));
  const seen = new Set<string>();
  const results: Array<{ href: string; name: string }> = [];
  for (const anchor of anchors) {
    const name = (anchor.textContent || '').trim();
    if (!name) continue;
    const href = anchor.href;
    if (seen.has(href)) continue;
    seen.add(href);
    results.push({ href, name });
  }
  return results;
}

/**
 * LinkedIn shows "X reposted this" above the embedded original post. Two
 * distinct author links in a container is the signal; the *second* is the
 * post's real author, the first is whoever reposted it (PRD §7: attribute
 * reposts to the original author, mark as a repost).
 */
export function detectAuthor(container: Element): { href: string; name: string; isRepost: boolean } | null {
  const authors = findAuthorLinks(container);
  if (!authors.length) return null;

  const headText = (container.textContent ?? '').slice(0, 160).toLowerCase();
  const looksReposted = /reposted|reshared/.test(headText);

  if (looksReposted && authors.length > 1) {
    return { ...authors[1], isRepost: true };
  }
  return { ...authors[0], isRepost: false };
}

export function findHeadline(container: Element): string {
  const el = firstMatch(container, [
    '[class*="actor__description"]',
    '[class*="update-components-actor__description"]',
    '.text-body-small',
  ]);
  return (el?.textContent ?? '').trim();
}

export function derivePostType(container: Element): PostType {
  if (container.querySelector('[class*="feed-shared-poll"]')) return 'poll';
  if (container.querySelector('[class*="feed-shared-article"], [class*="feed-shared-external-video"], [class*="newsletter"]'))
    return 'article';
  if (container.querySelector('video')) return 'video';
  if (container.querySelector('[class*="document-s-container"], [class*="feed-shared-document"]')) return 'document';
  if (container.querySelector('[class*="feed-shared-image"], [class*="update-components-image"]')) return 'image';
  if (container.querySelector('p, span[dir="ltr"]')) return 'text';
  return 'other';
}

/**
 * A "Featured" module heuristic — LinkedIn's profile Featured section is a
 * separate carousel from the activity list this extension scans, so this
 * rarely fires in V1's supported pages; it exists so a future page shape
 * that does inline Featured posts degrades safely rather than silently
 * polluting the median (PRD §4/§7).
 */
export function isPinnedOrFeatured(container: Element): boolean {
  let node: Element | null = container;
  while (node) {
    const cls = node.className;
    if (typeof cls === 'string' && /featured/i.test(cls)) return true;
    node = node.parentElement;
  }
  return false;
}

export function findCountsBlockText(container: Element): string {
  const el = firstMatch(container, ['[class*="social-details-social-counts"]', '[class*="social-counts"]']);
  return (el ?? container).textContent ?? '';
}

export function findRelativeLabel(container: Element): string {
  const el = firstMatch(container, [
    '[class*="actor__sub-description"]',
    'time',
    '[class*="update-components-actor__sub-description"]',
  ]);
  const text = el?.textContent ?? '';
  const match = text.match(/\d+\s*(?:s|m|h|d|w|mo|yr)\b/i);
  return match ? match[0] : '';
}

/**
 * The DOM node the badge chip is inserted after — kept separate from
 * detectAuthor's `{href, name}` pair because the badge needs the live
 * element reference, not just its text/href. Prefers the relative-time
 * label (sits at the end of the author line, least likely to be inside a
 * link a click would otherwise navigate) and falls back to the last author
 * link in the container.
 */
export function badgeAnchor(container: Element): HTMLElement | null {
  const timeEl = firstMatch(container, [
    '[class*="actor__sub-description"]',
    'time',
    '[class*="update-components-actor__sub-description"]',
  ]);
  if (timeEl) return timeEl;

  const anchors = container.querySelectorAll<HTMLAnchorElement>('a[href*="/in/"]');
  return anchors.length ? anchors[anchors.length - 1] : null;
}

export function findPostUrl(container: Element, urn: string | null): string {
  const link = container.querySelector<HTMLAnchorElement>('a[href*="/posts/"], a[href*="/feed/update/"]');
  if (link) return link.href;
  if (urn) return `https://www.linkedin.com/feed/update/${urn}/`;
  return '';
}
