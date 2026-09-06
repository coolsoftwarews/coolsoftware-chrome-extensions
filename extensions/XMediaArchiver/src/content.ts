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

  return { host, container, article };
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

async function saveOne(tweet: ScrapedTweet, item: MediaOwnership, index: number): Promise<boolean> {
  // Belt-and-braces: even though content.ts only ever calls this for items
  // the gate already confirmed, never let a save proceed without that
  // confirmation being true at the moment of the click too (PRD §5 fails
  // closed, not just at render time).
  if (!item.ownership.owned) return false;

  const ext = extensionFromUrl(item.url, item.kind);
  const filename = buildMediaFilename(item.authorHandle, tweet.id ?? '0', index, ext);
  const response = await sendDownloadMedia(item.url, filename);
  if (!response.ok) return false;

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
  return true;
}

/* ── Rendering one article's badge from a freshly-evaluated ownership set ── */

function renderBadge(badge: Badge, tweet: ScrapedTweet, owned: MediaOwnership[]): void {
  badge.container.replaceChildren();
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
    const index = mediaAll.indexOf(item) + 1;
    const kindLabel = item.kind === 'video' ? 'video' : 'image';
    const label = owned.length > 1 ? `Save ${index}` : `Save ${kindLabel}`;
    const btn = makeButton(label, `Save this post's ${kindLabel}${owned.length > 1 ? ` (${index})` : ''}`, async () => {
      const ok = await saveOne(tweet, item, index);
      btn.textContent = ok ? 'Saved' : 'Try again';
      btn.classList.toggle('xma-btn--saved', ok);
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
      for (const item of owned) {
        const index = mediaAll.indexOf(item) + 1;
        if (await saveOne(tweet, item, index)) saved++;
      }
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

/* ── Sync: re-scan the DOM, re-run the ownership gate, rebuild badges ─────── */

function syncBadges(): void {
  const viewerHandle = readViewerHandle(document); // read live — never cached (PRD §6/§7)
  const articles = findTweetArticles(document);
  const present = new Set(articles);

  for (const article of articles) {
    const tweet = extractTweet(article);
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
    const owned = ownership.filter(item => item.ownership.owned);

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
