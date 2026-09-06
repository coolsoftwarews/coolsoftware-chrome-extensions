/**
 * The DOM half: reading the logged-in account's own identity and one post's
 * media/byline off whatever X has actually rendered (PRD §5). Ported from
 * XConversationSaver's/XCardExporter's scrape.ts (the closest siblings on
 * this exact platform) for the author/permalink reading conventions, with
 * two additions those extensions didn't need: reading the viewer's own
 * handle from the left-nav profile block, and telling a post's own media
 * apart from a nested quoted post's media.
 *
 * X ships obfuscated, frequently-changing class names but keeps a fairly
 * stable set of `data-testid` attributes; every selector here is a
 * best-effort heuristic, and every field is optional — a field X didn't
 * render becomes null/empty rather than throwing. This file is DOM-bound
 * and cannot be checked headlessly; it is covered by the manual checklist
 * in README.md, the same split every DOM-reading extension in this
 * portfolio uses. **This could not be verified against a live x.com session
 * in this build environment (no network access)** — say so here rather than
 * silently guessing it's correct; verify every selector below against a
 * live session before shipping (see README's manual checklist).
 *
 * ── Why this file is the one place PRD-46 §5 lives or dies ──────────────
 * Every function here is read-only and scoped to exactly one `<article>` at
 * a time — never the wider timeline "cell" X wraps around it. That scoping
 * is what makes the repost case safe: X renders a repost as the *original*
 * post's own article (byline included) with a separate "so-and-so reposted"
 * decoration line living outside any `[data-testid="User-Name"]` block, so
 * `findNameBlocks` below only ever returns the original author — the
 * reposting account's handle is never read by this file at all, in any
 * function, anywhere. There is no variable in this file that could hold it.
 */

import { AuthorInfo, ScrapedMedia, ScrapedTweet, VideoSourceCandidate } from './types';
import { canonicalStatusUrl, chooseHighestBitrateVideoSource, normalizeHandle, parseStatusId } from './parse';

export const TWEET_SELECTOR = 'article[data-testid="tweet"]';
const VIEWER_HANDLE_SELECTOR = '[data-testid="SideNav_AccountSwitcher_Button"]';
const ACTION_ROW_SELECTOR = '[role="group"]';

function text(el: Element | null | undefined): string {
  return (el?.textContent ?? '').trim();
}

/**
 * Reads the logged-in account's own handle from X's own left-nav profile
 * block — the "logged-in identity" element (PRD §5.1). Returns '' (never
 * throws) when the nav hasn't rendered yet, the user is logged out, or the
 * handle can't be confidently read. Callers MUST treat '' as "no confirmed
 * identity" — never as a wildcard that matches anything — so the ownership
 * gate (parse.ts#isOwnPost) fails closed the same way a real mismatch would.
 */
export function readViewerHandle(root: ParentNode = document): string {
  try {
    const button = root.querySelector(VIEWER_HANDLE_SELECTOR);
    if (!button) return '';
    const spans = Array.from(button.querySelectorAll('span'))
      .map(span => (span.textContent ?? '').trim())
      .filter(Boolean);
    const handleSpan = spans.find(s => s.startsWith('@'));
    return handleSpan ? normalizeHandle(handleSpan) : '';
  } catch {
    return '';
  }
}

/** Every `[data-testid="User-Name"]` byline block directly inside one post
 *  article, excluding anything nested under X's "so-and-so reposted"
 *  social-context decoration (defensive — see this file's header comment;
 *  in current X markup that decoration never contains a User-Name block at
 *  all, but excluding it explicitly keeps a future markup change from being
 *  able to smuggle a reposter's name in as if it were a byline). */
function findNameBlocks(article: Element): Element[] {
  return Array.from(article.querySelectorAll('[data-testid="User-Name"]')).filter(
    block => !block.closest('[data-testid="socialContext"]')
  );
}

