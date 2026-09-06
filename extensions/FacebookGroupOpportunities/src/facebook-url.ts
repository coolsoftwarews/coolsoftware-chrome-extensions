/** Small, shared, pure — used by background.ts and panel.ts to decide when the panel can do anything. */

export function isFacebookUrl(raw: string | undefined): boolean {
  if (!raw) return false;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    return /(^|\.)facebook\.com$/i.test(url.hostname);
  } catch {
    return false;
  }
}

export function isGroupUrl(raw: string | undefined): boolean {
  if (!isFacebookUrl(raw)) return false;
  try {
    return new URL(raw as string).pathname.startsWith('/groups/');
  } catch {
    return false;
  }
}
