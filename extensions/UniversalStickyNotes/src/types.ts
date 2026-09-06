export type NoteColor = 'yellow' | 'pink' | 'blue' | 'green' | 'purple';

export const COLORS: NoteColor[] = ['yellow', 'pink', 'blue', 'green', 'purple'];

export const COLOR_VALUES: Record<NoteColor, string> = {
  yellow: '#ffe680',
  pink: '#ffc4dd',
  blue: '#b9dcff',
  green: '#b6f2c4',
  purple: '#dcc7f7',
};

/**
 * A note's position is a percentage of the document's scroll size at save
 * time, not raw pixels — see src/position.ts for why (PRD §5). Size stays in
 * pixels; a note is small enough that its own dimensions don't need to scale
 * with the page.
 */
export interface Note {
  id: string;
  color: NoteColor;
  text: string;
  xPct: number;
  yPct: number;
  widthPx: number;
  heightPx: number;
  createdAt: number;
  updatedAt: number;
}

export interface PageMeta {
  /** Normalized URL — the storage key. */
  url: string;
  title: string;
  site: string;
  /** ISO date the first note on this page was created. */
  captured: string;
}

export interface PageRecord {
  meta: PageMeta;
  notes: Note[];
  /** "Hide all notes on this page" — the clutter mitigation from PRD §7. */
  hidden: boolean;
  updatedAt: number;
}

/** What the content script hands back when the panel asks about this page. */
export interface PageState {
  meta: PageMeta;
  notes: Note[];
  hidden: boolean;
  /** Non-null when the page cannot hold notes at all (chrome://, file://…). */
  unsupported: string | null;
}

/* ── Messages (panel ⇄ content) ───────────────────────────────────────── */

export type PanelToContent =
  | { type: 'SN_GET_STATE' }
  | { type: 'SN_CREATE_NOTE' }
  | { type: 'SN_SCROLL_TO'; id: string };

export type ContentToPanel = { type: 'SN_STATE_CHANGED'; url: string };
