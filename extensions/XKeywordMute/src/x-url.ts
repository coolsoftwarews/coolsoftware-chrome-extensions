/** Small, shared, pure — used by background.ts and panel.ts to decide when
 *  the panel can do anything (mirrors the shape of the portfolio's other
 *  per-platform gates, e.g. Facebook Group Opportunity Finder's facebook-url.ts). */

export function isXUrl(raw: string | undefined): boolean {
  if (!raw) return false;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    return /(^|\.)x\.com$/i.test(url.hostname) || /(^|\.)twitter\.com$/i.test(url.hostname);
  } catch {
    return false;
  }
}
