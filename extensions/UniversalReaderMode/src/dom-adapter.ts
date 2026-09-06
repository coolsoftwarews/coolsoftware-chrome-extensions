/**
 * The browser half: walks the live `document` into the same `GenericNode`
 * shape `extract-core.ts` and `markdown.ts` already run against (built and
 * tested with `htmlparse.ts`'s fixtures). This file is deliberately thin and
 * mechanical — tag name, attributes, child nodes, nothing heuristic — so the
 * one place real judgment happens (`extract-core.ts`) stays identical between
 * production and the selftest. Not unit-tested itself; needs a real DOM, so
 * it gets the manual test checklist in the README instead, same convention
 * as every other DOM-bound module in this portfolio.
 */

import { GenericElement, GenericNode, element, text } from './dom-tree';
import { PageMeta } from './types';
import { isSupportedUrl, siteName } from './url';

const KEEP_ATTR_NAMES = ['href', 'src', 'alt', 'title', 'colspan', 'rowspan', 'class', 'id', 'role', 'itemtype', 'start'];

function buildFromElement(el: Element): GenericElement {
  const attrs: Record<string, string> = {};
  for (const name of KEEP_ATTR_NAMES) {
    const value = el.getAttribute(name);
    if (value != null) attrs[name] = value;
  }
  const node = element(el.tagName.toLowerCase(), attrs);
  for (const child of Array.from(el.childNodes)) {
    const built = buildFromNode(child);
    if (built) node.children.push(built);
  }
  return node;
}

function buildFromNode(node: Node): GenericNode | null {
  if (node.nodeType === Node.TEXT_NODE) return text(node.nodeValue ?? '');
  if (node.nodeType === Node.ELEMENT_NODE) return buildFromElement(node as Element);
  return null;
}

/** Converts `document.body` into a `GenericNode` tree for `extract-core.ts`. */
export function buildBodyTree(): GenericElement {
  return buildFromElement(document.body);
}

/* ── Page metadata ───────────────────────────────────────────────────── */

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
    url: location.href,
    title: title.trim().slice(0, 300),
    author: author.trim().slice(0, 120),
    site: metaContent('meta[property="og:site_name"]') || siteName(location.href),
    published: published.slice(0, 40),
    captured: new Date().toISOString().slice(0, 10),
  };
}

export function pageIsSupported(): boolean {
  return isSupportedUrl(location.href);
}
