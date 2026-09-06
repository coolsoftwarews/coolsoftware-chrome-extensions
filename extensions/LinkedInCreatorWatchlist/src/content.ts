/**
 * Runs on linkedin.com. Three jobs, and nothing else:
 *
 *   1. Show a "+ Watch / Watching ✓" button on a profile and on every post's
 *      author line (PRD §4).
 *   2. When a post from a *watched* person is on screen, capture or update it
 *      (PRD §4 "Collection is browsing-driven" — nothing is collected for
 *      anyone not already being watched, and nothing is fetched; only what
 *      LinkedIn already rendered for the user is read).
 *   3. Never write anything back to LinkedIn. There is no code path here that
 *      posts, likes, follows, connects or messages — see PRIVACY.md.
 *
 * LinkedIn's DOM changes often and is not documented, so every extraction
 * step below degrades to "skip this post" rather than throwing (PRD §7:
 * "Feed DOM rewrites — LinkedIn ships these often"). The selectors are a
 * best-effort read of the *visible* page, not an API; see README.md's manual
 * test checklist for how to re-verify them against the live site.
 */

import { track } from './metrics';
import { unwatchPerson, upsertPost, watchPerson } from './storage';
import { CollectedPost, PostType, WatchedPerson } from './types';
import { extractCounts, normalizePostUrl, normalizeProfileUrl, parseRelativeTime, previewFor, truncateText } from './text';

const PROCESSED_ATTR = 'data-lcw-post';
const BUTTON_ATTR = 'data-lcw-watch';

/** Kept in sync with storage so every button on the page reflects the true state (PRD §4: "+ Watch · Watching ✓"). */
const watchedIds = new Set<string>();
/** id → the button hosts on the page showing that person, so a toggle anywhere updates them all. */
const buttonsByPerson = new Map<string, Set<HTMLElement>>();

function registerButton(id: string, host: HTMLElement): void {
  const set = buttonsByPerson.get(id) ?? new Set<HTMLElement>();
  set.add(host);
  buttonsByPerson.set(id, set);
}

function paintButtons(id: string): void {
  const watching = watchedIds.has(id);
  for (const host of buttonsByPerson.get(id) ?? []) {
    const button = host.shadowRoot?.querySelector('button');
    if (!button) continue;
    button.textContent = watching ? 'Watching ✓' : '+ Watch';
    button.setAttribute('aria-pressed', String(watching));
    button.classList.toggle('on', watching);
  }
}

/* ── Extraction helpers — read-only, best effort ─────────────────────── */

function firstMatch(root: ParentNode, selectors: string[]): HTMLElement | null {
  for (const selector of selectors) {
    const el = root.querySelector<HTMLElement>(selector);
    if (el) return el;
  }
  return null;
}

function findAuthorLinks(container: Element): Array<{ href: string; name: string }> {
  const anchors = Array.from(container.querySelectorAll<HTMLAnchorElement>('a[href*="/in/"]'));
  const seen = new Set<string>();
  const results: Array<{ href: string; name: string }> = [];
  for (const anchor of anchors) {
    const name = truncateText(anchor.textContent || '', 120);
    if (!name) continue;
    const href = normalizeProfileUrl(anchor.href);
    if (seen.has(href)) continue;
    seen.add(href);
    results.push({ href, name });
  }
  return results;
}

/**
 * LinkedIn shows "X reposted this" above the embedded original post. Two
 * distinct author links in a container is the signal; the *second* one is the
 * post's real author, the first is whoever reposted it (PRD §7: attribute
 * reposts to the original author, mark them as a repost).
 */
function detectRepostAuthor(container: Element): { author: { href: string; name: string }; isRepost: boolean } | null {
  const authors = findAuthorLinks(container);
  if (!authors.length) return null;

  const headText = container.textContent?.slice(0, 160).toLowerCase() ?? '';
  const looksReposted = /reposted|reshared/.test(headText);

  if (looksReposted && authors.length > 1) {
    return { author: authors[1], isRepost: true };
  }
  return { author: authors[0], isRepost: false };
}

function findAvatar(container: Element): string {
  const img = container.querySelector<HTMLImageElement>('img[class*="profile-photo"], img[class*="EntityPhoto"], img');
  return img?.src ?? '';
}

function findHeadline(container: Element): string {
  const el = firstMatch(container, [
    '[class*="actor__description"]',
    '[class*="update-components-actor__description"]',
    '.text-body-small',
  ]);
  return truncateText(el?.textContent || '', 160);
}

function derivePostType(container: Element): PostType {
  if (container.querySelector('video')) return 'video';
  if (container.querySelector('[class*="document-s-container"], [class*="feed-shared-document"]')) return 'document';
  if (container.querySelector('[class*="feed-shared-poll"]')) return 'poll';
  if (container.querySelector('[class*="feed-shared-article"], [class*="feed-shared-external-video"]')) return 'article';
  if (container.querySelector('[class*="feed-shared-image"], [class*="update-components-image"]')) return 'image';
  return 'other';
}

