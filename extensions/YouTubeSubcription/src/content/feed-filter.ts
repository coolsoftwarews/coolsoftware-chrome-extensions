/**
 * The subscription feed filter.
 *
 * Performance is the whole product here, so the hot path is deliberately dumb:
 * each feed item is classified once per video it holds (the answer is cached in
 * a data attribute alongside that video's id), and applying a group is then a
 * Set lookup plus a class toggle per item. Nothing re-queries the DOM per group
 * switch except the item list itself, and mutation bursts are coalesced into
 * one rAF frame.
 *
 * "Once per video" rather than "once per element" because YouTube's grid
 * recycles tiles, and because a tile can be classified before its byline has
 * rendered — both of which let the wrong channel through a filtered feed.
 *
 * Hiding is done with a CSS class, never by removing nodes — YouTube's
 * virtualized grid owns those nodes and will fight anyone who detaches them.
 */

import {
  FEED_ITEM_SELECTOR,
  FEED_SECTION_SELECTOR,
  ageFromItemText,
  bylineTextForItem,
  channelKeyForItem,
  isShortsBlock,
  isSubscriptionsFeed,
  videoIdForItem,
} from '../selectors';
import { StoreShape } from '../types';
import { isDebug, log, warn } from './debug';
import { setFeedPeriod } from '../storage';
import { LanguageCode, detectLanguage } from '../dates';

const KEY_ATTR = 'data-ysg-key';
const VIDEO_ATTR = 'data-ysg-vid';
/**
 * What this tile was last decided *for*: `<group>:<videoId>`.
 *
 * The Shorts tab is where this started to matter. Every pass used to redo the
 * whole decision for every tile on the page, and the page grows without bound
 * as you scroll — so by tile 800 each mutation burst was re-deciding 800 tiles
 * to discover nothing had changed. Skipping settled tiles makes a pass cost
 * roughly what the *new* tiles cost.
 */
const DECIDED_ATTR = 'data-ysg-for';
const HIDDEN_CLASS = 'ysg-hidden';
const ACTIVE_BODY_CLASS = 'ysg-filtering';

/** Handle (`@name`) → channel ID, so items that only link a handle resolve. */
let handleToId = new Map<string, string>();
/** Video id → channel ID, which is the only way a Shorts tile can be placed. */
let videoToChannel: Record<string, string> = {};
/**
 * Lower-cased channel name → channel ID, longest name first.
 *
 * Longest first because names nest: "Alex Becker's Channel" starts with
 * nothing else, but "Alex Becker Business" and "Alex Becker" would both match
 * a byline beginning "Alex Becker Business", and the longer one is right.
 */
let namesByLength: Array<[string, string]> = [];
/** Channel IDs allowed by the active group; null = no filtering. */
let allowed: Set<string> | null = null;
/** The active group's id, used to tell one filter from another. */
let activeId = '';
/** Only show videos this recent; null shows everything. */
let periodDays: number | null = null;
/** Published time per video id, from the Atom feeds — exact where we have it. */
let publishedAt: Record<string, number> = {};
/** Language the tiles are written in; detected unless the user overrode it. */
let language: LanguageCode = 'en';

let observer: MutationObserver | null = null;
let frame = 0;

/**
 * Running totals for this page, so the safety valve can judge the feed rather
 * than the last handful of tiles. Reset when the filter changes or we leave.
 */
/*
 * Counted as *tiles*, not as observations.
 *
 * Unidentified tiles are deliberately never settled — they get another go on
 * every pass, once YouTube has finished rendering them or a Refresh has filled
 * the video map. Adding them to a running total each time meant three stubborn
 * collaborations became "64 feed items" after twenty passes, which crossed the
 * valve's threshold and switched filtering off on a feed that was being read
 * perfectly well.
 */
const resolvedIds = new Set<string>();
const unresolvedIds = new Set<string>();

export function setIndex(store: StoreShape): void {
  handleToId = new Map();
  for (const c of store.channels) {
    if (c.handle) handleToId.set(c.handle.toLowerCase(), c.id);
  }
  videoToChannel = store.videoOwners;
  publishedAt = {};
  for (const video of store.videos) publishedAt[video.videoId] = video.publishedAt;

  namesByLength = store.channels
    .map((c) => [c.name.trim().toLowerCase(), c.id] as [string, string])
    .filter(([name]) => name.length >= 3)
    .sort((a, b) => b[0].length - a[0].length);
}

