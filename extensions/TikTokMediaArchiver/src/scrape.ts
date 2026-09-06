/**
 * The DOM half of this extension: finding post tiles on whatever TikTok page
 * is open, and reading three things off them — the logged-in account's own
 * handle, a post's author handle, and the video source URL the page's own
 * player already loaded. This is the part that cannot be unit tested (no
 * browser here) and is covered by the manual checklist in README.md instead
 * — the same split every DOM-reading extension in this portfolio uses
 * (TikTokProductScout's scan.ts, XConversationSaver's scrape.ts).
 *
 * PRD-45 §5 makes this file the most safety-critical one in the extension:
 * the Save button must never render on a post the logged-in account did not
 * author, and that decision is only as good as the two handles read here.
 * Both lookups are deliberately layered with fallbacks and never guess: a
 * selector that can't confidently resolve returns null, and null anywhere in
 * the chain means content.ts's gate fails closed (no button) rather than
 * rendering on a maybe-match. Nothing here ever writes to the page beyond
 * the Save-button overlay in content.ts, and nothing here makes a network
 * request — see PRIVACY.md.
 */

import { extractHandle, extractVideoId } from './parse';

const UI_ATTR = 'data-tma-ui';
const MAX_ANCESTOR_CLIMB = 8;

/* ── The logged-in account's own handle ─────────────────────────────── */

/**
 * TikTok's own nav carries a "Profile" link that resolves to `/@<own-handle>`
 * (PRD-45 §5.1). It is looked up by accessible name first ("Profile" is the
 * link's own text or aria-label, not a class name TikTok is free to rename
 * without notice), then by a couple of `data-e2e` hooks TikTok has used for
 * the same link historically, in that order — the first one that resolves
 * to a `/@handle` href wins. Anything else — no nav found, no link found, a
 * href that isn't a profile link — returns null, which content.ts treats as
 * "cannot confirm login" and shows no Save button anywhere (PRD-45 §5.3:
 * "no confirmed logged-in handle at all means no button").
 */
export function readOwnHandle(root: ParentNode = document): string | null {
  const byAccessibleName = Array.from(root.querySelectorAll<HTMLAnchorElement>('a[href^="/@"]')).find(anchor => {
    const label = (anchor.getAttribute('aria-label') ?? anchor.textContent ?? '').trim();
    return /^profile$/i.test(label);
  });
  if (byAccessibleName) {
    const handle = extractHandle(byAccessibleName.getAttribute('href'));
    if (handle) return handle;
  }

  const dataE2eSelectors = [
    '[data-e2e="nav-profile"] a[href^="/@"]',
    'a[data-e2e="nav-profile"][href^="/@"]',
    '[data-e2e="profile-icon"] a[href^="/@"]',
  ];
  for (const selector of dataE2eSelectors) {
    const anchor = root.querySelector<HTMLAnchorElement>(selector);
    if (!anchor) continue;
    const handle = extractHandle(anchor.getAttribute('href'));
    if (handle) return handle;
  }

  return null;
}

/* ── A post's author handle ─────────────────────────────────────────── */

const AUTHOR_TEXT_SELECTORS = [
  '[data-e2e="video-author-uniqueid"]',
  '[data-e2e="browse-username"]',
  '[data-e2e="user-username"]',
];

/**
 * Reads the post's own byline (PRD-45 §5.2). Tries TikTok's known author
 * `data-e2e` hooks first (their text is the bare handle, no "@" and no
 * anchor needed), then falls back to the handle embedded in the tile's own
 * link to the watch page. Never falls back to the *page URL* — on a profile
 * page or a feed tile that lazily hasn't rendered its own link yet, that
 * would silently attribute the wrong author, exactly the failure mode the
 * gate exists to prevent.
 */
export function readPostAuthorHandle(tile: ParentNode): string | null {
  for (const selector of AUTHOR_TEXT_SELECTORS) {
    const el = tile.querySelector(selector);
    const text = el?.textContent?.trim();
    if (text) return text.startsWith('@') ? text : `@${text}`;
  }

  const anchor = tile.querySelector<HTMLAnchorElement>('a[href*="/video/"], a[href^="/@"]');
  const fromHref = extractHandle(anchor?.getAttribute('href') ?? null);
  if (fromHref) return fromHref;

  return null;
}

