/**
 * Whether a URL is one this extension can run on. Kept in its own pure file
 * (no chrome.*) so both content.ts and scripts/selftest.mjs can use it
 * without a browser.
 */
export function isSupportedUrl(raw: string | undefined): boolean {
  if (!raw) return false;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    return /(^|\.)reddit\.com$/i.test(url.hostname);
  } catch {
    return false;
  }
}