export function setActive(store: StoreShape): void {
  const group = store.groups.find((g) => g.id === store.activeGroupId);
  allowed = group ? new Set(group.channelIds) : null;
  activeId = group?.id ?? '';
  periodDays = store.feedPeriodDays;
  language =
    store.feedLanguage === 'auto' ? detectLanguage() : (store.feedLanguage as LanguageCode);
  resolvedIds.clear();
  unresolvedIds.clear();
  document.body.classList.toggle(
    ACTIVE_BODY_CLASS,
    allowed !== null || periodDays !== null,
  );
  apply();
}

/** Start watching the feed. Safe to call repeatedly; only one observer runs. */
export function startObserving(): void {
  if (observer) return;
  observer = new MutationObserver(() => schedule());
  observer.observe(document.body, { childList: true, subtree: true });
}

export function stopObserving(): void {
  observer?.disconnect();
  observer = null;
  cancelAnimationFrame(frame);
  frame = 0;
  clearTimeout(timer);
  timer = 0;
}

/**
 * How often a mutation-driven pass may run, in milliseconds.
 *
 * A frame was too eager. YouTube's feed mutates continuously — lazy thumbnails,
 * hover previews, its own timers — and every mutation scheduled another pass,
 * so on a long feed this ran ~60 times a second forever. Each pass walks every
 * tile on the page and fully re-examines the ones it could not identify, which
 * on a feed with a Shorts shelf is dozens of tiles × several selector queries.
 *
 * That is main-thread work, and it showed: opening a `<select>` in the insights
 * overlay took seconds, because the browser could not get a turn.
 *
 * 100ms is far below the threshold where a reader notices a tile settling, and
 * it cuts the work by roughly six times. Filter changes do not wait for it —
 * `setActive` calls `apply` directly, so acting on a group is still immediate.
 */
const PASS_INTERVAL_MS = 100;

let lastPass = 0;
let timer = 0;

function schedule(): void {
  if (frame || timer) return;

  const due = lastPass + PASS_INTERVAL_MS - performance.now();
  if (due > 0) {
    timer = window.setTimeout(() => {
      timer = 0;
      schedule();
    }, due);
    return;
  }

  // Still on a frame, so the pass lands with the browser's own paint rather
  // than mid-layout.
  frame = requestAnimationFrame(() => {
    frame = 0;
    lastPass = performance.now();
    apply();
  });
}

/** Reveal everything and drop cached keys — used when leaving the feed. */
export function reset(): void {
  resolvedIds.clear();
  unresolvedIds.clear();
  document.body.classList.remove(ACTIVE_BODY_CLASS);
  for (const el of document.querySelectorAll(`.${HIDDEN_CLASS}`)) {
    el.classList.remove(HIDDEN_CLASS);
  }
}