function derivePostText(container: Element): string {
  const el = firstMatch(container, [
    '.update-components-text',
    '.feed-shared-inline-show-more-text',
    '[class*="feed-shared-update-v2__description"]',
    '[class*="feed-shared-text"]',
  ]);
  return el?.textContent ?? '';
}

function deriveCounts(container: Element): { reactions: number; comments: number; reposts: number } {
  const el = firstMatch(container, ['[class*="social-details-social-counts"]', '[class*="social-counts"]']);
  return extractCounts((el ?? container).textContent ?? '');
}

function deriveRelativeLabel(container: Element): string {
  const el = firstMatch(container, ['[class*="actor__sub-description"]', 'time', '[class*="update-components-actor__sub-description"]']);
  const text = el?.textContent ?? '';
  const match = text.match(/\d+\s*(?:s|m|h|d|w|mo|yr)\b/i);
  return match ? match[0] : '';
}

function derivePostUrn(container: Element): string | null {
  let node: Element | null = container;
  while (node) {
    const urn = node.getAttribute('data-urn');
    if (urn && /^urn:li:(activity|share|ugcPost):/.test(urn)) return urn;
    node = node.parentElement;
  }
  return null;
}

function derivePostUrl(container: Element, urn: string | null): string {
  const link = container.querySelector<HTMLAnchorElement>('a[href*="/posts/"], a[href*="/feed/update/"]');
  if (link) return normalizePostUrl(link.href);
  if (urn) return `https://www.linkedin.com/feed/update/${urn}/`;
  return '';
}

interface Extracted {
  postId: string;
  author: { href: string; name: string };
  isRepost: boolean;
  headline: string;
  avatarUrl: string;
  postType: PostType;
  text: string;
  counts: { reactions: number; comments: number; reposts: number };
  postedAtLabel: string;
  url: string;
}

function extractPost(container: Element): Extracted | null {
  try {
    const urn = derivePostUrn(container);
    const authorInfo = detectRepostAuthor(container);
    if (!authorInfo) return null;

    // A stable dedupe key (PRD §7): the URN when LinkedIn exposes one, else a
    // fallback built from the author and post text so the same post seen
    // twice in a session still collapses to one row.
    const text = derivePostText(container);
    const postId = urn ?? `fallback:${authorInfo.author.href}:${truncateText(text, 60)}`;

    return {
      postId,
      author: authorInfo.author,
      isRepost: authorInfo.isRepost,
      headline: findHeadline(container),
      avatarUrl: findAvatar(container),
      postType: derivePostType(container),
      text,
      counts: deriveCounts(container),
      postedAtLabel: deriveRelativeLabel(container),
      url: derivePostUrl(container, urn),
    };
  } catch {
    // Extraction must never throw — one odd post should not stop the scan.
    return null;
  }
}

/* ── Watch button ────────────────────────────────────────────────────── */

const BUTTON_CSS = `
  button {
    font: 500 12px/1.4 -apple-system, "Segoe UI", Roboto, sans-serif;
    border: 1px solid rgba(10,102,194,.5);
    background: #fff;
    color: #0a66c2;
    border-radius: 12px;
    padding: 2px 10px;
    cursor: pointer;
    white-space: nowrap;
  }
  button:hover { background: rgba(10,102,194,.08); }
  button.on { background: #0a66c2; color: #fff; }
  button.on:hover { background: #0a5cb0; }
`;

function makeWatchButton(id: string, onToggle: () => void): HTMLElement {
  const host = document.createElement('span');
  host.setAttribute(BUTTON_ATTR, id);
  // Inline with the surrounding text, sized to it — no reflow of anything
  // beyond the row this button is already part of (PRD §6: no layout shift).
  host.style.cssText = 'display:inline-block;vertical-align:middle;margin-left:6px;';

  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = BUTTON_CSS;
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = watchedIds.has(id) ? 'Watching ✓' : '+ Watch';
  button.setAttribute('aria-pressed', String(watchedIds.has(id)));
  button.classList.toggle('on', watchedIds.has(id));
  button.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    onToggle();
  });

  shadow.append(style, button);
  registerButton(id, host);
  return host;
}

async function toggleWatch(person: Omit<WatchedPerson, 'note' | 'watchedAt'>): Promise<void> {
  if (watchedIds.has(person.id)) {
    watchedIds.delete(person.id);
    paintButtons(person.id);
    await unwatchPerson(person.id);
    void track('watch_removed');
  } else {
    watchedIds.add(person.id);
    paintButtons(person.id);
    await watchPerson(person);
    void track('watch_added');
    // A person is watched *before* any of their posts are on screen often
    // enough (adding from their profile) that it's worth capturing this one
    // sighting immediately rather than waiting for the next scroll.
    scanRoot(document.body);
  }
}

/* ── Profile page ────────────────────────────────────────────────────── */

