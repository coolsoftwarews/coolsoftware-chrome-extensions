/**
 * Turns an Etsy URL into a stable "which niche is this" key. Same job as
 * WebHighlighter's url.ts (normalize away the noise), different noise:
 * Etsy's noise is pagination and tracking/ref params, not utm_ params.
 */

const SEARCH_PATHS = ['/search'];

/** Etsy category/shop-section pages live under /c/... */
const CATEGORY_PREFIX = '/c/';

const IGNORED_PARAMS = new Set([
  'ref',
  'click_key',
  'click_sum',
  'search_query',
  'page',
  'explicit',
  'crt',
  'ship_to',
  'organic_search_click',
  'utm_source',
  'utm_medium',
  'utm_campaign',
]);

export function isEtsyHost(hostname: string): boolean {
  return /(^|\.)etsy\.com$/i.test(hostname);
}

export interface ParsedEtsyUrl {
  kind: 'search' | 'category' | null;
  /** Human-readable label: the search query, or the category path as words. */
  query: string;
  /** Stable cache/snapshot key — normalized, no page number. */
  queryKey: string;
  page: number;
}

function pageNumber(params: URLSearchParams): number {
  const raw = params.get('page');
  const n = raw ? parseInt(raw, 10) : 1;
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function categoryLabel(pathname: string): string {
  const slug = pathname.replace(/^\/c\//, '').replace(/\/$/, '');
  return slug
    .split('/')
    .map(part => part.replace(/-/g, ' ').trim())
    .filter(Boolean)
    .join(' › '); // " › "
}

export function parseEtsyUrl(raw: string): ParsedEtsyUrl {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { kind: null, query: '', queryKey: '', page: 1 };
  }

  if (!isEtsyHost(url.hostname)) return { kind: null, query: '', queryKey: '', page: 1 };

  const page = pageNumber(url.searchParams);

  if (SEARCH_PATHS.includes(url.pathname)) {
    const q = (url.searchParams.get('q') ?? '').trim();
    if (!q) return { kind: null, query: '', queryKey: '', page };

    // Keep facet params that actually change the result set (price, category
    // refinement, etc.); drop pagination/tracking noise so page 1 and page 2
    // of the same search share one cache/snapshot key.
    const kept: [string, string][] = [];
    for (const [key, value] of url.searchParams) {
      if (key === 'q' || IGNORED_PARAMS.has(key)) continue;
      kept.push([key, value]);
    }
    kept.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const facetKey = kept.map(([k, v]) => `${k}=${v}`).join('&');

    const normalizedQuery = q.toLowerCase().replace(/\s+/g, ' ').trim();
    return {
      kind: 'search',
      query: q,
      queryKey: `search:${normalizedQuery}${facetKey ? `?${facetKey}` : ''}`,
      page,
    };
  }

  if (url.pathname.startsWith(CATEGORY_PREFIX)) {
    const label = categoryLabel(url.pathname);
    if (!label) return { kind: null, query: '', queryKey: '', page };
    return {
      kind: 'category',
      query: label,
      queryKey: `category:${url.pathname.toLowerCase().replace(/\/$/, '')}`,
      page,
    };
  }

  return { kind: null, query: '', queryKey: '', page };
}
