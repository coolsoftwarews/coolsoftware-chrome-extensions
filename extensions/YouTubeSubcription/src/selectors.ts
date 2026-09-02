/**
 * The isolated selector layer.
 *
 * Every assumption about YouTube's DOM lives in this file and nowhere else.
 * When YouTube ships a redesign, this is the only file that should need
 * editing — and every function here is written to return null/empty rather
 * than throw, so a broken selector degrades to "unmodified YouTube" instead
 * of a broken page.
 */

import { LanguageCode, parseAge } from './dates';

/** Containers that hold one video each, in the subscription feed. */
export const FEED_ITEM_SELECTOR = [
  'ytd-rich-item-renderer',
  'ytd-grid-video-renderer',
  'ytd-video-renderer',
  // The Shorts tab and the Shorts shelves use their own lockup element.
  'ytm-shorts-lockup-view-model',
  'ytd-reel-item-renderer',
].join(',');

/**
 * How old a feed item says it is, in milliseconds, or null if it doesn't say.
 *
 * Read off the "5 days ago" line, which is the only date a feed tile carries.
 * The words themselves live in src/dates.ts, one stem list per language.
 *
 * Read off the *metadata line only*, never the whole tile. Scanning the tile
 * meant the first "number + time word" anywhere in it won, and a title is full
 * of them: "Give Me 7 Minutes and I'll Give You 44 Years of Business Advice"
 * parsed as seven minutes old, so an eleven-day-old video sailed through a
 * "Today" filter. Titles beat metadata in the DOM order, so the bug hid
 * whichever videos advertised a duration in their name — which is most of
 * them, on this kind of channel.
 *
 * Failing to find the line returns null, and the caller keeps the item: the
 * standing trade in this file is that over-showing costs one video while
 * over-hiding looks like a broken feed.
 */
export function ageFromItemText(item: Element, language: LanguageCode): number | null {
  for (const text of metadataTexts(item)) {
    const age = parseAge(text, language);
    if (age !== null) return age;
  }
  return null;
}

/**
 * The short metadata strings on a tile — "96K views", "10 days ago" — with the
 * title and everything else left out.
 *
 * Several selectors because YouTube runs its old Polymer tiles and its newer
 * view-model lockups side by side, and which one a given shelf uses is not
 * ours to predict.
 */
function metadataTexts(item: Element): string[] {
  const texts: string[] = [];
  for (const node of item.querySelectorAll(METADATA_SELECTOR)) {
    const text = node.textContent?.trim();
    // Anything long is prose that wandered into a metadata container, not a
    // date — real ones are "10 days ago", not sentences.
    if (text && text.length <= 40) texts.push(text);
  }
  if (texts.length > 0) return texts;

  /*
   * No container we recognise. Rather than give up — which would quietly turn
   * the period filter off the next time YouTube renames a class — fall back to
   * the tile's text with the title cut out. That is the same trick
   * `bylineTextForItem` uses below, and it removes exactly the part that
   * caused this bug.
   */
  const title = item.querySelector(TITLE_SELECTOR)?.textContent?.trim() ?? '';
  const all = item.textContent?.trim() ?? '';
  return [title && all.includes(title) ? all.replace(title, ' ') : all];
}

/** Where a feed tile prints "96K views · 10 days ago". */
const METADATA_SELECTOR = [
  '#metadata-line span',
  '#metadata-line',
  '.inline-metadata-item',
  'ytd-video-meta-block #metadata',
  '.yt-content-metadata-view-model-wiz__metadata-text',
  '.yt-content-metadata-view-model__metadata-text',
  '.yt-lockup-metadata-view-model__metadata-text',
  // The Shorts lockup prints view counts only, but the same class carries any
  // date it does show.
  '.ytm-shorts-lockup-view-model__metadata',
].join(',');

/**
 * The channel name printed on a feed item, if it prints one.
 *
 * The last resort for attribution, and the one that finally caught
 * collaborations. A tile like "The Next New Thing and Corey Ganim" links
 * neither channel in a form we can read, but it *says* who made it, and we
 * hold the names of everything the user subscribes to.
 */
/**
 * Metadata that is definitely *not* a channel name.
 *
 * YouTube's current tile puts the channel and the "3.4K views · 2 days ago"
 * line in sibling elements of the same class, so "first match wins" picked the
 * metrics — and every name comparison then ran against the string "3.4k views".
 * The index was healthy, the tiles were readable, and nothing matched.
 */
const METRIC_TEXT = /(views?|watching|waiting|ago|streamed|premiered?|subscribers?)/i;

function looksLikeMetrics(text: string): boolean {
  return METRIC_TEXT.test(text) || /^[\d.,\s]+[KMB]?$/i.test(text);
}