/* ── Post tiles ──────────────────────────────────────────────────────── */

function videoAnchors(root: ParentNode): HTMLAnchorElement[] {
  return Array.from(root.querySelectorAll<HTMLAnchorElement>('a[href*="/video/"]'));
}

/**
 * Climbs from a video link to the element that most likely represents "one
 * post" — the thing a Save button should be pinned to. There is no reliable
 * class name to key off (TikTok's own redesigns rename those first), so this
 * walks up looking for the first ancestor meaningfully bigger than the
 * anchor itself and gives up rather than guess past a sane depth. Same
 * approach as TikTokProductScout's scan.ts#nearestTile.
 */
function nearestTile(anchor: HTMLAnchorElement): HTMLElement {
  let node: HTMLElement = anchor;
  const anchorRect = anchor.getBoundingClientRect();
  const anchorArea = anchorRect.width * anchorRect.height;

  for (let i = 0; i < MAX_ANCESTOR_CLIMB && node.parentElement; i++) {
    const parent = node.parentElement;
    const rect = parent.getBoundingClientRect();
    if (anchorArea > 0 && rect.width * rect.height > anchorArea * 1.15) return parent;
    node = parent;
  }
  return anchor.parentElement ?? anchor;
}

export interface PostTile {
  tile: HTMLElement;
  anchor: HTMLAnchorElement;
  postId: string;
  postUrl: string;
}

/** Every not-yet-processed post tile currently in the document, with its id
 *  and canonical URL already parsed. Skips our own overlay and anything
 *  without a resolvable post id. */
export function findPostTiles(): PostTile[] {
  const seen = new Set<HTMLElement>();
  const results: PostTile[] = [];

  for (const anchor of videoAnchors(document)) {
    if (anchor.closest(`[${UI_ATTR}]`)) continue; // never scan our own overlay
    const postId = extractVideoId(anchor.href);
    if (!postId) continue;

    let tile: HTMLElement;
    try {
      tile = nearestTile(anchor);
    } catch {
      continue;
    }
    if (seen.has(tile)) continue;
    seen.add(tile);
    results.push({ tile, anchor, postId, postUrl: anchor.href });
  }

  return results;
}

/* ── The video source URL the page's own player already loaded ─────── */

/**
 * Reads the `<video>` element's `currentSrc` (falling back to `src`) inside
 * a tile — the clean, un-watermarked file TikTok's own player streamed to
 * render the post (PRD-45 §1/§2), not a re-encode and not TikTok's
 * watermarked "Save video" export. Returns '' rather than null when nothing
 * is found, so callers can treat "not ready yet" and "definitely absent" the
 * same way while polling (see waitForVideoSourceUrl).
 */
export function readVideoSourceUrl(tile: ParentNode): string {
  const video = tile.querySelector<HTMLVideoElement>('video');
  return video?.currentSrc || video?.src || '';
}

/**
 * Waits for a real source URL rather than saving a low-quality placeholder
 * (PRD-45 §7: "the button waits for a real source URL... if none appears
 * within a short bound, it says so rather than silently saving nothing").
 * Polls every 250ms up to `timeoutMs`; resolves the first usable URL it
 * sees, or null if the bound elapses first.
 */
export function waitForVideoSourceUrl(
  tile: ParentNode,
  isUsable: (url: string) => boolean,
  timeoutMs = 6000,
  pollMs = 250
): Promise<string | null> {
  return new Promise(resolve => {
    const deadline = Date.now() + timeoutMs;

    const attempt = () => {
      const url = readVideoSourceUrl(tile);
      if (isUsable(url)) {
        resolve(url);
        return;
      }
      if (Date.now() >= deadline) {
        resolve(null);
        return;
      }
      window.setTimeout(attempt, pollMs);
    };

    attempt();
  });
}

export const __internal = { nearestTile, UI_ATTR };
