/**
 * URL normalization — the storage key for a page.
 *
 * The same article reached from a newsletter, a search result and a bookmark
 * is three different URL strings. If each got its own key the highlights would
 * simply vanish, which reads as data loss even though nothing was lost.
 */

/** Query parameters that never identify the content. */
const TRACKING_PARAMS = [
  /^utm_/i,
  /^fbclid$/i,
  /^gclid$/i,
  /^dclid$/i,
  /^msclkid$/i,
  /^mc_(cid|eid)$/i,
  /^igshid$/i,
  /^ref$/i,
  /^ref_src$/i,
  /^source$/i,
  /^_hs(enc|mi)$/i,
  /^vero_/i,
  /^yclid$/i,
  /^si$/i,
];

const UNSUPPORTED_PROTOCOLS = ['chrome:', 'chrome-extension:', 'edge:', 'about:', 'devtools:', 'view-source:'];

export function isSupportedUrl(raw: string | undefined): boolean {
  if (!raw) return false;
  try {
    const url = new URL(raw);
    if (UNSUPPORTED_PROTOCOLS.includes(url.protocol)) return false;
    if (url.protocol === 'file:') return false; // needs a user-granted file access toggle
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Drops the fragment and tracking parameters, lowercases the host, strips a
 * leading `www.` and a trailing slash. Remaining query parameters are kept and
 * sorted — `?page=2` genuinely is a different page, but parameter order isn't.
 */
export function normalizeUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return raw;
  }

  url.hash = '';
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
  url.username = '';
  url.password = '';

  const kept: [string, string][] = [];
  for (const [key, value] of url.searchParams) {
    if (TRACKING_PARAMS.some(pattern => pattern.test(key))) continue;
    kept.push([key, value]);
  }
  kept.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  url.search = '';
  for (const [key, value] of kept) url.searchParams.append(key, value);

  let out = url.toString();
  // A trailing slash on a path-bearing URL is cosmetic; on the bare origin it is not.
  if (out.endsWith('/') && url.pathname !== '/') out = out.slice(0, -1);
  return out;
}

/** `example.com` — shown in the panel and used in export filenames. */
export function siteName(raw: string): string {
  try {
    return new URL(raw).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}
