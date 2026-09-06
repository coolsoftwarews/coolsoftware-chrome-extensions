export type HighlightColor = 'yellow' | 'green' | 'blue' | 'pink';

export const COLORS: HighlightColor[] = ['yellow', 'green', 'blue', 'pink'];

/**
 * A highlight is stored as a W3C-style text-quote selector, never as a DOM
 * path. See src/quote.ts for why — the short version is that the DOM will not
 * be the same on the next visit, but the sentence will be.
 */
export interface Highlight {
  id: string;
  color: HighlightColor;
  /** The selected text, exactly as it read on the page. */
  exact: string;
  /** Up to 32 characters immediately before / after the selection. */
  prefix: string;
  suffix: string;
  /** Character offset in the page's text at capture time. A tiebreaker only. */
  hint: number;
  note: string;
  createdAt: number;
}

export interface PageMeta {
  /** Normalized URL — the storage key. */
  url: string;
  title: string;
  author: string;
  site: string;
  /** Article publication date as printed by the page, when it exposes one. */
  published: string;
  /** ISO date the page was first highlighted. */
  captured: string;
}

export interface PageRecord {
  meta: PageMeta;
  highlights: Highlight[];
  pageNote: string;
  updatedAt: number;
}

/** A highlight plus what the content script managed to do with it this visit. */
export interface ResolvedHighlight extends Highlight {
  /** False when the quote could not be re-found on the page. */
  anchored: boolean;
  /** Document order among anchored highlights; -1 when unanchored. */
  order: number;
}

export type ExportScope = 'highlights' | 'page';
export type ExportFormat = 'md' | 'html' | 'pdf' | 'txt';

export interface ExportOptions {
  includeMeta: boolean;
  includeNotes: boolean;
  includeSourceUrl: boolean;
}

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  includeMeta: true,
  includeNotes: true,
  includeSourceUrl: false,
};

/** What the content script hands back for a "full page" export. */
export interface ExtractedArticle {
  /** Cleaned, self-contained HTML with highlights already wrapped in <mark>. */
  html: string;
  /** Plain text of the same content. */
  text: string;
  /** True when reader extraction failed and we fell back to whole-body cleanup. */
  fallback: boolean;
}

export interface PageState {
  meta: PageMeta;
  highlights: ResolvedHighlight[];
  pageNote: string;
  /** Non-null when the page cannot be highlighted at all (chrome://, file://…). */
  unsupported: string | null;
}

/* ── Messages (panel ⇄ content ⇄ worker) ─────────────────────────────── */

export type PanelToContent =
  | { type: 'WH_GET_STATE' }
  | { type: 'WH_SCROLL_TO'; id: string }
  | { type: 'WH_DELETE'; id: string }
  | { type: 'WH_SET_COLOR'; id: string; color: HighlightColor }
  | { type: 'WH_SET_NOTE'; id: string; note: string }
  | { type: 'WH_SET_PAGE_NOTE'; note: string }
  | { type: 'WH_CLEAR_PAGE' }
  | { type: 'WH_EXTRACT' };

export type ContentToPanel =
  | { type: 'WH_STATE_CHANGED'; url: string }
  | { type: 'WH_OPEN_PANEL' };
