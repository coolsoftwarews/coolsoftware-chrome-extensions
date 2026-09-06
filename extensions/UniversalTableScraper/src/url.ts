/**
 * Which pages this extension can run on. Same shape as WebHighlighter's
 * url.ts — chrome://, extension, and file:// pages are off limits.
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

/** `example.com` — shown in the popup and used in export filenames. */
export function siteName(raw: string | undefined): string {
  if (!raw) return '';
  try {
    return new URL(raw).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}
