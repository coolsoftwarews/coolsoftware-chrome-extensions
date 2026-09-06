/**
 * Every assumption about YouTube's DOM lives in this file and nowhere else.
 * When an A/B test changes the search layout (§6), this is the only module
 * that needs touching — and each lookup returns null rather than throwing, so
 * a changed selector degrades one field instead of breaking the page.
 */

/** Element types that represent one search result row. */
export const RESULT_SELECTOR = [
  'ytd-video-renderer',
  'ytd-grid-video-renderer',
  'ytd-rich-item-renderer',
  'ytd-reel-item-renderer',
  'ytm-shorts-lockup-view-model',
].join(',');

/** Containers whose direct children are result rows — the sort reorders inside these. */
export const RESULT_CONTAINER_SELECTOR = [
  'ytd-item-section-renderer #contents',
  'ytd-rich-grid-renderer #contents',
].join(',');

/** Where the filter bar is inserted, in order of preference. */
export const ANCHOR_SELECTORS = [
  'ytd-search #container > #primary',
  'ytd-two-column-search-results-renderer #primary',
  'ytd-search',
];

export function text(root: ParentNode, selector: string): string | null {
  try {
    const element = root.querySelector(selector);
    const value = element?.textContent?.trim();
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

/** The title anchor carries both the video href and, via its title attr, the full title. */
export function titleAnchor(row: Element): HTMLAnchorElement | null {
  return (row.querySelector('a#video-title-link, a#video-title, a.yt-lockup-metadata-view-model__title') ??
    row.querySelector('a[href*="/watch?v="], a[href*="/shorts/"]')) as HTMLAnchorElement | null;
}

export function channelAnchor(row: Element): HTMLAnchorElement | null {
  return row.querySelector(
    'ytd-channel-name a, #channel-name a, a.yt-content-metadata-view-model__link[href*="/@"], a[href^="/channel/"], a[href^="/@"]',
  ) as HTMLAnchorElement | null;
}

/**
 * The metadata line — "1.2M views • 3 days ago". Returned as separate items
 * because the separator character varies by locale and layout.
 */
export function metadataItems(row: Element): string[] {
  const nodes = row.querySelectorAll(
    '#metadata-line .inline-metadata-item, .yt-content-metadata-view-model__metadata-text, #metadata-line span',
  );
  return Array.from(nodes)
    .map((node) => node.textContent?.trim() ?? '')
    .filter(Boolean);
}

/** The thumbnail overlay badge: a duration, or a status word like LIVE. */
export function timeStatusText(row: Element): string | null {
  return (
    text(row, 'ytd-thumbnail-overlay-time-status-renderer #text') ??
    text(row, 'ytd-thumbnail-overlay-time-status-renderer') ??
    text(row, '.badge-shape-wiz__text') ??
    text(row, 'badge-shape .badge-shape-wiz__text') ??
    text(row, '.ytd-thumbnail-overlay-time-status-renderer')
  );
}

/** The node a badge is anchored to — the thumbnail, so the badge overlays it. */
export function thumbnailHost(row: Element): HTMLElement | null {
  return row.querySelector('ytd-thumbnail, .yt-thumbnail-view-model, #thumbnail') as HTMLElement | null;
}