export function bylineTextForItem(item: Element): string {
  for (const selector of [
    '#channel-name',
    'ytd-channel-name',
    '.ytd-channel-name',
    '#text.ytd-channel-name',
    '#byline',
    'yt-formatted-string.ytd-channel-name',
    '.yt-content-metadata-view-model-wiz__metadata-text',
    '.yt-content-metadata-view-model__metadata-text',
    '.yt-lockup-metadata-view-model__metadata-text',
  ]) {
    // Every match, not the first: these classes are shared by the channel row
    // and the metrics row, and which comes first is YouTube's business.
    for (const node of item.querySelectorAll(selector)) {
      const text = node.textContent?.trim();
      if (text && !looksLikeMetrics(text)) return text;
    }
  }

  /*
   * No element we recognise holds the byline. Fall back to the tile's own text
   * with the title removed — the title is the one part guaranteed *not* to be
   * the channel, and it is also the part most likely to contain a channel name
   * by coincidence ("I built an anti-slop system" mentioning nobody, but "The
   * Futur explained" mentioning The Futur).
   *
   * Chasing YouTube's class names has failed twice here, so this exists to
   * stop a redesign taking collaborations with it.
   */
  const title = item.querySelector(TITLE_SELECTOR)?.textContent?.trim() ?? '';
  const all = item.textContent?.trim() ?? '';
  return title && all.includes(title) ? all.replace(title, ' ').trim() : all;
}

/** Where a feed tile prints its video title. */
const TITLE_SELECTOR = [
  '#video-title',
  'a#video-title-link',
  '.yt-lockup-metadata-view-model-wiz__title',
  'h3',
].join(',');

/**
 * The video a feed item currently points at.
 *
 * Used to notice when YouTube reuses a tile for a different video — its grid
 * recycles nodes as you scroll, so a tile is not a stable identity and any
 * cached answer has to be checked against what it holds *now*.
 */
export function videoIdForItem(item: Element): string {
  for (const link of item.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    const href = link.getAttribute('href') || '';
    const watch = /[?&]v=([\w-]{6,})/.exec(href);
    if (watch) return watch[1];
    const short = /\/shorts\/([\w-]{6,})/.exec(href);
    if (short) return short[1];
  }
  return '';
}

/**
 * Is this block a Shorts shelf?
 *
 * Decided by what it *links to* rather than by tag or attribute. The previous
 * version matched `ytd-rich-shelf-renderer[is-shorts]`, which YouTube does not
 * always set — the shelf renders, the attribute does not, and Shorts sail
 * through a filtered feed. Every Shorts lockup links to `/shorts/<id>`,
 * whatever the wrapper of the week is called.
 */
export function isShortsBlock(el: Element): boolean {
  return el.querySelector('a[href^="/shorts/"], a[href*="/shorts/"]') !== null;
}

/** Wrappers that become visually empty once all their items are hidden. */
export const FEED_SECTION_SELECTOR = [
  'ytd-rich-section-renderer',
  'ytd-rich-shelf-renderer',
  'ytd-item-section-renderer',
].join(',');

/** Where the group bar is inserted, most-preferred first. */
export const FEED_HEADER_ANCHORS = [
  'ytd-browse[page-subtype="subscriptions"] #contents.ytd-rich-grid-renderer',
  'ytd-browse[page-subtype="subscriptions"] ytd-rich-grid-renderer',
  'ytd-browse[page-subtype="subscriptions"] #primary',
];

export function isSubscriptionsFeed(): boolean {
  // `/feed/subscriptions/shorts` is the Shorts tab of the same feed, and wants
  // the same filtering.
  return location.pathname.startsWith('/feed/subscriptions');
}

/**
 * Is this page *about* one channel?
 *
 * Feed and home pages render subscribe buttons too — one per shelf — but they
 * belong to whatever the shelf is showing, not to the page. Anything anchored
 * to "the channel you are looking at" must check this first.
 */
export function isChannelContextPage(): boolean {
  const path = location.pathname;
  return (
    path === '/watch' ||
    path.startsWith('/@') ||
    path.startsWith('/channel/') ||
    path.startsWith('/c/') ||
    path.startsWith('/user/')
  );
}

const CHANNEL_ID_RE = /\/channel\/(UC[\w-]{20,24})/;
const HANDLE_RE = /^\/(@[^/?#]+)/;
const SHORT_RE = /\/shorts\/([\w-]{6,})/;

/**
 * Identify the channel a feed item belongs to.
 *
 * Returns either a channel ID (`UC…`) or an `@handle`, whichever the DOM
 * offers — the caller resolves handles through the subscription index. We
 * prefer the ID because handles are renameable.
 */
export function channelKeyForItem(item: Element): string | null {
  const links = item.querySelectorAll<HTMLAnchorElement>('a[href]');
  let handle: string | null = null;
  let shortId: string | null = null;

  for (const link of links) {
    const href = link.getAttribute('href') || '';
    const byId = CHANNEL_ID_RE.exec(href);
    if (byId) return byId[1];

    if (!handle) {
      const byHandle = HANDLE_RE.exec(href);
      // /@handle/videos and /@handle are channel links; /watch?v= is not.
      if (byHandle) handle = byHandle[1];
    }
    if (!shortId) {
      const byShort = SHORT_RE.exec(href);
      if (byShort) shortId = byShort[1];
    }
  }

  // A Shorts tile names no channel at all, so fall back to its video id and
  // let the caller resolve it through the video → channel map built from the
  // Atom feeds.
  return handle ?? (shortId ? `v:${shortId}` : null);
}
