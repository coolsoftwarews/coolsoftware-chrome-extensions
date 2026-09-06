/**
 * Every assumption about TikTok's DOM lives in this file and nowhere else.
 * PRD §7 lists "TikTok DOM rewrites" as an edge case to design around: when a
 * selector stops matching, each lookup here returns null instead of
 * throwing, so a layout change degrades one field rather than breaking the
 * profile page (§6: "the profile page is never broken").
 *
 * Selectors are ordered primary → fallback. The primary set targets TikTok's
 * `data-e2e` test hooks, which are the most stable public surface of the DOM;
 * the fallback set is a generic heuristic (any link that looks like a video
 * or photo post) so the grid can still be read, minus whatever field relied
 * on the more specific hook.
 */

/** Grid items on a profile page. */
export const POST_ITEM_SELECTORS = [
  '[data-e2e="user-post-item"]',
  '[data-e2e="user-post-item-list"] > div',
];

/** Fallback: any post link, used only when POST_ITEM_SELECTORS finds nothing. */
export const POST_LINK_FALLBACK = 'a[href*="/video/"], a[href*="/photo/"]';

export function postHref(item: Element): string | null {
  const anchor =
    item.querySelector<HTMLAnchorElement>('a[href*="/video/"], a[href*="/photo/"]') ??
    (item instanceof HTMLAnchorElement ? item : null);
  return anchor?.getAttribute('href') ?? null;
}

export function viewsText(item: Element): string | null {
  return (
    text(item, '[data-e2e="video-views"]') ??
    text(item, 'strong[data-e2e="video-views"]') ??
    // Generic fallback: a short strong/span near the thumbnail that looks like a count.
    Array.from(item.querySelectorAll('strong, span'))
      .map(node => node.textContent?.trim() ?? '')
      .find(value => /^[\d.,]+[KMB]?$/i.test(value)) ??
    null
  );
}

export function captionText(item: Element): string | null {
  const img = item.querySelector('img');
  const alt = img?.getAttribute('alt')?.trim();
  if (alt) return alt;
  return text(item, '[data-e2e="user-post-item-desc"]');
}

export function durationText(item: Element): string | null {
  return text(item, '[data-e2e="video-duration"]') ?? text(item, '.duration, [class*="duration" i]');
}

export function isPinned(item: Element): boolean {
  const label = text(item, '[data-e2e="video-card-badge"]') ?? item.textContent ?? '';
  return /\bpinned\b/i.test(label.slice(0, 200));
}

export function postedAtAttr(item: Element): string | null {
  // TikTok's grid does not reliably expose an upload date; if a future layout
  // adds one via <time> or a title attribute, pick it up without code changes
  // elsewhere — postedAt simply stays null until then (§5).
  const time = item.querySelector('time');
  return time?.getAttribute('datetime') ?? time?.getAttribute('title') ?? null;
}

/** Where to anchor the header strip: just above the video grid. */
export const GRID_ANCHOR_SELECTORS = [
  '[data-e2e="user-post-item-list"]',
  '[data-e2e="user-tab-content"]',
];

function text(root: ParentNode, selector: string): string | null {
  try {
    const value = root.querySelector(selector)?.textContent?.trim();
    return value ? value : null;
  } catch {
    return null;
  }
}
