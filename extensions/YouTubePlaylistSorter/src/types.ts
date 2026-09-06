/** Shared types between the content script, the panel and the pure logic modules. */

export type SortKey = 'custom' | 'duration' | 'title' | 'date';

export const SORT_KEYS: SortKey[] = ['custom', 'duration', 'title', 'date'];

/**
 * One row of a playlist, as read from the DOM. Every field the DOM did not
 * expose in a readable/parseable form is null — never guessed, never
 * defaulted to zero. See src/content/selectors.ts for how these are filled.
 */
export interface PlaylistRow {
  /** The 11-char YouTube video id, or a positional fallback if none was found. */
  id: string;
  /** 1-based position in YouTube's own current ordering. */
  position: number;
  title: string;
  /** Raw duration text as rendered ("12:34"), or null (live/premiere/unavailable). */
  durationText: string | null;
  /** Parsed seconds, or null if durationText was missing or unparseable. */
  durationSeconds: number | null;
  /** Raw view-count text as rendered ("1.2K views"), or null if not shown. */
  viewsText: string | null;
  viewsCount: number | null;
  /** Raw upload-date text as rendered ("2 years ago"), or null if not shown. */
  dateText: string | null;
  /** True for a row YouTube itself renders as private/deleted/unavailable. */
  unavailable: boolean;
}

export interface ScanState {
  /** False when the current tab isn't a playlist page at all. */
  supported: boolean;
  /** Plain-language reason when supported is false, or a soft disclaimer when true. */
  notice: string | null;
  playlistTitle: string;
  /** True for the list=WL Watch Later URL shape — never verified live, see README. */
  isWatchLater: boolean;
  rows: PlaylistRow[];
  /** The count YouTube's own header prints, when it prints one. Never trusted as ground truth. */
  statedTotal: number | null;
  loading: boolean;
  /** Human-readable progress line shown only while loading is true. */
  loadProgress: string | null;
  scannedAt: number;
}

export function emptyScanState(): ScanState {
  return {
    supported: false,
    notice: null,
    playlistTitle: '',
    isWatchLater: false,
    rows: [],
    statedTotal: null,
    loading: false,
    loadProgress: null,
    scannedAt: 0,
  };
}

/* ── Messages (panel <-> content) ────────────────────────────────────── */

export type PanelToContent =
  | { type: 'PLS_GET_STATE' }
  | { type: 'PLS_LOAD_FULL' }
  | { type: 'PLS_CANCEL_LOAD' };

export type ContentToPanel = { type: 'PLS_STATE'; state: ScanState };

/* ── Preferences (chrome.storage.local) ──────────────────────────────── */

export interface Prefs {
  lastSortKey: SortKey;
  lastBudgetMinutes: number | null;
}

export const DEFAULT_PREFS: Prefs = {
  lastSortKey: 'custom',
  lastBudgetMinutes: null,
};
