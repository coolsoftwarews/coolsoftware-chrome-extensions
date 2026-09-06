/**
 * Runs on x.com/twitter.com. Jobs:
 *   1. re-evaluate the ownership gate (PRD §5) against every post rendered
 *      on the page, every sync pass — never cached across the virtualized
 *      timeline, never cached across an account switch mid-session (PRD §6
 *      / §7's "multi-account switch mid-session" edge case)
 *   2. float a Save control next to a post's action row for exactly the
 *      media items that gate confirms the logged-in account authored —
 *      nothing else, ever
 *   3. on click, download the media URL the page already rendered via the
 *      background relay, then record a local log entry
 *
 * X is a heavily virtualized React app: list cells get recycled as the user
 * scrolls, and any DOM node an extension inserts *inside* a React-owned
 * subtree can be wiped on the next re-render or fight X's own reconciler.
 * So this file never inserts anything into X's own tree — exactly like
 * XConversationSaver's and XCardExporter's badges in this portfolio, one
 * shadow host per post is appended to `document.documentElement` and
 * absolutely positioned over its action row from getBoundingClientRect().
 *
 * Nothing here makes a network request of its own — see PRIVACY.md. The one
 * remote request this extension ever causes is the download itself
 * (background.ts's relay to chrome.downloads.download).
 */

import { buildMediaFilename, evaluateMediaOwnership, extensionFromUrl } from './parse';
import { extractTweet, findActionRow, findTweetArticles, readViewerHandle } from './scrape';
import { addLogEntry } from './storage';
import { DownloadMediaMessage, DownloadMediaResponse, MediaOwnership, ScrapedTweet } from './types';

const UI_ATTR = 'data-xma-ui';

/* ── Shadow UI shell (one host per post) ────────────────────────────────── */

interface Badge {
  host: HTMLElement;
  container: HTMLDivElement;
  status: HTMLDivElement;
  article: HTMLElement;
}

const badges = new Map<HTMLElement, Badge>();

const SHADOW_CSS = `
  .xma-wrap {
    position: fixed;
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    max-width: 220px;
    pointer-events: auto;
    font: 12px/1.3 -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  .xma-btn {
    border: 1px solid rgba(15,20,25,.14);
    background: #ffffff;
    color: #0f1419;
    border-radius: 999px;
    padding: 4px 10px;
    cursor: pointer;
    font: inherit;
    font-weight: 600;
    white-space: nowrap;
    box-shadow: 0 2px 8px rgba(0,0,0,.14);
  }
  .xma-btn:hover { background: #eef8f0; }
  .xma-btn:focus-visible { outline: 2px solid #0d7a4f; outline-offset: 1px; }
  .xma-btn[disabled] { opacity: .6; cursor: default; }
  .xma-btn--all { background: #0d7a4f; color: #fff; border-color: #0d7a4f; }
  .xma-btn--all:hover { background: #0a6640; }
  .xma-btn--saved { background: #dcf5e6; color: #0c6b34; }
  .xma-status {
    flex-basis: 100%;
    background: #fff0f0;
    color: #8a1f1f;
    border: 1px solid rgba(138,31,31,.25);
    border-radius: 8px;
    padding: 4px 8px;
    white-space: normal;
    word-break: break-word;
  }
  .xma-status:empty { display: none; }
`;

function createBadge(article: HTMLElement): Badge {
  const host = document.createElement('div');
  host.setAttribute(UI_ATTR, '');
  host.style.cssText = 'all:initial;position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647';
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = SHADOW_CSS;
  shadow.appendChild(style);

  const container = document.createElement('div');
  container.className = 'xma-wrap';
  shadow.appendChild(container);

  // Shows a failed download's real error directly, always visible — not
  // hover-only — since the previous title-tooltip-only approach turned out
  // to be easy to miss entirely.
  const status = document.createElement('div');
  status.className = 'xma-status';
  status.setAttribute('role', 'status');
  container.appendChild(status);

  return { host, container, status, article };
}

function positionBadge(badge: Badge): void {
  const rect = badge.article.getBoundingClientRect();
  const actionRow = findActionRow(badge.article);
  const anchor = (actionRow ?? badge.article).getBoundingClientRect();

  const visible = rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth;
  if (!visible || !badge.container.childElementCount) {
    badge.container.style.display = 'none';
    return;
  }
  badge.container.style.display = 'flex';
  badge.container.style.top = `${Math.max(4, anchor.top - 4)}px`;
  badge.container.style.left = `${Math.min(window.innerWidth - 60, anchor.right + 6)}px`;
}

let repositionQueued = false;
function scheduleReposition(): void {
  if (repositionQueued) return;
  repositionQueued = true;
  requestAnimationFrame(() => {
    repositionQueued = false;
    badges.forEach(positionBadge);
  });
}

/* ── Saving ──────────────────────────────────────────────────────────────── */

