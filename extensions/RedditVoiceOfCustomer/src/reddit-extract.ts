/**
 * Reddit DOM extraction — old.reddit.com's classic markup and the redesigned
 * www.reddit.com's shreddit-* web components (PRD §5: both must work).
 *
 * Reddit's markup changes without notice and this file cannot be driven by a
 * real browser inside scripts/selftest.mjs, so every read here degrades to an
 * honest empty value rather than throwing — a capture with a blank score is
 * still useful, a capture that crashes the content script is not. Verify this
 * file against live Reddit before shipping; see README "Manual test
 * checklist".
 */

export interface CaptureContext {
  permalink: string;
  threadUrl: string;
  threadTitle: string;
  subreddit: string;
  author: string;
  score: number | null;
  postedAt: string;
  contextText: string;
}

const NEW_COMMENT = 'shreddit-comment';
const NEW_POST = 'shreddit-post';
const CAPTURE_SELECTOR = `${NEW_COMMENT}, ${NEW_POST}, .thing.comment, .thing.link`;

function absoluteUrl(href: string | null | undefined): string {
  if (!href) return '';
  try {
    return new URL(href, location.href).toString();
  } catch {
    return '';
  }
}

function cleanText(el: Element | null | undefined): string {
  return (el?.textContent || '').replace(/\s+/g, ' ').trim();
}

function subredditFromPath(): string {
  const match = location.pathname.match(/\/r\/([^/]+)/i);
  return match ? `r/${match[1]}` : '';
}

function elementFromNode(node: Node | null | undefined): Element | null {
  if (!node) return null;
  return node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
}

/**
 * Finds the nearest comment/post that fully contains a selection range.
 * Returns null for a selection that spans more than one capture root (PRD §7
 * edge case: "refuse clearly" rather than guess which comment it belongs to)
 * or one that lands outside a comment/post entirely (sidebar, chrome, ads).
 */
export function findCaptureRoot(range: Range): Element | null {
  const anchorEl = elementFromNode(range.commonAncestorContainer);
  const root = anchorEl?.closest(CAPTURE_SELECTOR) ?? null;
  if (!root) return null;

  const startEl = elementFromNode(range.startContainer);
  const endEl = elementFromNode(range.endContainer);
  if (!startEl || !endEl || !root.contains(startEl) || !root.contains(endEl)) return null;

  return root;
}

/**
 * Best-effort HTML → text that keeps paragraph breaks, list bullets and
 * emphasis markers, so a saved comment still reads like Markdown in export
 * (PRD §7) without pulling in a full HTML→Markdown engine for one field.
 */
