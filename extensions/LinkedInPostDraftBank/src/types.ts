/**
 * One item type covers everything the library holds: a draft the user is
 * still working on, a template they've explicitly saved for reuse, and an
 * archived copy of a post they've actually published. Keeping one shape
 * (discriminated by `kind`) is what lets search/export/the panel list treat
 * them uniformly, per PRD-35 §4's "search across the whole library".
 */

export type ItemKind = 'draft' | 'template' | 'published';

export interface LibraryItem {
  id: string;
  kind: ItemKind;
  text: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;

  /** draft-only: true when this row came from the extension's own silent
   *  auto-save rather than an explicit "Save as draft" click (PRD §7 — must
   *  stay visibly distinct from LinkedIn's own separate autosave). */
  autosaved?: boolean;

  /** published-only: a stable identifier for the LinkedIn post (its URN),
   *  used to update the archived copy in place on re-capture rather than
   *  duplicating it (PRD §7, "editing a previously-published post"). */
  postUrn?: string;
  /** published-only: permalink to the live post, when one could be read. */
  postUrl?: string;
  /** published-only: the date exactly as LinkedIn rendered it ("2d", "Jan 4")
   *  — never re-interpreted into a guessed absolute date. */
  publishedAtLabel?: string;
}

/** What the panel needs to render + search one row; a narrowed LibraryItem. */
export type SearchableItem = Pick<LibraryItem, 'id' | 'kind' | 'text' | 'tags'>;

/* ── Truncation ──────────────────────────────────────────────────────── */

export type Device = 'desktop' | 'mobile';

export interface TruncationLimits {
  /** Character budget before LinkedIn's own "…see more" link appears. */
  charBudget: number;
  /**
   * Extra character-equivalent weight charged per line break, approximating
   * that a line break consumes vertical space a plain character does not.
   * Not an independently measured constant — see PRD-35 §5's honesty
   * requirement about this whole feature.
   */
  lineBreakWeight: number;
}

export interface TruncationResult {
  device: Device;
  charBudget: number;
  /** Index into the source text where the cut lands, or null when it all fits. */
  cutIndex: number | null;
  visibleText: string;
  hiddenText: string;
  truncated: boolean;
  charCount: number;
}

/* ── chrome.storage.local backup format ─────────────────────────────── */

export interface Backup {
  format: 'linkedin-post-draft-bank';
  version: 1;
  exportedAt: string;
  items: LibraryItem[];
}

export interface ImportResult {
  items: number;
  newItems: number;
}

/* ── Messages (content ⇄ panel ⇄ background) ────────────────────────── */

export type ContentToPanel = { type: 'PDB_LIBRARY_CHANGED' };

export type PanelToContent =
  | { type: 'PDB_GET_COMPOSER_STATE' }
  | { type: 'PDB_INSERT_TEMPLATE'; text: string };

export interface ComposerState {
  open: boolean;
  text: string;
  hasMedia: boolean;
}
