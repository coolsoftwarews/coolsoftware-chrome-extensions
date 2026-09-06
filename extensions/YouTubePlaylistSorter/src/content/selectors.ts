/**
 * Every assumption about YouTube's playlist-page DOM lives in this file and
 * nowhere else. When YouTube reshuffles the layout, this is the only module
 * that should need editing — and every lookup returns null/empty rather than
 * throwing, so a broken selector degrades one field instead of breaking the
 * panel (PRD §5: fields degrade independently, never crash the scan).
 *
 * Selector chains borrow the "try several class/id shapes, first non-empty
 * wins" pattern already used by YouTubeProFilters' own selectors.ts against
 * grid/search rows — playlist rows are a sibling renderer family and largely
 * share the same thumbnail-overlay/metadata-line markup.
 *
 * These selectors could not be verified against a live YouTube session in
 * this build environment — see the README's manual verification checklist,
 * which gates this file before shipping (PRD §5's own spike requirement).
 */

/** One row per video, in the "Videos" list of a /playlist?list=... page. */
export const ROW_SELECTOR = 'ytd-playlist-video-renderer';

/** The scrollable element whose growth the auto-scroll driver watches. */
export const LIST_CONTAINER_SELECTOR = [
  'ytd-playlist-video-list-renderer #contents',
  '#contents.ytd-playlist-video-list-renderer',
  'ytd-playlist-video-list-renderer',
].join(',');

export function text(root: ParentNode, selector: string): string | null {
  try {
    const el = root.querySelector(selector);
    const value = el?.textContent?.trim();
    return value ? value : null;
  } catch {
    return null;
  }
}

/** The title anchor: carries both the /watch?v= href and the visible title. */
export function titleAnchor(row: Element): HTMLAnchorElement | null {
  return (row.querySelector('a#video-title, a#wc-endpoint') ??
    row.querySelector('a[href*="watch?v="]')) as HTMLAnchorElement | null;
}

/** The thumbnail overlay badge: a duration, or a status word like LIVE. */
export function timeStatusText(row: Element): string | null {
  return (
    text(row, 'ytd-thumbnail-overlay-time-status-renderer #text') ??
    text(row, 'ytd-thumbnail-overlay-time-status-renderer') ??
    text(row, '.badge-shape-wiz__text') ??
    text(row, 'badge-shape .badge-shape-wiz__text')
  );
}

/**
 * The metadata line — "1.2M views  3 years ago". Returned as separate items
 * because the separator varies, and because which item is views vs. date is
 * decided by content (parse.ts), not position.
 */
export function metadataItems(row: Element): string[] {
  const nodes = row.querySelectorAll(
    '#video-info span, #metadata-line span, .inline-metadata-item, .ytd-video-meta-block',
  );
  return Array.from(nodes)
    .map((node) => node.textContent?.trim() ?? '')
    .filter(Boolean);
}

/** The 1-based row number YouTube prints in the "#" column, when it does. */
export function positionText(row: Element): string | null {
  return text(row, '#index span, #index');
}

/**
 * A row YouTube itself renders as unavailable shows a bracketed placeholder
 * title instead of a real one, and carries no working /watch?v= link.
 */
const UNAVAILABLE_TITLE_RE = /^\[(private|deleted|unavailable)\s+video\]$/i;

export function isUnavailableRow(row: Element, title: string, videoId: string | null): boolean {
  if (UNAVAILABLE_TITLE_RE.test(title.trim())) return true;
  return !videoId && title.trim().length === 0;
}

/** The playlist's own title, from the page header. */
export function playlistTitleFromDocument(): string {
  const fromHeader =
    text(document, 'ytd-playlist-header-renderer yt-dynamic-sizing-formatted-string') ??
    text(document, 'ytd-playlist-header-renderer #title') ??
    text(document, 'ytd-playlist-sidebar-primary-info-renderer h1') ??
    text(document, 'h1.ytd-playlist-header-renderer');
  if (fromHeader) return fromHeader;

  // Fall back to the tab title, which YouTube renders as "<playlist> - YouTube".
  const docTitle = document.title || '';
  return docTitle.replace(/\s*-\s*YouTube\s*$/i, '').trim();
}

/**
 * YouTube's own stated video count for the playlist ("212 videos"), read
 * from a bounded header/sidebar region. Shown to the user as a labelled,
 * unverified cross-check (PRD §5) — never treated as ground truth for what
 * has actually been loaded.
 */
export function statedTotalFromDocument(): number | null {
  const header =
    document.querySelector('ytd-playlist-header-renderer') ??
    document.querySelector('ytd-playlist-sidebar-primary-info-renderer') ??
    document.querySelector('ytd-playlist-sidebar-renderer');
  const scope = header?.textContent ?? '';
  const match = scope.match(/([\d,]+)\s+videos?\b/i);
  if (!match) return null;
  const n = Number(match[1].replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** Is the current tab a /playlist?list=... page at all? */
export function isPlaylistPage(): boolean {
  return location.pathname === '/playlist' && new URLSearchParams(location.search).has('list');
}

/** The list= query param is "WL" for Watch Later — never verified live (README). */
export function isWatchLaterPage(): boolean {
  return new URLSearchParams(location.search).get('list') === 'WL';
}
