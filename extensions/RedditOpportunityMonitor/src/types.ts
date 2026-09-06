/**
 * Core data model. Two shapes: the rule someone writes, and the opportunity a
 * rule finds — same split as the Facebook pair (README's shared "Rules
 * engine" module), adapted to Reddit's data.
 */

/**
 * A rule is the two-part match the PRD calls the whole product (§4): an
 * *intent* phrase ("looking for") plus a *topic* word ("invoicing"), with an
 * optional ignore list to cut the obvious noise ("free only"). A post only
 * counts when it has at least one of each, and none of the ignore words.
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

export type RedditFrontend = 'old' | 'new';

/**
 * One matched post. `id` is Reddit's own fullname (`t3_xxxxx`) — unlike the
 * Facebook pair, Reddit hands the content script a real, stable id, so
 * dedupe across the home feed and a post's own subreddit is exact, not a hash
 * (PRD §7).
 */
export interface Opportunity {
  id: string;
  subreddit: string;
  title: string;
  /** Selftext preview as rendered in the feed, or '' when the post has none
   * (link/image/video posts, or a front-end that doesn't show one). */
  snippet: string;
  permalink: string;
  score: number | null;
  numComments: number | null;
  /** Reddit's own relative label ("5 hr. ago") when that is all a front-end
   * exposes; used only for display, never for sorting. */
  postedAtLabel: string | null;
  /** Epoch ms when available (new Reddit's created-timestamp, old Reddit's
   * <time datetime>) — used for sorting and age display. */
  createdAtMs: number | null;
  /** When this extension captured it. */
  capturedAt: number;
  matches: RuleHit[];
  status: OpportunityStatus;
  note: string;
  frontend: RedditFrontend;
}

/** Per-subreddit-word count for the "how this community talks" summary. */
export interface IntentPhraseCount {
  phrase: string;
  count: number;
}

/**
 * "For the current subreddit, a small summary from what's loaded" (PRD §4).
 * Computed live from whatever posts the content script has scanned this
 * session — never fetched, never a rolling background total.
 */
export interface SubredditSummary {
  subreddit: string;
  postsScanned: number;
  medianScore: number | null;
  topIntentPhrases: IntentPhraseCount[];
}

/** Per-tab session cap (PRD §7: "very high-volume subreddits — cap per
 * session, report the cap"). Applies to matched posts captured, not to the
 * lighter-weight subreddit-summary scan. */
export const MAX_CAPTURES_PER_SESSION = 400;

/* ── Messages (panel ⇄ content) ──────────────────────────────────────────
 * All read-only queries or local notifications. Nothing here ever triggers a
 * network request, a vote, a comment or any other action on the user's
 * behalf — read-only on the platform, permanently (README's hard constraints). */

export type PanelToContent =
  | { type: 'ROM_GET_TAB_STATUS' }
  | { type: 'ROM_RULES_CHANGED' };

export interface TabStatus {
  onReddit: boolean;
  frontend: RedditFrontend | null;
  /** null on the home feed / a multi-subreddit page / anywhere that isn't
   * exactly one subreddit's listing. */
  subreddit: string | null;
  summary: SubredditSummary | null;
  sessionCaptured: number;
  sessionCapped: boolean;
}

export type ContentToPanel =
  | { type: 'ROM_OPPORTUNITY_CAPTURED'; id: string }
  | { type: 'ROM_SESSION_CAP_REACHED' };
