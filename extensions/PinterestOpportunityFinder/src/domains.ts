/**
 * Every Pinterest ccTLD the extension needs to run on (PRD §7: "regional
 * domains... the manifest must cover them"). Pinterest serves localized
 * traffic from country-code domains rather than one global host, so a single
 * `pinterest.com` host permission misses a large share of non-US users.
 *
 * Chrome's match-pattern grammar allows only one wildcard, and only as a
 * leading `*.` label — the PRD table's shorthand of a wildcard TLD is not
 * valid manifest syntax. This is the expanded, explicit list.
 *
 * IMPORTANT: kept in sync by hand with the literal array in
 * scripts/build.mjs — a plain .mjs script cannot import a .ts module without
 * a compile step, and duplicating a 30-line const is cheaper than adding one.
 * If you change this list, change build.mjs's copy too.
 */
export const PINTEREST_DOMAINS = [
  'pinterest.com',
  'pinterest.ca',
  'pinterest.co.uk',
  'pinterest.fr',
  'pinterest.de',
  'pinterest.es',
  'pinterest.com.au',
  'pinterest.ph',
  'pinterest.ch',
  'pinterest.com.mx',
  'pinterest.dk',
  'pinterest.pt',
  'pinterest.ru',
  'pinterest.it',
  'pinterest.at',
  'pinterest.jp',
  'pinterest.cl',
  'pinterest.ie',
  'pinterest.co.kr',
  'pinterest.nz',
  'pinterest.vn',
  'pinterest.co',
  'pinterest.com.uy',
  'pinterest.com.pe',
  'pinterest.nl',
  'pinterest.co.id',
  'pinterest.hu',
  'pinterest.co.in',
  'pinterest.se',
];

/** True on any Pinterest host this extension declares host permissions for. */
export function isPinterestUrl(raw: string | undefined): boolean {
  if (!raw) return false;
  let host: string;
  try {
    host = new URL(raw).hostname.toLowerCase();
  } catch {
    return false;
  }
  return PINTEREST_DOMAINS.some(domain => host === domain || host.endsWith(`.${domain}`));
}

/** True when the URL looks like a Pinterest search results page. */
export function isSearchUrl(raw: string | undefined): boolean {
  if (!isPinterestUrl(raw)) return false;
  try {
    return new URL(raw!).pathname.startsWith('/search/');
  } catch {
    return false;
  }
}

/** Pulls the `q=` query term out of a Pinterest search URL, for storage keys and exports. */
export function searchQueryFrom(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const q = url.searchParams.get('q');
    return q ? q.trim().toLowerCase() : null;
  } catch {
    return null;
  }
}
