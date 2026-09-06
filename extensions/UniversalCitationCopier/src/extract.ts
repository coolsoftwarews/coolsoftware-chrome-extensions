/**
 * The one DOM-touching function in this extension.
 *
 * `collectRawMeta` is injected into the active tab via
 * `chrome.scripting.executeScript({ func: collectRawMeta })`. Chrome
 * serializes the function by its source text and re-runs it in the page's own
 * isolated world — which means it must be entirely self-contained: no
 * imports, no references to anything outside its own body. Every field it
 * reads maps 1:1 onto `RawMeta` in `citation.ts`; the fallback-chain logic
 * itself lives there, pure and DOM-free, so it can be unit tested.
 *
 * Runs at copy time, not page-load time (PRD §7 — SPA titles that change
 * after initial load), because this function is only ever called the moment
 * the user asks for a citation.
 */

import type { RawMeta } from './citation';

/**
 * `chrome.scripting.executeScript({ func })` serializes ONLY this function's
 * own source text and re-runs it in the page's isolated world — it cannot
 * resolve a call to a sibling module-level function, which would be out of
 * scope there. So every helper it needs is declared *inside* this function
 * body (a nested function declaration's source travels with the outer one),
 * not beside it.
 */
export function collectRawMeta(): RawMeta {
  function metaContent(selector: string): string | null {
    const el = document.querySelector<HTMLMetaElement>(selector);
    return el?.content?.trim() || null;
  }

  /**
   * A last-resort heuristic for author bylines on pages with no author
   * metadata at all: the first short piece of visible text in an element
   * whose class or rel hints at "author" or "byline".
   */
  function bylineHeuristic(): string | null {
    const candidates = document.querySelectorAll<HTMLElement>(
      '[rel="author"], [class*="byline" i], [class*="author" i], [itemprop="author"]'
    );
    for (const el of candidates) {
      const text = el.textContent?.replace(/\s+/g, ' ').trim();
      // A byline is a name, not a paragraph — cap the length so a
      // mis-matched class on a real article body isn't treated as an author.
      if (text && text.length > 0 && text.length <= 80) return text;
    }
    return null;
  }

  const relAuthor = document.querySelector<HTMLAnchorElement>('link[rel="author"], a[rel="author"]');
  const h1 = document.querySelector('h1');

  return {
    documentTitle: document.title?.trim() || null,
    ogTitle: metaContent('meta[property="og:title"]'),
    ogSiteName: metaContent('meta[property="og:site_name"]'),
    metaAuthor: metaContent('meta[name="author"]'),
    articleAuthor: metaContent('meta[property="article:author"]') ?? metaContent('meta[name="article:author"]'),
    relAuthorText: relAuthor?.textContent?.trim() || null,
    bylineText: bylineHeuristic(),
    publishedTime:
      metaContent('meta[property="article:published_time"]') ??
      metaContent('meta[name="date"]') ??
      metaContent('meta[name="publish-date"]') ??
      (document.querySelector('time[datetime]')?.getAttribute('datetime')?.trim() || null),
    canonicalUrl: document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href || null,
    locationHref: location.href,
    h1Text: h1?.textContent?.replace(/\s+/g, ' ').trim() || null,
  };
}