function elementToText(el: Element | null | undefined): string {
  if (!el) return '';
  const clone = el.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
  clone.querySelectorAll('li').forEach(li => li.prepend('- '));
  clone.querySelectorAll('strong, b').forEach(node => {
    node.prepend('**');
    node.append('**');
  });
  clone.querySelectorAll('em, i').forEach(node => {
    node.prepend('_');
    node.append('_');
  });
  clone.querySelectorAll('code').forEach(node => {
    node.prepend('`');
    node.append('`');
  });
  clone.querySelectorAll('p, li, blockquote, pre, h1, h2, h3, h4, h5, h6').forEach(block => {
    block.append('\n\n');
  });
  return (clone.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
}

/* ── New Reddit (shreddit-*) ─────────────────────────────────────────── */

function newDate(el: Element): string {
  const ts = el.querySelector('faceplate-timeago[ts]')?.getAttribute('ts') || el.getAttribute('created-timestamp');
  if (!ts) return '';
  const parsed = new Date(ts);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
}

function newScore(el: Element): number | null {
  const raw =
    el.getAttribute('score') ??
    el.querySelector('[score]')?.getAttribute('score') ??
    el.querySelector('faceplate-number[number]')?.getAttribute('number');
  if (raw === null || raw === undefined) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function newBody(el: Element): string {
  const body = el.querySelector('[slot="comment"] .md, [slot="text-body"] .md, .md');
  return elementToText(body);
}

function newAuthor(el: Element): string {
  return el.getAttribute('author') || cleanText(el.querySelector('[slot="commentAuthorLink"], a[href^="/user/"]'));
}

function newThreadInfo(): { threadTitle: string; threadUrl: string; subreddit: string } {
  const post = document.querySelector(NEW_POST);
  const title = post?.getAttribute('post-title') || cleanText(post?.querySelector('[slot="title"]')) || document.title;
  const permalink = post?.getAttribute('permalink') || post?.getAttribute('content-href') || '';
  const subreddit = post?.getAttribute('subreddit-prefixed-name') || subredditFromPath();
  return { threadTitle: title, threadUrl: absoluteUrl(permalink) || location.href, subreddit };
}

function extractNewComment(el: Element): CaptureContext {
  const { threadTitle, threadUrl, subreddit } = newThreadInfo();
  return {
    permalink: absoluteUrl(el.getAttribute('permalink')) || threadUrl,
    threadUrl,
    threadTitle,
    subreddit,
    author: newAuthor(el),
    score: newScore(el),
    postedAt: newDate(el),
    contextText: newBody(el),
  };
}

function extractNewPost(el: Element): CaptureContext {
  const permalink = absoluteUrl(el.getAttribute('permalink')) || location.href;
  const title = el.getAttribute('post-title') || cleanText(el.querySelector('[slot="title"]')) || document.title;
  return {
    permalink,
    threadUrl: permalink,
    threadTitle: title,
    subreddit: el.getAttribute('subreddit-prefixed-name') || subredditFromPath(),
    author: newAuthor(el),
    score: newScore(el),
    postedAt: newDate(el),
    contextText: newBody(el) || title,
  };
}

/* ── Old Reddit ──────────────────────────────────────────────────────── */

function oldScore(el: Element): number | null {
  const scoreEl = el.querySelector('.tagline .score, .score.unvoted, .score');
  const titleAttr = scoreEl?.getAttribute('title')?.trim();
  if (titleAttr && /^-?\d+$/.test(titleAttr)) return Number(titleAttr);
  const match = cleanText(scoreEl).match(/-?[\d,]+/);
  return match ? Number(match[0].replace(/,/g, '')) : null;
}

function oldDate(el: Element): string {
  const attr = el.querySelector('time[datetime]')?.getAttribute('datetime');
  if (!attr) return '';
  const parsed = new Date(attr);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
}

function oldThreadInfo(): { threadTitle: string; threadUrl: string; subreddit: string } {
  const postLink = document.querySelector<HTMLAnchorElement>(
    '#siteTable .thing.link a.title, .thing.link.self a.title, .thing.link a.title'
  );
  const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href;
  return {
    threadTitle: cleanText(postLink) || document.title,
    threadUrl: absoluteUrl(postLink?.getAttribute('href') || canonical) || location.href,
    subreddit: subredditFromPath(),
  };
}

function extractOldComment(el: Element): CaptureContext {
  const { threadTitle, threadUrl, subreddit } = oldThreadInfo();
  const body = el.querySelector('.usertext-body .md, form.usertext .md');
  return {
    permalink: absoluteUrl(el.getAttribute('data-permalink')) || threadUrl,
    threadUrl,
    threadTitle,
    subreddit,
    author: el.getAttribute('data-author') || cleanText(el.querySelector('a.author')),
    score: oldScore(el),
    postedAt: oldDate(el),
    contextText: elementToText(body),
  };
}

function extractOldPost(el: Element): CaptureContext {
  const permalink = absoluteUrl(el.getAttribute('data-permalink')) || location.href;
  const titleEl = el.querySelector('p.title a.title, a.title');
  const body = el.querySelector('.usertext-body .md');
  const subredditAttr = el.getAttribute('data-subreddit');
  return {
    permalink,
    threadUrl: permalink,
    threadTitle: cleanText(titleEl) || document.title,
    subreddit: subredditAttr ? `r/${subredditAttr}` : subredditFromPath(),
    author: el.getAttribute('data-author') || cleanText(el.querySelector('a.author')),
    score: oldScore(el),
    postedAt: oldDate(el),
    contextText: elementToText(body) || cleanText(titleEl),
  };
}

/* ── Entry point ─────────────────────────────────────────────────────── */

export function extractCapture(root: Element): CaptureContext | null {
  const tag = root.tagName.toLowerCase();
  if (tag === NEW_COMMENT) return extractNewComment(root);
  if (tag === NEW_POST) return extractNewPost(root);
  if (root.classList.contains('comment')) return extractOldComment(root);
  if (root.classList.contains('link')) return extractOldPost(root);
  return null;
}
