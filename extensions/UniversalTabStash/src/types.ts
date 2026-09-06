/**
 * Every type in this file describes a plain object — never a `chrome.tabs.Tab`
 * directly. That split is deliberate (PRD §5): the pure logic in `stash.ts` and
 * `formatters.ts` only ever sees descriptors like these, so it can be tested
 * headlessly with no `chrome.*` in scope. `tabs.ts` is the one file that talks
 * to the real browser API and converts to/from these shapes.
 */

/** What we read off a live `chrome.tabs.Tab` before it becomes a stash entry. */
export interface OpenTab {
  /** The live browser tab id — only meaningful for the current session. */
  chromeTabId: number;
  title: string;
  url: string;
  favIconUrl?: string;
  pinned: boolean;
}

/** A tab as it lives inside a stash, forever — no dependency on chromeTabId. */
export interface StashedTab {
  /** Stable id generated at capture time; used to dedupe on import. */
  id: string;
  title: string;
  url: string;
  favIconUrl?: string;
  pinned: boolean;
}

export interface Stash {
  id: string;
  name: string;
  notes: string;
  createdAt: number;
  updatedAt: number;
  tabs: StashedTab[];
}

export interface StashSearchHit {
  stashId: string;
  stashName: string;
  tab: StashedTab;
}

export interface RestorePlan {
  tabs: StashedTab[];
  /** Tabs grouped into responsible batches for opening (PRD §7). */
  batches: StashedTab[][];
  needsConfirmation: boolean;
}

/* ── Backup / import-export ─────────────────────────────────────────── */

export interface Backup {
  format: 'universal-tab-stash';
  version: 1;
  exportedAt: string;
  stashes: Stash[];
}

export interface MergeStats {
  stashes: number;
  tabs: number;
}

export interface MergeResult {
  merged: Stash[];
  stats: MergeStats;
}

/* ── Options ─────────────────────────────────────────────────────────── */

export interface Options {
  /** Whether "stash all tabs" includes pinned tabs by default (PRD §7). */
  includePinnedByDefault: boolean;
}

export const DEFAULT_OPTIONS: Options = {
  includePinnedByDefault: false,
};