function readAuthorFromNameBlock(nameBlock: Element): AuthorInfo {
  const link = nameBlock.querySelector<HTMLAnchorElement>('a[role="link"][href^="/"]');
  const href = link?.getAttribute('href') ?? '';
  const handle = normalizeHandle(href.replace(/^\//, '').split(/[/?#]/)[0] ?? '');

  const spans = Array.from(nameBlock.querySelectorAll('span'))
    .map(span => text(span))
    .filter(Boolean);
  const author = spans.find(s => !s.startsWith('@')) ?? spans[0] ?? '';

  return { author, handle };
}

/** The nested quote-tweet embed is its own clickable card X renders with
 *  `role="link"` and a `tabindex` — distinct from the outer post's own
 *  `<article>`. Locating it from the *quoted* post's own byline block
 *  (rather than guessing a fixed class/testid) keeps this resilient to X's
 *  obfuscated markup, same instinct as every other best-effort selector in
 *  this portfolio. Returns null when there's no second byline at all, i.e.
 *  no quote-tweet on this post. */
function findQuoteContainer(quotedNameBlock: Element): Element | null {
  return quotedNameBlock.closest('div[role="link"][tabindex]');
}

function dimensionsFromUrl(url: string): { width: number | null; height: number | null } {
  const match = url.match(/(\d{2,5})x(\d{2,5})/);
  if (!match) return { width: null, height: null };
  return { width: Number(match[1]), height: Number(match[2]) };
}

/** Reads every image/video this post's article rendered, tagging each item
 *  with whether it belongs to the outer/main post or a nested quoted post
 *  (PRD §4/§5's quote-tweet distinction) so parse.ts#resolveMediaAuthor can
 *  pick the right byline for each item independently. */
function readMedia(article: Element, quoteContainer: Element | null): ScrapedMedia[] {
  const media: ScrapedMedia[] = [];

  const photos = Array.from(article.querySelectorAll<HTMLElement>('[data-testid="tweetPhoto"]'));
  for (const photo of photos) {
    const img = photo.querySelector<HTMLImageElement>('img');
    if (!img?.src) continue;
    media.push({ url: img.src, kind: 'image', source: quoteContainer?.contains(photo) ? 'quoted' : 'main' });
  }

  const players = Array.from(
    article.querySelectorAll<HTMLElement>('[data-testid="videoPlayer"], [data-testid="videoComponent"]')
  );
  for (const player of players) {
    const video = player.querySelector<HTMLVideoElement>('video');
    if (!video) continue;

    const candidates: VideoSourceCandidate[] = [];
    for (const source of Array.from(video.querySelectorAll<HTMLSourceElement>('source'))) {
      if (!source.src) continue;
      candidates.push({ url: source.src, ...dimensionsFromUrl(source.src) });
    }
    if (video.currentSrc) candidates.push({ url: video.currentSrc, ...dimensionsFromUrl(video.currentSrc) });

    // PRD §7: the highest-bitrate *real* source, never a poster/preview
    // frame. A post whose only source is a blob: MSE stream (no eligible
    // candidate) simply gets no video item here — no fallback to the
    // poster image, ever.
    const best = chooseHighestBitrateVideoSource(candidates);
    if (!best) continue;

    media.push({ url: best.url, kind: 'video', source: quoteContainer?.contains(player) ? 'quoted' : 'main' });
  }

  return media;
}

/** Reads one post `<article>` into a ScrapedTweet. Never throws — a post
 *  that fails to parse is skipped by the caller, not the whole render pass. */
export function extractTweet(article: Element): ScrapedTweet | null {
  try {
    const nameBlocks = findNameBlocks(article);
    if (!nameBlocks.length) return null;

    // The article's *own* byline — for a repost this is already the
    // original author (see this file's header comment), never the
    // reposting account.
    const mainAuthor = readAuthorFromNameBlock(nameBlocks[0]);
    const quotedNameBlock = nameBlocks.length > 1 ? nameBlocks[nameBlocks.length - 1] : null;
    const quotedAuthor = quotedNameBlock ? readAuthorFromNameBlock(quotedNameBlock) : null;
    const quoteContainer = quotedNameBlock ? findQuoteContainer(quotedNameBlock) : null;

    const timeEl = article.querySelector('time');
    const link = timeEl?.closest('a');
    const href = link?.getAttribute('href') ?? '';
    const id = parseStatusId(href);
    const url = id ? (mainAuthor.handle ? canonicalStatusUrl(mainAuthor.handle, id) : new URL(href, 'https://x.com').toString()) : '';

    return {
      id,
      url,
      mainAuthor,
      quotedAuthor,
      media: readMedia(article, quoteContainer),
    };
  } catch {
    return null;
  }
}

/** Every post article currently rendered on the page, in document order. */
export function findTweetArticles(root: ParentNode = document): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(TWEET_SELECTOR));
}

/** The action row (reply/repost/like/share) within one article — Save
 *  controls are positioned near this, not the whole card (PRD §4: "a Save
 *  button on a post's action row"). Falls back to the article's own bottom
 *  edge when the row can't be found. */
export function findActionRow(article: Element): Element | null {
  const groups = Array.from(article.querySelectorAll(ACTION_ROW_SELECTOR));
  return groups.find(g => g.querySelector('[data-testid="reply"]')) ?? groups[groups.length - 1] ?? null;
}