function isProfilePage(): boolean {
  return /^\/in\/[^/]+\/?$/.test(location.pathname);
}

function injectProfileButton(): void {
  if (!isProfilePage()) return;
  const heading = document.querySelector('h1');
  if (!heading || heading.hasAttribute('data-lcw-profile-done')) return;

  const id = normalizeProfileUrl(location.href);
  const name = truncateText(heading.textContent || '', 120);
  if (!name) return;

  heading.setAttribute('data-lcw-profile-done', '1');
  const headlineEl = firstMatch(document.body, ['.text-body-medium.break-words', '[class*="top-card"] .text-body-medium']);
  const avatarEl = document.querySelector<HTMLImageElement>('img[class*="profile-photo"], img[class*="EntityPhoto"]');

  const host = makeWatchButton(id, () =>
    void toggleWatch({
      id,
      name,
      headline: truncateText(headlineEl?.textContent || '', 160),
      avatarUrl: avatarEl?.src ?? '',
    })
  );
  heading.insertAdjacentElement('afterend', host);
}

/* ── Feed / profile activity / search post rows ─────────────────────── */

async function processPostContainer(container: Element): Promise<void> {
  const extracted = extractPost(container);
  if (!extracted) return;

  container.setAttribute(PROCESSED_ATTR, extracted.postId);

  // The watch button goes on every post's author line, watched or not — that
  // is how a person gets added in the first place (PRD §4).
  const authorLink = container.querySelector<HTMLAnchorElement>('a[href*="/in/"]');
  if (authorLink && !authorLink.parentElement?.querySelector(`[${BUTTON_ATTR}]`)) {
    const host = makeWatchButton(extracted.author.href, () =>
      void toggleWatch({
        id: extracted.author.href,
        name: extracted.author.name,
        headline: extracted.headline,
        avatarUrl: extracted.avatarUrl,
      })
    );
    authorLink.insertAdjacentElement('afterend', host);
  }

  if (!watchedIds.has(extracted.author.href)) return;

  const now = Date.now();
  const post: CollectedPost = {
    id: extracted.postId,
    personId: extracted.author.href,
    postType: extracted.postType,
    text: previewFor(truncateText(extracted.text), extracted.postType),
    reactions: extracted.counts.reactions,
    comments: extracted.counts.comments,
    reposts: extracted.counts.reposts,
    seenAsRepost: extracted.isRepost,
    url: extracted.url,
    postedAt: parseRelativeTime(extracted.postedAtLabel, now),
    postedAtLabel: extracted.postedAtLabel,
    firstSeenAt: now,
    countsUpdatedAt: now,
    note: '',
  };

  await upsertPost(post);
  void track('post_collected');
}

function scanRoot(root: ParentNode): void {
  injectProfileButton();
  const containers = root.querySelectorAll<HTMLElement>('[data-urn]');
  containers.forEach(container => {
    const urn = container.getAttribute('data-urn') ?? '';
    if (!/^urn:li:(activity|share|ugcPost):/.test(urn)) return;
    // Re-run on every pass: the button is only added once (processPostContainer
    // checks for an existing one), but counts and text often load in shortly
    // after a row first mounts, so re-extracting is what catches them (PRD §7).
    void processPostContainer(container);
  });
}

/* ── Boot, mutation watching, SPA navigation ────────────────────────── */

let scanTimer: number | undefined;
function scheduleScan(delay = 400): void {
  window.clearTimeout(scanTimer);
  scanTimer = window.setTimeout(() => scanRoot(document.body), delay);
}

async function loadWatchedIds(): Promise<void> {
  watchedIds.clear();
  const all = await chrome.storage.local.get(null);
  for (const key of Object.keys(all)) {
    if (key.startsWith('lcw:person:')) watchedIds.add(key.slice('lcw:person:'.length));
  }
}

// Keeps every button in sync when a person is watched/unwatched from the panel.
chrome.storage.onChanged.addListener(changes => {
  for (const key of Object.keys(changes)) {
    if (!key.startsWith('lcw:person:')) continue;
    const id = key.slice('lcw:person:'.length);
    if (changes[key].newValue) watchedIds.add(id);
    else watchedIds.delete(id);
    paintButtons(id);
  }
});

const observer = new MutationObserver(mutations => {
  const relevant = mutations.some(mutation => mutation.addedNodes.length > 0);
  if (relevant) scheduleScan();
});

function watchNavigation(): void {
  let last = location.href;
  window.setInterval(() => {
    if (location.href === last) return;
    last = location.href;
    document.querySelectorAll('[data-lcw-profile-done]').forEach(el => el.removeAttribute('data-lcw-profile-done'));
    scheduleScan(300);
  }, 700);
}

if (window.top === window && /\.linkedin\.com$/.test(location.hostname)) {
  void loadWatchedIds().then(() => {
    scanRoot(document.body);
    scheduleScan(300);
  });
  observer.observe(document.body, { childList: true, subtree: true });
  watchNavigation();
}
