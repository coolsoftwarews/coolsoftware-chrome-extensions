/**
 * Reader-view extraction and page metadata.
 *
 * A dependency-free Readability-in-miniature: score block candidates by how
 * much paragraph text they hold, take the winner, and strip everything that
 * is not content. It does not have to beat Readability — it has to produce a
 * clean document on articles and fail honestly on app-like pages (PRD §8),
 * where we fall back to whole-body cleanup and tell the user.
 */

import { MARK_ATTR, UI_ATTR } from './anchor';
import { ExtractedArticle, PageMeta } from './types';
import { normalizeUrl, siteName } from './url';

const STRIP_TAGS = [
  'script',
  'style',
  'noscript',
  'iframe',
  'object',
  'embed',
  'form',
  'input',
  'button',
  'select',
  'textarea',
  'svg',
  'canvas',
  'video',
  'audio',
  'nav',
  'aside',
  'footer',
  'header',
  'link',
  'meta',
  'template',
];

/** Class/id fragments that almost always mark furniture rather than content. */
const JUNK_PATTERN =
  /(^|[-_ ])(ad|ads|advert|banner|breadcrumb|comment|complementary|cookie|disqus|footer|header|masthead|menu|modal|newsletter|nav|paywall|popup|promo|related|share|sidebar|social|sponsor|subscribe|toolbar|widget)([-_ ]|$)/i;

const CANDIDATE_SELECTOR = 'article, main, [role="main"], .post, .entry, .content, #content, section, div';

/* ── Metadata ────────────────────────────────────────────────────────── */

function metaContent(...selectors: string[]): string {
  for (const selector of selectors) {
    const el = document.querySelector<HTMLMetaElement>(selector);
    const value = el?.content?.trim();
    if (value) return value;
  }
  return '';
}

function jsonLdAuthor(): string {
  for (const script of Array.from(document.querySelectorAll('script[type="application/ld+json"]'))) {
    try {
      const data = JSON.parse(script.textContent || '');
      const nodes = Array.isArray(data) ? data : [data, ...(data['@graph'] ?? [])];
      for (const node of nodes) {
        const author = node?.author;
        if (typeof author === 'string') return author;
        if (Array.isArray(author) && author[0]?.name) return author[0].name;
        if (author?.name) return author.name;
      }
    } catch {
      /* a malformed blob on someone else's page is not our problem */
    }
  }
  return '';
}

export function readPageMeta(): PageMeta {
  const title =
    metaContent('meta[property="og:title"]', 'meta[name="twitter:title"]') ||
    document.querySelector('h1')?.textContent?.trim() ||
    document.title ||
    location.href;

  const author = metaContent('meta[name="author"]', 'meta[property="article:author"]') || jsonLdAuthor();

  const published =
    metaContent('meta[property="article:published_time"]', 'meta[name="date"]', 'meta[name="pubdate"]') ||
    document.querySelector('time[datetime]')?.getAttribute('datetime') ||
    '';

  return {
    url: normalizeUrl(location.href),
    title: title.trim().slice(0, 300),
    author: author.trim().slice(0, 120),
    site: metaContent('meta[property="og:site_name"]') || siteName(location.href),
    published: published.slice(0, 40),
    captured: new Date().toISOString().slice(0, 10),
  };
}

/* ── Candidate scoring ───────────────────────────────────────────────── */

function isJunk(el: Element): boolean {
  const signature = `${el.className || ''} ${el.id || ''}`;
  return typeof signature === 'string' && JUNK_PATTERN.test(signature);
}

function scoreCandidate(el: Element): number {
  if (isJunk(el)) return 0;

  const paragraphs = Array.from(el.querySelectorAll('p, li, blockquote, pre'));
  let score = 0;
  for (const p of paragraphs) {
    const length = (p.textContent || '').trim().length;
    if (length < 25) continue;
    score += Math.min(length, 1000);
  }

  // Link-dense blocks are navigation dressed up as content.
  const textLength = (el.textContent || '').trim().length || 1;
  const linkLength = Array.from(el.querySelectorAll('a')).reduce((sum, a) => sum + (a.textContent || '').length, 0);
  const linkDensity = linkLength / textLength;
  if (linkDensity > 0.5) score *= 0.2;

  return score;
}

function pickArticleRoot(): { root: Element; fallback: boolean } {
  const candidates = Array.from(document.querySelectorAll(CANDIDATE_SELECTOR)).slice(0, 400);

  let best: Element | null = null;
  let bestScore = 0;
  for (const candidate of candidates) {
    const score = scoreCandidate(candidate);
    // Prefer the deeper node when scores tie — the outer wrapper drags in furniture.
    if (score > bestScore * 1.1) {
      bestScore = score;
      best = candidate;
    }
  }

  // 500 characters of paragraph text is roughly "a short blog post". Below
  // that, reader extraction has not found an article at all.
  if (best && bestScore >= 500) return { root: best, fallback: false };
  return { root: document.body, fallback: true };
}

/* ── Cleanup ─────────────────────────────────────────────────────────── */

function absolutize(el: Element, attr: string): void {
  const value = el.getAttribute(attr);
  if (!value) return;
  try {
    el.setAttribute(attr, new URL(value, location.href).toString());
  } catch {
    el.removeAttribute(attr);
  }
}

const KEEP_ATTRS = new Set(['href', 'src', 'alt', 'title', 'colspan', 'rowspan', MARK_ATTR]);

function cleanClone(root: Element): HTMLElement {
  const clone = root.cloneNode(true) as HTMLElement;

  for (const el of Array.from(clone.querySelectorAll(STRIP_TAGS.join(',')))) el.remove();
  for (const el of Array.from(clone.querySelectorAll(`[${UI_ATTR}]`))) el.remove();
  for (const el of Array.from(clone.querySelectorAll('[aria-hidden="true"], [hidden]'))) el.remove();
  for (const el of Array.from(clone.querySelectorAll('*'))) {
    if (isJunk(el) && !el.querySelector(`[${MARK_ATTR}]`)) {
      el.remove();
      continue;
    }
    if (el.tagName === 'IMG') absolutize(el, 'src');
    if (el.tagName === 'A') absolutize(el, 'href');
    // Strip every attribute we did not explicitly keep: no inline styles, no
    // event handlers, no tracking parameters riding along in data-*.
    for (const attr of Array.from(el.attributes)) {
      if (!KEEP_ATTRS.has(attr.name)) el.removeAttribute(attr.name);
    }
  }

  // Collapse empty wrappers left behind by the strip pass.
  for (const el of Array.from(clone.querySelectorAll('div, span, section'))) {
    if (!el.textContent?.trim() && !el.querySelector('img')) el.remove();
  }

  return clone;
}

/**
 * The cleaned article, with any highlights still wrapped in <mark> (they are
 * part of the live DOM, so cloning carries them along for free).
 */
export function extractArticle(): ExtractedArticle {
  const { root, fallback } = pickArticleRoot();
  const clone = cleanClone(root);
  return {
    html: clone.innerHTML,
    text: (clone.textContent || '').replace(/\n{3,}/g, '\n\n').replace(/[ \t]+/g, ' ').trim(),
    fallback,
  };
}
