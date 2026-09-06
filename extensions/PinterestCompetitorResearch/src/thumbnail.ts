/**
 * Thumbnail capping — same approach as PRD-07 (Instagram Research Saver):
 * re-encode the already-rendered image to a small data URI via canvas so a
 * 1,000-pin library stays inside chrome.storage.local's budget (PRD §6/§7).
 * No image library, no network fetch — the image is already in the page.
 *
 * `capDimensions` is pure and covered by scripts/selftest.mjs. `captureThumbnail`
 * touches the DOM/canvas and only runs from content.ts; it degrades to null
 * (caller falls back to the remote URL) rather than throwing.
 */

export const MAX_THUMBNAIL_DIMENSION = 240;
export const THUMBNAIL_QUALITY = 0.72;

/** Scales width/height down to fit within `max` on the longer side, preserving aspect ratio. */
export function capDimensions(
  width: number,
  height: number,
  max: number = MAX_THUMBNAIL_DIMENSION
): { width: number; height: number } {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { width: 0, height: 0 };
  }
  if (width <= max && height <= max) {
    return { width: Math.round(width), height: Math.round(height) };
  }
  const scale = width > height ? max / width : max / height;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Downscales an already-loaded <img> to a capped JPEG data URI via canvas.
 * Returns null on any failure — most commonly a tainted canvas from a
 * cross-origin image served without CORS headers — so the caller can fall
 * back to storing the remote CDN URL instead (PRD §6).
 */
export function captureThumbnail(img: HTMLImageElement): string | null {
  try {
    const naturalWidth = img.naturalWidth || img.width;
    const naturalHeight = img.naturalHeight || img.height;
    const { width, height } = capDimensions(naturalWidth, naturalHeight);
    if (!width || !height) return null;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', THUMBNAIL_QUALITY);
  } catch {
    return null;
  }
}
