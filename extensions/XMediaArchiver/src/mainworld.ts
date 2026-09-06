/**
 * Runs in the page's MAIN world (see manifest `content_scripts[].world` in
 * scripts/build.mjs) — the only place X's real video URLs can be read.
 *
 * ── Why this file has to exist ──────────────────────────────────────────
 * X plays video through Media Source Extensions: the `<video>` element's
 * src is a `blob:` URL that is a handle to a live streaming object, not a
 * file. Nothing behind it can be downloaded — confirmed live, across ~15
 * attempts on six different accounts, every one failing as "Network issue"
 * in Chrome's download manager while images from the same posts saved fine.
 *
 * The real, progressive MP4s do exist: X's own tweet payload carries
 * `extended_entities.media[].video_info.variants[]`, each with a
 * `video.twimg.com/...mp4` URL and a bitrate. That payload lives in React's
 * internal props on the tweet element. A normal content script cannot see
 * it — content scripts run in an isolated world with a separate JS object
 * graph, so page-set expando properties like `__reactProps$…` simply aren't
 * there. Hence this MAIN-world script, which reads the props and hands the
 * URLs to content.ts over `window.postMessage`.
 *
 * This file makes no network request of its own and never writes to the
 * page — it only reads objects X already holds in memory (PRIVACY.md).
 */

const MESSAGE_SOURCE = 'XMA_MAIN';
const SCAN_INTERVAL_MS = 1200;
const MAX_FIBER_HOPS = 40;
const MAX_SEARCH_DEPTH = 8;
const SEARCH_NODE_BUDGET = 4000;

/** Tweet ids already reported, so the same post is posted across once. */
const reported = new Map<string, string>();

interface VideoVariant {
  bitrate?: number;
  content_type?: string;
  url?: string;
}

/* ── React internals ──────────────────────────────────────────────────── */

function reactFiber(el: Element): Record<string, unknown> | null {
  for (const key of Object.keys(el)) {
    if (key.startsWith('__reactFiber$')) return (el as unknown as Record<string, unknown>)[key] as Record<string, unknown>;
  }
  return null;
}

/**
 * Bounded search for X media entities carrying `video_info.variants`.
 * Deliberately budgeted (depth + node count + a visited set): React props
 * graphs are cyclic and enormous, and this runs on the page's own thread.
 */
function findMediaEntities(root: unknown): Record<string, any>[] {
  const found: Record<string, any>[] = [];
  const seen = new Set<unknown>();
  const stack: { value: unknown; depth: number }[] = [{ value: root, depth: 0 }];
  let budget = SEARCH_NODE_BUDGET;

  while (stack.length && budget > 0) {
    const { value, depth } = stack.pop() as { value: unknown; depth: number };
    budget--;

    if (!value || typeof value !== 'object' || depth > MAX_SEARCH_DEPTH) continue;
    if (seen.has(value)) continue;
    seen.add(value);

    const obj = value as Record<string, any>;
    if (obj.video_info && Array.isArray(obj.video_info.variants)) {
      found.push(obj);
      continue; // no need to descend into a media entity we've already matched
    }

    if (Array.isArray(obj)) {
      for (const item of obj) stack.push({ value: item, depth: depth + 1 });
      continue;
    }

    for (const key of Object.keys(obj)) {
      // Fiber back-references and DOM nodes turn this into a walk of the
      // entire page; skip them explicitly.
      if (key === 'return' || key === 'stateNode' || key === '_owner' || key === '_debugOwner') continue;
      try {
        stack.push({ value: obj[key], depth: depth + 1 });
      } catch {
        /* getters that throw — ignore */
      }
    }
  }

  return found;
}

/** The highest-bitrate progressive MP4 among a media entity's variants. */
function bestMp4(variants: VideoVariant[]): string | null {
  const mp4s = variants.filter(v => v?.url && (v.content_type === 'video/mp4' || /\.mp4(\?|$)/.test(v.url)));
  if (!mp4s.length) return null;
  const best = mp4s.reduce((a, b) => ((b.bitrate ?? 0) > (a.bitrate ?? 0) ? b : a));
  return best.url ?? null;
}

/** `https://x.com/<handle>/status/<id>/video/1` → the status id. */
function tweetIdFromExpandedUrl(url: unknown): string | null {
  if (typeof url !== 'string') return null;
  const match = url.match(/\/status\/(\d+)/);
  return match ? match[1] : null;
}

/** Falls back to the article's own permalink when the entity has no expanded_url. */
function tweetIdFromArticle(article: Element): string | null {
  const anchors = Array.from(article.querySelectorAll<HTMLAnchorElement>('a[href*="/status/"]'));
  for (const anchor of anchors) {
    const match = (anchor.getAttribute('href') ?? '').match(/\/status\/(\d+)/);
    if (match) return match[1];
  }
  return null;
}

/* ── Scanning ─────────────────────────────────────────────────────────── */

function scanArticle(article: Element): void {
  let fiber = reactFiber(article);
  let hops = 0;

  while (fiber && hops < MAX_FIBER_HOPS) {
    const entities = findMediaEntities(fiber.memoizedProps);

    for (const entity of entities) {
      const url = bestMp4(entity.video_info.variants as VideoVariant[]);
      if (!url) continue;

      const tweetId = tweetIdFromExpandedUrl(entity.expanded_url) ?? tweetIdFromArticle(article);
      if (!tweetId) continue;
      if (reported.get(tweetId) === url) continue;

      reported.set(tweetId, url);
      window.postMessage({ source: MESSAGE_SOURCE, type: 'XMA_VIDEO_URL', tweetId, url }, window.location.origin);
    }

    if (entities.length) return; // found this article's media, stop climbing
    fiber = fiber.return as Record<string, unknown> | null;
    hops++;
  }
}

function scan(): void {
  const articles = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
  for (const article of articles) {
    try {
      scanArticle(article);
    } catch {
      // One unreadable article must never stop the pass — X's props shape
      // varies across post types, and a miss here just means that post's
      // video isn't offered (content.ts drops video with no real URL).
    }
  }
}

scan();
window.setInterval(scan, SCAN_INTERVAL_MS);

// Answer a re-scan request from the isolated world (e.g. after SPA nav).
window.addEventListener('message', event => {
  if (event.source !== window) return;
  const data = event.data as { source?: string; type?: string } | null;
  if (data?.source === 'XMA_ISOLATED' && data.type === 'XMA_RESCAN') {
    reported.clear();
    scan();
  }
});
