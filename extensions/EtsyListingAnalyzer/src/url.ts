/**
 * Etsy listing URLs, matched across locale prefixes (etsy.com/listing/…,
 * etsy.com/uk/listing/…, etsy.com/de/listing/… and so on) and any query
 * string or referral suffix. Pure string/URL logic — no DOM — so it can be
 * unit tested directly.
 */

export function listingIdFromUrl(href: string): string | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (!/(^|\.)etsy\.com$/i.test(url.hostname)) return null;
  const match = /\/listing\/(\d+)/.exec(url.pathname);
  return match ? match[1] : null;
}

export function isListingUrl(href: string): boolean {
  return listingIdFromUrl(href) !== null;
}
