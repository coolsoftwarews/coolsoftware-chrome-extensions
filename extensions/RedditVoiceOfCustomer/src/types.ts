export interface Theme {
  id: string;
  name: string;
}

/** Renameable, deletable — these just seed a fresh install (PRD §4). */
export const DEFAULT_THEMES: Theme[] = [
  { id: 'pain', name: 'Pain' },
  { id: 'objections', name: 'Objections' },
  { id: 'language', name: 'Language' },
  { id: 'alternatives', name: 'Alternatives' },
  { id: 'feature-requests', name: 'Feature requests' },
];

/** A quote with no themeId, or one whose theme was deleted, groups here. */
export const UNCATEGORIZED_THEME: Theme = { id: '', name: 'Uncategorized' };

/**
 * One capture card: the selected sentence plus everything needed to cite it
 * (PRD §4) — a quote without its thread is unciteable, and citability is the
 * whole job this product does.
 */
export interface Quote {
  id: string;
  /** The selected text, exactly as it read on the page. */
  quote: string;
  /** The full comment or post body the quote came from, for context. */
  context: string;
  /** Reddit username as displayed, or '' when saved anonymously. */
  author: string;
  /** True when the username was deliberately left out at save time. */
  anonymized: boolean;
  /** "r/subreddit" */
  subreddit: string;
  threadTitle: string;
  /** Absolute URL to the thread (the post). */
  threadUrl: string;
  /** Absolute URL to the specific comment or post permalink. */
  permalink: string;
  /** Upvote score at capture time; null when it could not be read. */
  score: number | null;
  /** ISO 8601 date string when the page exposed one, else ''. */
  postedAt: string;
  /** The user's note on this quote. */
  note: string;
  /** Theme id, or '' for uncategorized. */
  themeId: string;
  /** When this quote was saved. */
  createdAt: number;
}

/** What content.ts hands storage.ts when it captures a new selection. */
export type NewQuoteInput = Omit<Quote, 'id' | 'createdAt' | 'note' | 'themeId'>;

export type SaveStatus = 'saved' | 'replaced' | 'duplicate';

export interface SaveOutcome {
  status: SaveStatus;
  quote: Quote;
}

export interface Backup {
  format: 'reddit-voice-of-customer';
  version: 1;
  exportedAt: string;
  quotes: Quote[];
  themes: Theme[];
}

export interface ImportResult {
  quotes: number;
  themes: number;
}

export interface QuotaStatus {
  bytes: number;
  ratio: number;
  warn: boolean;
}

export interface Options {
  /** Save §5's "save without username" toggle — off by default (more useful
   *  for citation); a prominent switch in the panel is the trust signal. */
  anonymizeByDefault: boolean;
}

export const DEFAULT_OPTIONS: Options = { anonymizeByDefault: false };