function apply(): void {
  if (!isSubscriptionsFeed()) return;

  const started = performance.now();
  let hidden = 0;
  let unresolved = 0;
  let resolved = 0;
  let shortsUnresolved = 0;
  let decided = 0;
  let staleCount = 0;

  // Identifies the current filter. When it changes, every tile is re-decided;
  // while it holds, a settled tile is left alone.
  const filterId = `${allowed === null ? 'all' : `g${allowed.size}:${activeId}`}:${periodDays ?? 0}`;

  /** Tiles we could not attribute this pass; resolved in a sweep below. */
  const unknown: HTMLElement[] = [];

  const items = document.querySelectorAll<HTMLElement>(FEED_ITEM_SELECTOR);
  for (const item of items) {
    /*
     * Classify once *per video*, and only cache an answer worth keeping.
     *
     * Two ways the previous "classify once, cache forever" let strangers into
     * a filtered feed:
     *
     * 1. Classifying too early. A tile that has rendered its thumbnail but not
     *    yet its byline has no channel link, and the cached "unknown" was never
     *    revisited — so that tile kept whatever the unknown rule gave it for
     *    the life of the page. Empty results are no longer cached.
     *
     * 2. Node reuse. YouTube's grid recycles tiles as you scroll, so the same
     *    element holds a different video later, wearing the old answer. The
     *    cached video id catches that.
     */
    const videoId = videoIdForItem(item);
    if (item.getAttribute(DECIDED_ATTR) === `${filterId}:${videoId}`) {
      if (item.classList.contains(HIDDEN_CLASS)) hidden++;
      /*
       * A settled tile is a tile we identified: nothing else is ever settled —
       * unknowns are left open on purpose. Counting it keeps the valve honest
       * across a reset, which happens on *any* store change. Changing a
       * setting used to zero the tally while every tile on the page stayed
       * settled, so "identified nothing" became true again and the next few
       * unknowns tripped the valve.
       */
      if (videoId) resolvedIds.add(videoId);
      continue;
    }
    decided++;

    let key = item.getAttribute(KEY_ATTR);

    if (key === null || key === '' || item.getAttribute(VIDEO_ATTR) !== videoId) {
      key = channelKeyForItem(item) ?? '';
      if (key !== '') {
        item.setAttribute(KEY_ATTR, key);
        item.setAttribute(VIDEO_ATTR, videoId);
      } else {
        item.removeAttribute(KEY_ATTR);
      }
    }

    if (allowed === null) {
      // The period filter is independent of the group filter and still applies.
      const fresh = withinPeriod(item, videoId);
      item.classList.toggle(HIDDEN_CLASS, !fresh);
      if (!fresh) {
        hidden++;
        staleCount++;
      }
      item.setAttribute(DECIDED_ATTR, `${filterId}:${videoId}`);
      continue;
    }

    const id = resolve(key, videoId) ?? resolveByName(item);
    if (id === undefined) {
      // Undecided for now. Held back rather than shown, and re-examined next
      // pass — see the sweep below, which decides what "undecided" means.
      unknown.push(item);

      /*
       * A Shorts tile that would not resolve is not evidence of anything.
       *
       * It names no channel at all — no byline, no channel link — so the only
       * route to one is its video id in the Atom-feed map, and Shorts are
       * routinely absent from those feeds. Counting those failures toward the
       * "we cannot read this feed" valve meant a shelf of Shorts could convince
       * it the selectors were dead and switch filtering off for the whole page.
       * That is what filled the extension's error log with warnings whose own
       * examples were "19K views" — a Shorts lockup's entire text.
       *
       * They are still held back, which is unchanged: an unattributable tile is
       * not a member of the group by any reading. They just no longer get a
       * vote on whether the feed is readable.
       */
      if (isShorts(item, videoId)) shortsUnresolved++;
      else if (videoId) unresolvedIds.add(videoId);
      else unresolved++;
      continue;
    }
    resolved++;
    if (videoId) resolvedIds.add(videoId);

    const fresh = withinPeriod(item, videoId);
    if (!fresh) staleCount++;
    const show = allowed.has(id) && fresh;
    if (!show) hidden++;
    item.classList.toggle(HIDDEN_CLASS, !show);
    item.setAttribute(DECIDED_ATTR, `${filterId}:${videoId}`);
  }

  /*
   * What to do with tiles we could not attribute.
   *
   * They are collaborations — "Microsoft Developer and 2 more", "Sabaton and 3
   * more" — where the name printed is a *collaborator*, and the channel that
   * actually uploaded may not be one the user follows at all. Nothing in the
   * tile identifies it, so it is hidden: it is not a member of the group by any
   * reading, and showing it was the "strangers sneak in" complaint.
   *
   * The safety valve stays, but measured over the whole page rather than per
   * pass. Per pass was wrong and visibly so: scrolling into a run of nine old
   * collaborations tripped it, and the entire feed unfiltered itself. What the
   * valve is actually for is "our selectors no longer match anything", and that
   * shows up as resolving *nothing at all* over a meaningful sample — not as a
   * bad patch in an otherwise readable feed.
   */
  /*
   * Counted explicitly rather than as `decided - unresolved`.
   *
   * That subtraction quietly assumed every re-decided tile was either resolved
   * or unresolved, which stopped being true the moment Shorts were excluded
   * from the tally — they would have come out of the arithmetic as *resolved*,
   * and the valve could then never fire at all.
   */
  const identified = resolvedIds.size + resolved;
  const seen = identified + unresolvedIds.size + unresolved;
  const brokenLooking = identified === 0 && seen >= 20;

  for (const item of unknown) {
    item.classList.toggle(HIDDEN_CLASS, !brokenLooking);
    if (!brokenLooking) hidden++;
    // Deliberately not settled: the next pass tries again, once YouTube has
    // finished rendering the tile or the next Refresh has filled the map.
  }

  /*
   * Name what could not be placed. "3 unidentifiable" cost several rounds of
   * guessing; "unidentifiable: The Futur Podcast and 2 more" would not have.
   *
   * Shorts are counted rather than listed. They fail for a known and boring
   * reason, and printing "19K views" three times per pass buried the tiles that
   * fail for reasons worth chasing.
   */
  const puzzling =
    brokenLooking || isDebug()
      ? unknown.filter((item) => !isShorts(item, videoIdForItem(item)))
      : [];
  if (isDebug() && (puzzling.length > 0 || shortsUnresolved > 0)) {
    log(
      `unidentifiable: ${shortsUnresolved} shorts` +
        (puzzling.length === 0
          ? ''
          : ` | ${puzzling.map((item) => bylineTextForItem(item) || '(no byline)').join(' | ')}`),
    );
  }

  if (brokenLooking) {
    /*
     * Say *why* nothing resolved, not just that nothing did.
     *
     * The four routes to a channel fail for different reasons and want
     * different fixes: no handles means the subscription scrape came back
     * thin, an empty video map means the upload check did not finish, and a
     * healthy index with unreadable tiles means YouTube changed the feed's
     * markup. The first version of this message named none of them, which
     * turned a self-explaining warning into a support conversation.
     */
    warn(
      `could not identify any of ${seen} feed tiles (Shorts excluded) — showing everything ` +
        'rather than hiding a feed we cannot read. Index: ' +
        `${handleToId.size} handles, ${namesByLength.length} names, ` +
        `${Object.keys(videoToChannel).length} known videos. Examples: ` +
        puzzling
          .slice(0, 3)
          .map((item) => bylineTextForItem(item).slice(0, 40) || '(no byline)')
          .join(' | '),
    );
  }

  markEndOfPeriod(staleCount);
  collapseEmptySections();

  // The three numbers that explain any "filtering does nothing" report: did we
  // find the feed at all, could we identify the channels in it, and did the
  // active group match anything.
  log(
    `filter: ${items.length} items (${decided} re-decided), ${hidden} hidden, ` +
      `${resolvedIds.size} identified, ${unresolvedIds.size} unidentifiable ` +
      `(+${shortsUnresolved} shorts this pass), ` +
      `allowed=${allowed === null ? 'all' : allowed.size} ` +
      `channels, ${(performance.now() - started).toFixed(1)}ms`,
  );
}

