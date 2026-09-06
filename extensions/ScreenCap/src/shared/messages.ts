/**
 * Screen Capture — shared message contract.
 *
 * Every chrome.runtime / chrome.tabs message in the extension uses one of
 * these actions. Keep this list short: an action that no longer has a KEEP
 * feature behind it is dead weight.
 */

export const Msg = {
  // popup → background
  START_CAPTURE: 'START_CAPTURE',

  // background → popup
  CAPTURE_PROGRESS: 'CAPTURE_PROGRESS',
  CAPTURE_DONE: 'CAPTURE_DONE',
  CAPTURE_FAILED: 'CAPTURE_FAILED',

  // editor → background
  GET_CAPTURE: 'GET_CAPTURE',

  // background → content script
  PING: 'PING',
  MEASURE_PAGE: 'MEASURE_PAGE',
  SCROLL_TO: 'SCROLL_TO',
  HIDE_FIXED: 'HIDE_FIXED',
  RESTORE_FIXED: 'RESTORE_FIXED',
  SELECT_REGION: 'SELECT_REGION',

  // background → offscreen
  STITCH_TILES: 'STITCH_TILES',
} as const;

export type CaptureMode = 'fullPage' | 'visibleArea' | 'selectedRegion';
export type ExportFormat = 'png' | 'jpeg' | 'pdf';

export interface PageMeasurement {
  scrollHeight: number;
  viewportHeight: number;
  viewportWidth: number;
  devicePixelRatio: number;
  /** True when the page scrolls inside a container rather than the document. */
  innerScroller: boolean;
}

/** One captured viewport frame, positioned in device pixels on the final canvas. */
export interface Tile {
  dataUrl: string;
  y: number;
  /** Device-pixel height of the usable strip of this frame. */
  height: number;
}

export interface CaptureMeta {
  mode: CaptureMode;
  sourceUrl: string;
  sourceTitle: string;
  width: number;
  height: number;
  /** Set when the page was taller than the canvas limit and got truncated. */
  truncated?: boolean;
}

export interface CapturePayload {
  id: string;
  imageDataUrl: string;
  meta: CaptureMeta;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
