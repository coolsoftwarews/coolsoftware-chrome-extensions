/** A pin card as read off the currently rendered search results grid. Nothing here is fetched — it is only what Pinterest already put in the DOM. */
export interface PinCard {
  /** Pinterest's own pin id, parsed from the card's link. */
  id: string;
  /** Position in the loaded result set, 0-based, in document order. Stable within a session, used as the rank fallback. */
  rank: number;
  title: string;
  description: string;
  /** Outbound domain shown on the card (e.g. "example.com"), or null when Pinterest didn't render one. */
  domain: string | null;
  /** Parsed save/reaction count, or null when the card exposes no readable number (PRD §5's core weakness). */
  saveCount: number | null;
  isPromoted: boolean;
  /** Idea pins (multi-page, no outbound link) surface differently and never carry a comparable save count. */
  isIdeaPin: boolean;
  imageWidth: number | null;
  imageHeight: number | null;
  /** Best-effort heuristic; null means "not detected" rather than "no overlay" (PRD §4: filters where detectable). */
  hasTextOverlay: boolean | null;
  /** Normalized source image URL, used to group repins of the same image (PRD §7). */
  imageUrl: string | null;
  pinUrl: string;
}

export type BadgeKind = 'ratio' | 'rank' | 'promoted' | 'idea-pin' | 'unknown';

/**
 * What gets painted on a card. `ratio` is only ever produced when the engine
 * trusts the sample; everything else is explicitly labelled so a rank is
 * never mistaken for a save count (PRD §5).
 */
export interface PinBadge {
  pinId: string;
  kind: BadgeKind;
  ratio?: number;
  saveCount?: number;
  rank?: number;
  /** Pins backing the median / rank pool, always shown alongside the badge. */
  sampleSize: number;
}

export interface OutlierBaseline {
  /** Median save count among eligible (non-promoted, non-idea-pin, numeric) pins, or null when there weren't enough to trust. */
  median: number | null;
  /** Count of pins the median was computed from. */
  sampleSize: number;
  /** Fraction of non-promoted, non-idea pins that exposed a usable save count. */
  usableFraction: number;
  /** False once usableFraction/sampleSize fall below the trust thresholds — badges degrade to rank-only (PRD §5). */
  trustworthy: boolean;
}

export interface KeywordStat {
  phrase: string;
  /** Distinct outlier pins (after repin grouping) containing the phrase. */
  outlierCount: number;
  outlierSampleSize: number;
  restCount: number;
  restSampleSize: number;
  /** Over-representation ratio, Laplace-smoothed so a 0-count phrase isn't infinite/zero. */
  ratio: number;
}

export interface DomainStat {
  domain: string;
  outlierCount: number;
  outlierSampleSize: number;
}

export interface FormatBand {
  label: string;
  count: number;
  fraction: number;
}

export interface FormatStats {
  aspectBands: FormatBand[];
  textOverlay: FormatBand[];
  sampleSize: number;
}

export interface KeywordPanelData {
  keywords: KeywordStat[];
  domains: DomainStat[];
  formats: FormatStats;
  outlierSampleSize: number;
  restSampleSize: number;
}

export interface Filters {
  minRatio: number | null;
  domain: string | null;
  hasTextOverlay: boolean | null;
  lastN: number | null;
}

export const DEFAULT_FILTERS: Filters = {
  minRatio: null,
  domain: null,
  hasTextOverlay: null,
  lastN: null,
};

/** What the content script hands the panel for one query. */
export interface QuerySnapshot {
  query: string | null;
  url: string;
  pins: PinCard[];
  baseline: OutlierBaseline;
  badges: Record<string, PinBadge>;
  unsupported: string | null;
}

/** Cached per-query median, so the panel has something to show before a fresh scrape completes. */
export interface QueryCache {
  query: string;
  median: number | null;
  sampleSize: number;
  usableFraction: number;
  updatedAt: number;
}

export type ExportFormat = 'pins-csv' | 'keywords-csv' | 'report-md';

/* ── Messages (panel ⇄ content) ──────────────────────────────────────── */

export type PanelToContent = { type: 'POF_GET_SNAPSHOT' } | { type: 'POF_RESCAN' };

export type ContentToPanel = { type: 'POF_SNAPSHOT_CHANGED'; url: string };
