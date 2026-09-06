/**
 * URL helpers — pure, no DOM. Kept separate from the content script so
 * scripts/selftest.mjs can exercise them headlessly.
 */

/** True for any Ad Library results/detail page, in any Meta region. */
export function isAdLibraryUrl(raw: string | undefined): boolean {
  if (!raw) return false;
  try {
    const url = new URL(raw);
    if (!/(^|\.)facebook\.com$/i.test(url.hostname)) return false;
    return url.pathname.startsWith('/ads/library');
  } catch {
    return false;
  }
}

/** Registered-ish domain for grouping and display: strips protocol, "www.", path, query. */
export function extractDomain(raw: string | null | undefined): string {
  if (!raw) return '';
  let candidate = raw.trim();
  if (!candidate) return '';
  if (!/^https?:\/\//i.test(candidate)) candidate = `https://${candidate}`;
  try {
    return new URL(candidate).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}
