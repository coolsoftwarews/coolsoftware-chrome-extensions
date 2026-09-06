/**
 * The whole data model in one place. Two record types only:
 *
 *   WatchedPerson — someone the user chose to watch (PRD §4 "Add to watchlist")
 *   CollectedPost — a post by a watched person the user happened to see while
 *                   browsing (PRD §4 "Collection is browsing-driven")
 *
 * Nothing here is scraped in bulk and nothing is collected for people who are
 * not on the watchlist — see src/content.ts.
 */

export type PostType = 'text' | 'image' | 'document' | 'video' | 'poll' | 'article' | 'other';

export interface WatchedPerson {
  /** Normalized profile URL — the storage key and the dedupe key. */
  id: string;
  name: string;
  headline: string;
  avatarUrl: string;
  /** The user's note on this person, e.g. "good at carousels, weak hooks". */
  note: string;
  watchedAt: number;
}

export interface CollectedPost {
  /** Post URN when LinkedIn exposes one, else a derived fallback id. */
  id: string;
  /** Which watched person this post belongs to — always the original author. */
  personId: string;
  postType: PostType;
  /** Text preview as it read on the page. Empty for pure media/poll/document posts. */
  text: string;
  reactions: number;
  comments: number;
  reposts: number;
  /** True if the user ever encountered this post via someone else's repost. */
  seenAsRepost: boolean;
  /** Link to the post, when one could be recovered. */
  url: string;
  /** Best guess at publish time; null when only a relative label was readable. */
  postedAt: number | null;
  /** Raw relative label ("2d", "1w") kept as a fallback for display. */
  postedAtLabel: string;
  /** When this post was first seen, and when its highest counts were recorded (PRD §7). */
  firstSeenAt: number;
  countsUpdatedAt: number;
  /** The user's note on this specific post. */
  note: string;
}

export type SortMode = 'recency' | 'outlier';
export type FilterMode = 'all' | 'outliers';

export interface ExportOptions {
  includeNotes: boolean;
}

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  includeNotes: true,
};

/** A post plus the outlier ratio computed against its author's collected posts. */
export interface RatedPost extends CollectedPost {
  /** post engagement ÷ author's median engagement, or null with too few posts to judge. */
  ratio: number | null;
}
