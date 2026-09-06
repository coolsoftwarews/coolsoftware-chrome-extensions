/**
 * Position math — the one genuine technical risk in this product (PRD §5).
 *
 * A note's spot is stored as a percentage of the document's scrollable
 * width/height, not raw pixels. That's what lets it survive ordinary layout
 * drift between visits — an ad loading, a sidebar resizing, a responsive
 * breakpoint the user didn't hit last time. It will not survive a full
 * redesign, and that's an accepted limitation: position is best-effort, the
 * note's *text* is never lost regardless of where it lands.
 */

export interface DocSize {
  width: number;
  height: number;
}

export function pxToPercent(px: number, total: number): number {
  if (!total || total <= 0) return 0;
  const pct = (px / total) * 100;
  return Math.min(100, Math.max(0, pct));
}

export function percentToPx(pct: number, total: number): number {
  const clamped = Math.min(100, Math.max(0, pct));
  return (clamped / 100) * total;
}

export const MIN_NOTE_WIDTH = 120;
export const MIN_NOTE_HEIGHT = 80;

/** A note can be resized down, but never past a size where its own controls
 * stop being usable. */
export function clampSize(width: number, height: number): { width: number; height: number } {
  return {
    width: Math.max(MIN_NOTE_WIDTH, Math.round(width)),
    height: Math.max(MIN_NOTE_HEIGHT, Math.round(height)),
  };
}

/**
 * Keeps a note's top-left corner within the document's own bounds (minus a
 * strip that must stay visible) so a note dragged toward an edge is always
 * reachable — never permanently off-screen (PRD §7). This clamps against the
 * *document*, not the viewport: the note may end up somewhere that needs a
 * scroll to reach, and that's fine — the side panel's "jump to page" always
 * scrolls it into view, and dragging or an arrow-key nudge can always pull it
 * back.
 */
export function clampToDocument(
  left: number,
  top: number,
  docWidth: number,
  docHeight: number,
  minVisible = 24
): { left: number; top: number } {
  const maxLeft = Math.max(0, docWidth - minVisible);
  const maxTop = Math.max(0, docHeight - minVisible);
  return {
    left: Math.min(Math.max(left, 0), maxLeft),
    top: Math.min(Math.max(top, 0), maxTop),
  };
}

/**
 * A cascading default drop offset, so several notes dropped in a row without
 * moving the last one don't stack exactly on top of each other.
 */
export function cascadeOffset(index: number, step = 22, max = 8): number {
  return (((index % max) + max) % max) * step;
}
