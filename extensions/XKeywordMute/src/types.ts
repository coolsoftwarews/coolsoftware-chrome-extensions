/**
 * Core data model. One shape, deliberately: a rule someone writes to mute a
 * keyword or phrase. Everything else in the extension exists to fill it,
 * evaluate it against rendered posts, or let the user own the list of them.
 */

/** How a rule's value is compared against rendered text (PRD §4). */
export type RuleMode = 'substring' | 'whole-word' | 'regex';

/**
 * A rule is a single keyword/phrase (or, in `regex` mode, a user-supplied
 * pattern) — deliberately simpler than the Facebook Group Opportunity
 * Finder's two-part intent+topic rule (see docs/extensions/README.md's
 * shared "Rules engine" table): this product mutes on one signal at a time,
 * not an intent/topic pair.
 */
export interface Rule {
  id: string;
  /** The keyword, phrase, or (in regex mode) pattern source. */
  value: string;
  /** Optional friendlier display name — falls back to `value` when empty. */
  label: string;
  mode: RuleMode;
  /** Off by default — matching is case-insensitive unless the user opts in. */
  caseSensitive: boolean;
  enabled: boolean;
  createdAt: number;
  /** All-time hit count, persisted — the PRD's "hit-count per rule so users
   *  see what's actually firing" (§4), and the safety net for an overly
   *  broad rule (§5). */
  hitCount: number;
}

/** What a single rule found on a single rendered post. */
export interface RuleMatch {
  ruleId: string;
  /** `rule.label || rule.value`, captured at match time for the placeholder text. */
  label: string;
}

/** Text already rendered in a post's DOM (PRD §5: read-only, foreground-only). */
export interface ExtractedPost {
  /** The post's own text, plus an embedded quoted post's text when present
   *  (PRD §7: this is a deliberate, disclosed simplification). */
  text: string;
  /** Display name of the post's author. */
  author: string;
  hashtags: string[];
}

export const MAX_RULE_VALUE_LENGTH = 200;
export const MAX_LABEL_LENGTH = 80;

/* ── Starter packs ────────────────────────────────────────────────────── */

export interface StarterPackRule {
  value: string;
  mode: RuleMode;
  caseSensitive: boolean;
}

export interface StarterPack {
  id: string;
  label: string;
  description: string;
  rules: StarterPackRule[];
}

/* ── Messages (panel/background <-> content) ─────────────────────────────
 * All read-only queries or local notifications. Nothing here ever triggers a
 * network request or a write action on X. */

export type PanelToContent = { type: 'XKM_GET_TAB_STATUS' } | { type: 'XKM_RULES_CHANGED' };

export interface TabStatus {
  onX: boolean;
  sessionScanned: number;
  sessionHiddenCount: number;
}

export type ContentToPanel =
  | { type: 'XKM_POST_HIDDEN' }
  | { type: 'XKM_RULE_FLAGGED_BROAD'; ruleId: string; label: string; hits: number; scanned: number };
