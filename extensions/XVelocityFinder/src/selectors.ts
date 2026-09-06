/**
 * Every assumption about X's DOM lives in this file and nowhere else. X ships
 * changes constantly with no deprecation courtesy (PRD §5) — when a layout
 * change breaks something, this is the only module that should need
 * touching. Every lookup returns null rather than throwing, so a changed
 * selector degrades one field instead of taking the timeline down with it.
 *
 * Selectors lean on `data-testid`, which has been the most stable hook across
 * X's redesigns historically (far more stable than class names, which are
 * atomic/generated and change on every build).
 */

/** One timeline entry — home, profile, or search results. */
export const POST_SELECTOR = 'article[data-testid="tweet"]';

/** The scroll container whose children are timeline entries. Watched for
 * mutations so infinite scroll and virtualization recycling both re-trigger
 * a pass (PRD §7). */
export const TIMELINE_SELECTOR = 'main[role="main"] section, main[role="main"] div[aria-label]';

/** Where the filter bar is inserted, in order of preference. */
export const ANCHOR_SELECTORS = [
  'main[role="main"] div[data-testid="primaryColumn"] > div > div',
  'main[role="main"] div[data-testid="primaryColumn"]',
  'main[role="main"]',
];

export function text(root: ParentNode, selector: string): string | null {
  try {
    const value = root.querySelector(selector)?.textContent?.trim();
    return value ? value : null;
  } catch {
    return null;
  }
}

export function attr(root: ParentNode, selector: string, name: string): string | null {
  try {
    return root.querySelector(selector)?.getAttribute(name) ?? null;
  } catch {
    return null;
  }
}

/** The permalink anchor wrapping the timestamp — carries both the status id and the exact time. */
export function timeElement(post: Element): HTMLTimeElement | null {
  try {
    return post.querySelector('a[href*="/status/"] time[datetime]');
  } catch {
    return null;
  }
}

export function permalinkHref(post: Element): string | null {
  try {
    return post.querySelector('a[href*="/status/"] time[datetime]')?.closest('a')?.getAttribute('href') ?? null;
  } catch {
    return null;
  }
}

/** The author block at the top of the post — name plus @handle, never the
 * "X reposted" context line above it (that line names the resharer, not the
 * post's actual author — PRD §7: attribute reposts to the original). */
export function authorBlock(post: Element): Element | null {
  return post.querySelector('div[data-testid="User-Name"]');
}

export function authorHandle(post: Element): string | null {
  const block = authorBlock(post);
  if (!block) return null;
  const links = Array.from(block.querySelectorAll('a[role="link"][href^="/"]'));
  for (const link of links) {
    const href = link.getAttribute('href') ?? '';
    const match = href.match(/^\/(\w{1,15})$/);
    if (match) return match[1];
  }
  return null;
}

export function authorName(post: Element): string | null {
  const block = authorBlock(post);
  return block?.querySelector('a[role="link"] span')?.textContent?.trim() ?? null;
}

/**
 * The reply / repost / like counts. Each action button holds its count in a
 * text span; X omits the number entirely rather than printing "0", so an
 * empty span is a real zero. Returning `null` is reserved for the button not
 * existing at all — that is the actual parse failure, and the only case that
 * should stop this count from contributing to engagement.
 */
function actionCount(post: Element, testId: string): string | null {
  try {
    const button = post.querySelector(`[data-testid="${testId}"]`);
    if (!button) return null;

    const label = button.getAttribute('aria-label');
    // aria-label is usually "12 Likes" / "1,234 reposts" — prefer it, it is
    // the least likely part of the DOM to be visually truncated.
    if (label) {
      const match = label.match(/^([\d.,]+[kmb]?)/i);
      if (match) return match[1];
    }
    const span = button.querySelector('span[data-testid="app-text-transition-container"]') ?? button;
    return span.textContent?.trim() || '0';
  } catch {
    return null;
  }
}

export function replyCountText(post: Element): string | null {
  return actionCount(post, 'reply');
}
export function repostCountText(post: Element): string | null {
  return actionCount(post, 'retweet');
}
export function likeCountText(post: Element): string | null {
  return actionCount(post, 'like');
}

export function bodyText(post: Element): string {
  return post.querySelector('div[data-testid="tweetText"]')?.textContent?.trim() ?? '';
}

/** Promoted posts are skipped entirely — no badge, no filtering (PRD §7). */
export function isPromoted(post: Element): boolean {
  try {
    if (post.querySelector('[data-testid="promotedIndicator"]')) return true;
    const spans = post.querySelectorAll('div[data-testid="placementTracking"] span, span');
    for (const span of Array.from(spans).slice(0, 12)) {
      const value = span.textContent?.trim();
      if (value === 'Ad' || value === 'Promoted') return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * A quote post: this article's own content plus an embedded card for someone
 * else's post. Detected by a nested permalink-style block inside the tweet
 * body that carries its own timestamp, distinct from this post's own header
 * timestamp. Badged separately from the embedded post per PRD §7 — this
 * function only tells us the flag; scan.ts never reaches into the embed.
 */
export function hasQuotedPost(post: Element): boolean {
  try {
    const own = timeElement(post);
    const nested = post.querySelectorAll('div[role="link"] a[href*="/status/"] time[datetime]');
    for (const time of Array.from(nested)) {
      if (time !== own) return true;
    }
    return false;
  } catch {
    return false;
  }
}

/** The host node the badge attaches to — right after the header's timestamp,
 * so it reads as part of the existing "Name · handle · 2h" line rather than
 * pushing the post's body or the action bar around. */
export function badgeHost(post: Element): Element | null {
  return timeElement(post)?.closest('a')?.parentElement ?? authorBlock(post);
}

/** The URL for the current path — used to gate search-only features (sort). */
export function isSearchPage(pathname: string): boolean {
  return pathname === '/search';
}
