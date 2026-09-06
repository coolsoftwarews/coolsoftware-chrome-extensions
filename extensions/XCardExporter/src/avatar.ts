/**
 * Pure avatar-URL helpers (PRD S5). X's default profile-image CDN URLs carry
 * a size suffix ("_normal", "_bigger", "_mini", "_200x200"...) right before
 * the file extension; requesting the largest common size gives a crisper
 * card without the extension ever downloading/re-hosting the image itself.
 */

const SIZE_SUFFIX = /_(normal|bigger|mini|\d+x\d+)(?=\.[a-zA-Z]+(?:\?.*)?$)/;

export function upgradeAvatarUrl(url: string): string {
  if (!url) return url;
  if (SIZE_SUFFIX.test(url)) return url.replace(SIZE_SUFFIX, '_400x400');
  return url;
}

/** True for the handful of URL shapes known to be X's own avatar CDN — used
 *  to decide whether it's worth attempting a CORS-mode image load at all
 *  (PRD S5's spike may downgrade this to always-false if profile images
 *  turn out not to serve permissive CORS headers in practice). */
export function looksLikeAvatarUrl(url: string): boolean {
  return /^https:\/\/(pbs|abs)\.twimg\.com\//.test(url);
}

/** Two initials from a display name, for the no-avatar fallback circle
 *  (PRD S5 - the export must never simply fail because of an avatar CORS
 *  quirk). Falls back to the handle, then a single generic mark. */
export function initialsFor(author: string, handle: string): string {
  const source = author.trim() || handle.trim().replace(/^@/, '');
  if (!source) return '?';
  const words = source.split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}
