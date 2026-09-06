/**
 * The whole data model in one place: one record per LinkedIn profile the user
 * chose to note, keyed by the profile's normalized URL (PRD §4: "notes
 * persist keyed by the profile's URL/vanity slug"). There is no separate
 * "post" or "lead" concept here — see src/content.ts, which reads only a
 * profile's own name/headline/URL and never anything about that person's
 * activity (PRD §5).
 */

export interface ProfileNote {
  /** Normalized profile URL — the storage key. */
  id: string;
  name: string;
  headline: string;
  avatarUrl: string;
  /** Free text, the note itself. */
  text: string;
  /** Optional one-line tag, e.g. "met at conf", "candidate", "follow up". */
  tag: string;
  firstNotedAt: number;
  /** Bumped every time the note's text or tag is edited — drives "last noted: 3 days ago". */
  lastNotedAt: number;
}

export type SortMode = 'recency' | 'alpha';

/** The starter tag set (PRD §4) — user can still type any tag freeform. */
export const STARTER_TAGS = ['met at conf', 'candidate', 'follow up', 'client', 'prospect'];
