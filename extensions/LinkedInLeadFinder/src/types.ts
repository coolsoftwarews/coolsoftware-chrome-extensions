/**
 * A "lead" is a person (or company page) who commented on a post the user was
 * reading. Nothing here is fetched or enriched — every field is copied from
 * what LinkedIn already rendered in the tab (PRD §4, §5).
 */

export type LeadStatus = 'new' | 'shortlist' | 'contacted' | 'dismissed';

export const LEAD_STATUSES: LeadStatus[] = ['new', 'shortlist', 'contacted', 'dismissed'];

/** One appearance of a lead: the post they commented on, and what they said there. */
export interface Capture {
  postUrl: string;
  /** Best-effort label for the post — author and a snippet of its text — for grouping in the panel. */
  postLabel: string;
  commentText: string;
  /** Reactions on the comment itself. Null when the count could not be read. */
  reactionCount: number | null;
  /** The date exactly as LinkedIn rendered it ("2d", "Jan 4") — never re-interpreted. */
  commentDate: string;
  /** When we captured this appearance (our clock, not LinkedIn's). */
  collectedAt: number;
}

export interface Lead {
  /** Deduplication key — see src/dedupe.ts. Stable across re-collection. */
  id: string;
  name: string;
  headline: string;
  /** Canonical profile URL, or null for an anonymized/deleted commenter (PRD §7). */
  profileUrl: string | null;
  /** A LinkedIn company page commented rather than a person (PRD §7). */
  isCompany: boolean;
  /** "LinkedIn Member" / deleted account — no profile to link to (PRD §7). */
  isAnonymized: boolean;
  /** One entry per distinct post this person was seen commenting on. */
  captures: Capture[];
  status: LeadStatus;
  note: string;
  firstCollectedAt: number;
  lastCollectedAt: number;
}

/** A user-defined qualification rule (PRD §4). Matching, never filtering. */
export interface Rule {
  id: string;
  keyword: string;
  enabled: boolean;
}

export interface RuleMatch {
  qualified: boolean;
  matchedKeywords: string[];
}

/** What the content script scraped for one commenter, before merge/dedupe. */
export interface RawCapture {
  name: string;
  headline: string;
  profileUrl: string | null;
  isCompany: boolean;
  isAnonymized: boolean;
  commentText: string;
  reactionCount: number | null;
  commentDate: string;
  postUrl: string;
  postLabel: string;
}

/** What a single "Collect commenters" click reports back to the page and panel. */
export interface CollectionSummary {
  postUrl: string;
  visible: number;
  collected: number;
  newLeads: number;
  updatedLeads: number;
  skipped: number;
  capped: boolean;
}

/* ── chrome.storage.local backup format ─────────────────────────────── */

export interface Backup {
  format: 'linkedin-lead-finder';
  version: 1;
  exportedAt: string;
  leads: Lead[];
  rules: Rule[];
}

export interface ImportResult {
  leads: number;
  newLeads: number;
  rules: number;
}

/* ── Messages (content ⇄ panel) ─────────────────────────────────────── */

export type ContentToPanel = { type: 'LLF_LEADS_CHANGED' };
