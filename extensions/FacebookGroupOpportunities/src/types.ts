/**
 * Core data model. Two shapes: the rule someone writes, and the opportunity a
 * rule finds. Everything else in the extension exists to fill or read these.
 */

/**
 * A rule is the two-part match the PRD calls the whole product (§4): an
 * *intent* phrase ("looking for") plus a *topic* word ("bookkeeper"), with an
 * optional ignore list to cut the obvious noise ("free", "intern"). A post
 * only counts when it has at least one of each, and none of the ignore words.
 */
export interface Rule {
  id: string;
  name: string;
  matchPhrases: string[];
  topicWords: string[];
  ignoreWords: string[];
  enabled: boolean;
  createdAt: number;
}

/** What a single rule found in a single post. */
export interface RuleHit {
  ruleId: string;
  ruleName: string;
  matchPhrase: string;
  topicWord: string;
}

export type OpportunityStatus = 'new' | 'replied' | 'dismissed';
export const OPPORTUNITY_STATUSES: OpportunityStatus[] = ['new', 'replied', 'dismissed'];

/**
 * One matched post. `id` is a stable hash of group + author + the first slice
 * of the post text (see dedupe.ts) — Facebook exposes no reliable post id in
 * a group feed, so re-scrolling past the same post must not create a second
 * card.
 */
export interface Opportunity {
  id: string;
  groupName: string;
  groupUrl: string | null;
  author: string;
  /** Full text as captured, never truncated in storage — only in the card. */
  postText: string;
  postUrl: string | null;
  commentCount: number | null;
  /** Whatever Facebook rendered as the post's date/time label, verbatim. */
  postedAt: string | null;
  /** When this extension captured it. */
  capturedAt: number;
  matches: RuleHit[];
  status: OpportunityStatus;
  note: string;
}

export const MAX_CARD_TEXT_LENGTH = 600;
/** Per-tab session cap (PRD §7: "cap collection per session, report the cap"). */
export const MAX_CAPTURES_PER_SESSION = 300;

/* ── Messages (panel/background ⇄ content) ──────────────────────────────
 * All read-only queries or local notifications. Nothing here ever triggers a
 * network request or an action on the Facebook page. */

export type PanelToContent =
  | { type: 'FGO_GET_TAB_STATUS' }
  | { type: 'FGO_RULES_CHANGED' };

export interface TabStatus {
  onFacebook: boolean;
  onGroup: boolean;
  groupName: string | null;
  sessionCaptured: number;
  sessionCapped: boolean;
}

export type ContentToPanel =
  | { type: 'FGO_OPPORTUNITY_CAPTURED'; id: string }
  | { type: 'FGO_SESSION_CAP_REACHED' };
