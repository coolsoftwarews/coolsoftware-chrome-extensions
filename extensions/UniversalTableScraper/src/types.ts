/**
 * Shapes shared between the DOM-bound half (content.ts, which walks the real
 * page) and the pure, testable half (table.ts, csv.ts, heuristics.ts,
 * formatters.ts). Nothing in this file touches the DOM or chrome.* — it is
 * safe to import from scripts/selftest.mjs.
 */

/** One `<td>`/`<th>` as read off the page, before merged-cell normalization. */
export interface RawCell {
  text: string;
  colSpan: number;
  rowSpan: number;
  isHeader: boolean;
}

export type RawRow = RawCell[];

/** The result of laying `<table>` (or list-heuristic) input out into a grid. */
export interface NormalizedTable {
  /** Column names — inferred, forced, or auto-generated ("Column 1", …). */
  headers: string[];
  /** Data rows only; never includes the header row. */
  rows: string[][];
  /** True when `headers` came from real header cells/tags rather than being generated. */
  headerInferred: boolean;
  /** True when the source had more rows than the cap allowed and was truncated. */
  truncated: boolean;
  /** Total rows found before any cap was applied (data rows, excluding header). */
  totalRowCount: number;
}

export interface NormalizeOptions {
  /**
   * Force the header decision rather than infer it. `null`/`undefined` means
   * "infer from the data" (see table.ts).
   */
  forceHeaderRow?: boolean | null;
  /** Maximum data rows to keep. Excess rows are dropped, not silently hidden. */
  maxRows?: number;
}

/** One candidate item in a repeated card/list structure, as read off the page. */
export interface CandidateItemSignature {
  /** Tag+class shape of this item's children, used to score structural similarity. */
  shape: string;
  /** Extracted field text keyed by a stable, order-based field id (e.g. "field_0"). */
  fields: Record<string, string>;
}

export interface ListDetectionResult {
  confident: boolean;
  /** 0..1 confidence score — see heuristics.ts for the weighting. */
  score: number;
  columns: string[];
  rows: string[][];
  /** Plain-language reason when `confident` is false. Never a raw error. */
  reason?: string;
}

export type ExportFormat = 'csv' | 'json';

export interface PageMeta {
  url: string;
  title: string;
  site: string;
}

/* ── Messages (popup ⇄ content ⇄ background) ─────────────────────────── */

export type PopupToContent =
  | { type: 'UTS_PING' }
  | { type: 'UTS_START_PICK' };

export type ContentToBackground = {
  type: 'UTS_DOWNLOAD';
  dataUrl: string;
  filename: string;
};