/**
 * Match a tile's printed byline against the names of subscribed channels.
 *
 * Only reached when links and the video map have both failed, which in
 * practice means a collaboration: "The Next New Thing and Corey Ganim" names
 * its channels and links none of them. A byline *starts* with the uploading
 * channel, so a prefix match is the right test — and it is checked
 * longest-name-first so nested names resolve to the longer one.
 */
function resolveByName(item: Element): string | undefined {
  const byline = bylineTextForItem(item).toLowerCase();
  const found = byline ? matchName(byline) : undefined;
  if (found) return found;

  /*
   * The byline was readable and matched nothing, so try the whole tile.
   *
   * Previously a byline that *existed* ended the search, which meant one bad
   * reading — "3.4K views" — killed every remaining route. A wrong answer from
   * one source should cost that source, not the question.
   */
  const title = item.querySelector('#video-title, a#video-title-link, h3')?.textContent ?? '';
  const all = (item.textContent ?? '').replace(title, ' ').toLowerCase();
  return all ? matchName(all) : undefined;
}

/** Longest known channel name this text starts with, or failing that contains. */
function matchName(text: string): string | undefined {
  // A prefix match is the honest one: a byline starts with the uploader.
  for (const [name, id] of namesByLength) {
    if (text.startsWith(name)) return id;
  }

  // Failing that, the name appearing anywhere. Looser, and it could in
  // principle match a title that mentions a channel — but the alternative is an
  // unplaceable tile, and this only runs after every other route has failed.
  for (const [name, id] of namesByLength) {
    if (name.length >= 6 && text.includes(name)) return id;
  }
  return undefined;
}

const END_ID = 'ysg-end';

/**
 * Tell the reader where the period stops.
 *
 * A marker in the feed rather than a dialog: the fact belongs where the videos
 * ran out, and a modal over a page you are scrolling is an interruption to
 * dismiss rather than an answer to read. It also gives the escape hatch a
 * place to live — the way out of a filter should be next to its effect.
 */
