/**
 * String parsing with no DOM involved, so it can be checked headlessly. This
 * is the part of the "DOM churn" edge case (PRD §7) that is actually testable
 * — the DOM lookups that feed these functions live in scan.ts and are covered
 * by the manual checklist in README.md instead.
 */

/** "340K", "1.2M", "12,345", "1.5B", "12" → a number, or null if unreadable. */
export function parseCompactNumber(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const text = raw.trim().replace(/,/g, '');
  const match = text.match(/^([\d.]+)\s*([kKmMbB]?)$/);
  if (!match) return null;

  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;

  const suffix = match[2].toLowerCase();
  const multiplier = suffix === 'k' ? 1_000 : suffix === 'm' ? 1_000_000 : suffix === 'b' ? 1_000_000_000 : 1;
  const result = Math.round(value * multiplier);
  return result >= 0 ? result : null;
}

/** `https://www.tiktok.com/@handle/video/7123456789012345678?...` → the id, or null. */
export function extractVideoId(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = url.match(/\/video\/(\d+)/);
  return match ? match[1] : null;
}

/** `https://www.tiktok.com/@handle/video/123` or `https://www.tiktok.com/@handle` → "@handle", or null. */
export function extractHandle(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = url.match(/\/(@[\w.-]+)/);
  return match ? match[1] : null;
}

/** Builds the canonical watch URL from parts scan.ts already has, for links out of the board. */
export function buildVideoUrl(handle: string, id: string): string {
  return `https://www.tiktok.com/${handle}/video/${id}`;
}

export type PageContext = 'feed' | 'search' | 'hashtag' | 'profile' | 'video' | 'unknown';

/** Classifies the current TikTok URL so the scanner knows what it is looking at. */
export function classifyPage(pathname: string, search: string): PageContext {
  const path = pathname.replace(/\/+$/, '') || '/';

  if (path === '/' || path === '/foryou' || path === '/following') return 'feed';
  if (path === '/search' || path.startsWith('/search/')) return 'search';
  if (path.startsWith('/tag/')) return 'hashtag';
  if (/^\/@[\w.-]+\/video\/\d+/.test(path)) return 'video';
  if (/^\/@[\w.-]+$/.test(path)) return 'profile';
  return 'unknown';
}

/** True when a tile's own text suggests it cannot be shown/read normally (PRD §7). */
export function isRestrictedTileText(text: string): boolean {
  return /age[\s-]?restrict|not available in your (region|country)|content unavailable|video unavailable|private account/i.test(
    text
  );
}
