/**
 * Reading-time estimate and the honest "how much of this thread did we
 * actually read" summary lines (PRD-25 §4/§5). Pure — no DOM, no chrome.* —
 * so scripts/selftest.mjs can check it headlessly.
 */

import { ThreadSession, UnrolledPost } from './types';

/** English-oriented average adult silent reading speed. Not tuned per
 *  language in V1 (PRD-25 §10 open question) — labelled as an estimate
 *  ("~N min read"), never claimed as precise. */
const WORDS_PER_MINUTE = 200;

export function wordCount(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

export function totalWordCount(posts: UnrolledPost[]): number {
  return posts.reduce((sum, post) => sum + wordCount(post.text), 0);
}

/** Always at least 1 minute for a non-empty thread — "~0 min read" reads as
 *  broken, not fast. */
export function estimateReadingMinutes(posts: UnrolledPost[], wordsPerMinute = WORDS_PER_MINUTE): number {
  const words = totalWordCount(posts);
  if (words <= 0) return 0;
  return Math.max(1, Math.round(words / wordsPerMinute));
}

export function readingTimeLabel(posts: UnrolledPost[]): string {
  const minutes = estimateReadingMinutes(posts);
  if (minutes <= 0) return '';
  return `~${minutes} min read`;
}

/** Non-deleted posts are the ones that count as "shown" — a deleted-post
 *  placeholder is a gap marker, not a post the user can read (PRD-25 §7). */
export function readablePosts(posts: UnrolledPost[]): UnrolledPost[] {
  return posts.filter(p => !p.deleted);
}

export function postsShownLabel(posts: UnrolledPost[]): string {
  const count = readablePosts(posts).length;
  return `${count} post${count === 1 ? '' : 's'} shown`;
}

/**
 * The one honesty rule this whole product turns on (PRD-25 §5): never claim
 * a fraction of a total X never exposes. Report what was proven (a literal
 * count, already in postsShownLabel) and, separately, flag what couldn't be
 * counted — never both folded into one invented "N of M" number.
 */
export function completenessNote(session: Pick<ThreadSession, 'truncated' | 'cappedAt200'>): string | null {
  if (session.cappedAt200) return 'Stopped at 200 posts — this thread may have more.';
  if (session.truncated) return 'More may exist — X did not fully load this thread.';
  return null;
}