function markEndOfPeriod(staleCount: number): void {
  const existing = document.getElementById(END_ID);

  if (periodDays === null || staleCount === 0) {
    existing?.remove();
    return;
  }

  const container = document.querySelector<HTMLElement>(FEED_ITEM_SELECTOR)?.parentElement;
  if (!container) return;

  const marker = existing ?? document.createElement('div');
  if (!existing) {
    marker.id = END_ID;
    marker.className = 'ysg-end';

    const text = document.createElement('span');
    text.className = 'ysg-end__text';
    marker.append(text);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ysg-end__btn';
    button.textContent = 'Show everything';
    button.addEventListener('click', () => void setFeedPeriod(null));
    marker.append(button);
  }

  const label = marker.querySelector('.ysg-end__text');
  if (label) {
    label.textContent =
      `That is everything from the last ${periodDays} ` +
      `${periodDays === 1 ? 'day' : 'days'} — ${staleCount} older ` +
      `${staleCount === 1 ? 'video is' : 'videos are'} hidden.`;
  }

  // Always last: the grid grows as you scroll, and a marker that stays put ends
  // up in the middle of the feed claiming to be the end of it.
  if (marker.parentElement !== container || marker.nextElementSibling !== null) {
    container.append(marker);
  }
}

const SHORTS_ATTR = 'data-ysg-short';

/**
 * Is this tile a Short? Asked once per video, then remembered on the node.
 *
 * `isShortsBlock` runs a `querySelector` over the tile, and unidentified tiles
 * are re-examined on *every* pass — by design, so a tile that had not finished
 * rendering gets another chance. Multiplying that by a selector query per pass
 * per tile is how a filter that should be invisible starts costing frames.
 *
 * Cached against the video id, not the element: YouTube recycles tiles as you
 * scroll, and a node that held a Short a moment ago can hold a normal upload
 * now. Same reason `DECIDED_ATTR` carries one.
 */
function isShorts(item: Element, videoId: string): boolean {
  const cached = item.getAttribute(SHORTS_ATTR);
  if (cached !== null && cached.slice(2) === videoId) return cached[0] === '1';
  const answer = isShortsBlock(item);
  item.setAttribute(SHORTS_ATTR, `${answer ? '1' : '0'}:${videoId}`);
  return answer;
}

/**
 * Is this item inside the chosen period?
 *
 * Exact where we have it — the Atom feeds give a real publication time for
 * recent uploads — and the tile's own "5 days ago" line otherwise. An item that
 * states no age at all is kept: the cost of over-showing is one extra video,
 * while the cost of over-hiding is a feed that looks broken.
 */
function withinPeriod(item: Element, videoId: string): boolean {
  if (periodDays === null) return true;

  const cutoff = periodDays * 86_400_000;
  const exact = videoId ? publishedAt[videoId] : undefined;
  if (exact !== undefined) return Date.now() - exact <= cutoff;

  const age = ageFromItemText(item, language);
  return age === null || age <= cutoff;
}

/**
 * Resolve a feed item to a channel id.
 *
 * The key from `channelKeyForItem` has three shapes: a bare `UC…` id, an
 * `@handle` to look up in the subscription list, or `v:<videoId>` from a Shorts
 * tile. When none of them lands, the video id itself is the last resort.
 *
 * That last resort is not theoretical. A **collaboration** — "The Next New
 * Thing and Leveling Up with Eric Siu" — is rendered as a byline naming two
 * channels and linking neither in a form we can read, so the tile looks
 * anonymous and, failing soft, stayed visible in a filtered feed. But the video
 * belongs to a channel that publishes it, and that channel's Atom feed lists
 * it: the same `videoId → channel` map built for Shorts answers this too.
 */
function resolve(key: string, videoId: string): string | undefined {
  if (key.startsWith('@')) {
    const byHandle = handleToId.get(key.toLowerCase());
    if (byHandle) return byHandle;
  } else if (key.startsWith('v:')) {
    const byShort = videoToChannel[key.slice(2)];
    if (byShort) return byShort;
  } else if (key !== '') {
    return key;
  }

  return videoId ? videoToChannel[videoId] : undefined;
}

/**
 * Hide shelves/sections left with nothing visible inside them.
 *
 * This walks each section's children, so it is the expensive half of a pass.
 * The Shorts tab has no shelves at all — one flat grid — so on that page the
 * whole thing is skipped rather than paid for on every mutation.
 */
function collapseEmptySections(): void {
  // Shorts shelves filter tile by tile like everything else; a shelf is only
  // removed when nothing inside it survived.
  const sections = document.querySelectorAll<HTMLElement>(FEED_SECTION_SELECTOR);
  if (sections.length === 0) return;

  for (const section of sections) {
    if (allowed === null) {
      section.classList.remove(HIDDEN_CLASS);
      continue;
    }
    const total = section.querySelectorAll(FEED_ITEM_SELECTOR).length;
    if (total === 0) continue;
    const hidden = section.querySelectorAll(`.${HIDDEN_CLASS}`).length;
    section.classList.toggle(HIDDEN_CLASS, hidden >= total);
  }
}
