/**
 * This extension stores no per-page data (no persistence layer to key by
 * URL — see PRD-39 §4, the overlay is ephemeral), so all that's needed here
 * is "can reader mode run on this page at all" and a display-friendly site
 * name for filenames.
 */

const UNSUPPORTED_PROTOCOLS = ['chrome:', 'chrome-extension:', 'edge:', 'about:', 'devtools:', 'view-source:'];

export function isSupportedUrl(raw: string | undefined): boolean {
  if (!raw) return false;
  try {
    const url = new URL(raw);
    if (UNSUPPORTED_PROTOCOLS.includes(url.protocol)) return false;
    if (url.protocol === 'file:') return false;
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** `example.com` — used in export filenames. */
export function siteName(raw: string): string {
  try {
    return new URL(raw).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}