function sendDownloadMedia(url: string, filename: string): Promise<DownloadMediaResponse> {
  const message: DownloadMediaMessage = { type: 'XMA_DOWNLOAD_MEDIA', url, filename };
  return new Promise(resolve => {
    try {
      chrome.runtime.sendMessage(message, (response: DownloadMediaResponse | undefined) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        resolve(response ?? { ok: false, error: 'no response' });
      });
    } catch (error) {
      resolve({ ok: false, error: error instanceof Error ? error.message : 'unknown' });
    }
  });
}

/**
 * Everything reaching here is a real https:// media URL, so it all goes
 * through the background worker's chrome.downloads.download().
 *
 * There is deliberately no blob:-download path. X's <video> src is a blob:
 * MSE handle with no file behind it — saving one cannot work, and trying was
 * exactly what produced the long run of "Network issue" failures. Blob URLs
 * are dropped or swapped for the real MP4 by withRealVideoUrls() before a
 * Save button is ever offered, so none can arrive here.
 *
 * A same-document `<a download>` click was also tried for the https:// case
 * and is wrong for it twice over: Chrome ignores the download attribute for
 * many cross-origin URLs and just navigates to the resource instead
 * (confirmed live — a profile-picture URL opened in a new tab), and
 * anchor.click() never reports whether the download actually succeeded,
 * so failures would silently show as "Saved".
 */
async function saveMedia(url: string, filename: string): Promise<DownloadMediaResponse> {
  return sendDownloadMedia(url, filename);
}

async function saveOne(tweet: ScrapedTweet, item: MediaOwnership, index: number): Promise<DownloadMediaResponse> {
  // Belt-and-braces: even though content.ts only ever calls this for items
  // the gate already confirmed, never let a save proceed without that
  // confirmation being true at the moment of the click too (PRD §5 fails
  // closed, not just at render time).
  if (!TESTING_SHOW_SAVE_ON_ALL_POSTS && !item.ownership.owned) return { ok: false, error: 'not your post' };

  const ext = extensionFromUrl(item.url, item.kind);
  const filename = buildMediaFilename(item.authorHandle, tweet.id ?? '0', index, ext);
  const response = await saveMedia(item.url, filename);
  if (!response.ok) return response;

  const savedAt = Date.now();
  await addLogEntry({
    id: `${tweet.id ?? 'unknown'}-${index}-${savedAt}`,
    postId: tweet.id ?? 'unknown',
    postUrl: tweet.url,
    handle: item.authorHandle,
    mediaType: item.kind,
    filename,
    savedAt,
  });
  return { ok: true };
}

/* ── Rendering one article's badge from a freshly-evaluated ownership set ── */

function renderBadge(badge: Badge, tweet: ScrapedTweet, owned: MediaOwnership[]): void {
  badge.container.replaceChildren(badge.status); // keeps the status line, drops the old buttons
  badge.status.textContent = '';
  if (!owned.length) return; // fail closed: nothing owned, nothing rendered — no exceptions

  const mediaAll = tweet.media;

  function makeButton(label: string, ariaLabel: string, onClick: () => Promise<void>): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'xma-btn';
    btn.textContent = label;
    btn.setAttribute('aria-label', ariaLabel);
    btn.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      btn.disabled = true;
      void onClick().finally(() => {
        btn.disabled = false;
      });
    });
    return btn;
  }

  owned.forEach(item => {
    // evaluateMediaOwnership() maps tweet.media into new spread objects, so
    // they're never the same reference as anything in mediaAll — indexOf()
    // here would always miss and return -1 for every item (confirmed live:
    // every button read "Save 0"). Matched by URL instead, which spreading
    // preserves unchanged.
    const index = mediaAll.findIndex(m => m.url === item.url) + 1;
    const kindLabel = item.kind === 'video' ? 'video' : 'image';
    const label = owned.length > 1 ? `Save ${index}` : `Save ${kindLabel}`;
    const btn = makeButton(label, `Save this post's ${kindLabel}${owned.length > 1 ? ` (${index})` : ''}`, async () => {
      const response = await saveOne(tweet, item, index);
      btn.textContent = response.ok ? 'Saved' : 'Try again';
      badge.status.textContent = response.ok ? '' : response.error ?? 'Download failed.';
      btn.classList.toggle('xma-btn--saved', response.ok);
      window.setTimeout(() => {
        btn.textContent = label;
        btn.classList.remove('xma-btn--saved');
      }, 1800);
    });
    badge.container.appendChild(btn);
  });

  // "Save all" convenience once there's more than one owned item (PRD §10:
  // "default to per-image plus one 'Save all' convenience button").
  if (owned.length > 1) {
    const allBtn = makeButton('Save all', `Save all ${owned.length} media items from this post`, async () => {
      allBtn.textContent = 'Saving…';
      let saved = 0;
      let lastError = '';
      for (const item of owned) {
        // Same fix as the per-item buttons above: match by URL, not object
        // reference, since evaluateMediaOwnership() returns new objects.
        const index = mediaAll.findIndex(m => m.url === item.url) + 1;
        const response = await saveOne(tweet, item, index);
        if (response.ok) saved++;
        else lastError = response.error ?? 'Download failed.';
      }
      badge.status.textContent = saved === owned.length ? '' : lastError;
      allBtn.textContent = saved === owned.length ? `Saved ${saved}` : `Saved ${saved}/${owned.length}`;
      allBtn.classList.toggle('xma-btn--saved', saved === owned.length);
      window.setTimeout(() => {
        allBtn.textContent = 'Save all';
        allBtn.classList.remove('xma-btn--saved');
      }, 1800);
    });
    allBtn.classList.add('xma-btn--all');
    badge.container.appendChild(allBtn);
  }
}

/* ── Real MP4 URLs, relayed from the MAIN world ───────────────────────────
   X's <video> src is a blob: MSE handle with no downloadable file behind it
   (confirmed live — every video save failed as "Network issue" while images
   from the same posts saved fine). The real progressive MP4 lives in X's own
   tweet payload, readable only from the page's own JS world — mainworld.ts
   reads it there and posts it across. Until that arrives for a given tweet,
   its video simply isn't offered. */

const realVideoUrlByTweetId = new Map<string, string>();

window.addEventListener('message', event => {
  if (event.source !== window) return;
  const data = event.data as { source?: string; type?: string; tweetId?: string; url?: string } | null;
  if (data?.source !== 'XMA_MAIN' || data.type !== 'XMA_VIDEO_URL') return;
  if (!data.tweetId || !data.url) return;
  if (realVideoUrlByTweetId.get(data.tweetId) === data.url) return;

  realVideoUrlByTweetId.set(data.tweetId, data.url);
  scheduleSync(); // a video that had no usable URL a moment ago may now have one
});

/**
 * Swaps a post's undownloadable blob: video URL for the real MP4 the MAIN
 * world found for that tweet. A video with no real URL yet is dropped rather
 * than offered — a Save button that cannot possibly work is worse than none.
 */
function withRealVideoUrls(tweet: ScrapedTweet): ScrapedTweet {
  const real = tweet.id ? realVideoUrlByTweetId.get(tweet.id) : undefined;

  const media = tweet.media
    .map(item => {
      if (item.kind !== 'video' || !item.url.startsWith('blob:')) return item;
      return real ? { ...item, url: real } : null;
    })
    .filter((item): item is (typeof tweet.media)[number] => item !== null);

  return { ...tweet, media };
}

/* ── Sync: re-scan the DOM, re-run the ownership gate, rebuild badges ─────── */

// ⚠️ TEMPORARY TEST-ONLY BYPASS — set back to false before using for real or
// committing. Shows Save on every post regardless of authorship, purely so
// the save/export mechanism itself can be checked without needing a second
// account. The real ownership gate below (evaluateMediaOwnership, and the
// re-check in saveOne) is untouched and still runs.
const TESTING_SHOW_SAVE_ON_ALL_POSTS = true;

function syncBadges(): void {
  const viewerHandle = readViewerHandle(document); // read live — never cached (PRD §6/§7)
  const articles = findTweetArticles(document);
  const present = new Set(articles);

  for (const article of articles) {
    const scraped = extractTweet(article);
    const tweet = scraped ? withRealVideoUrls(scraped) : null;
    if (!tweet || !tweet.media.length) {
      // Nothing this extension can act on — drop any stale badge and move on.
      const existing = badges.get(article);
      if (existing) {
        existing.host.remove();
        badges.delete(article);
      }
      continue;
    }

    const ownership = evaluateMediaOwnership(tweet, viewerHandle);
    const owned = TESTING_SHOW_SAVE_ON_ALL_POSTS ? ownership : ownership.filter(item => item.ownership.owned);

    let badge = badges.get(article);
    if (!owned.length) {
      // Fail closed: no owned media on this post, no badge at all — not an
      // empty one, not a disabled one, none.
      if (badge) {
        badge.host.remove();
        badges.delete(article);
      }
      continue;
    }

    if (!badge) {
      badge = createBadge(article);
      badges.set(article, badge);
    }
    renderBadge(badge, tweet, owned);
  }

  // Prune badges whose article left the DOM (X recycled the node) or is no
  // longer present in this pass.
  badges.forEach((badge, article) => {
    if (!present.has(article) || !article.isConnected) {
      badge.host.remove();
      badges.delete(article);
    }
  });

  scheduleReposition();
}

let syncTimer: number | undefined;
function scheduleSync(delay = 300): void {
  window.clearTimeout(syncTimer);
  syncTimer = window.setTimeout(syncBadges, delay);
}

/* ── Boot ────────────────────────────────────────────────────────────────── */

function boot(): void {
  if (window.top !== window) return; // no UI inside iframes (e.g. embedded posts)

  syncBadges();

  const observer = new MutationObserver(() => scheduleSync());
  observer.observe(document.body, { childList: true, subtree: true });

  window.addEventListener('scroll', scheduleReposition, { passive: true });
  window.addEventListener('resize', scheduleReposition, { passive: true });

  // Virtualized content (and a video's real source arriving after the
  // player mounts) can settle after the mutation burst ends; a light
  // interval keeps badges — and the ownership gate itself, in case the
  // logged-in account changed — honest without polling the network.
  window.setInterval(syncBadges, 4000);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
