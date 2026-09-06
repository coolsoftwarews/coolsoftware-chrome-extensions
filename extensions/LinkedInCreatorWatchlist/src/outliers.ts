/**
 * The outlier engine (README "Shared modules" — median baseline, ratio badge,
 * sample-size honesty). This copy is scoped to one person's collected posts
 * rather than a whole niche, since the PRD frames it as "this post vs. that
 * person's collected median" (PRD §4), not a cross-creator comparison.
 */

import { CollectedPost, RatedPost } from './types';

/** Below this many posts, a median is a guess, not a baseline — no ratio is shown. */
export const MIN_SAMPLE_SIZE = 3;

export function engagement(post: Pick<CollectedPost, 'reactions' | 'comments' | 'reposts'>): number {
  return post.reactions + post.comments + post.reposts;
}

export function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Rates every post in `posts` against the median of its own author's posts
 * within that same list. A post with zero baseline engagement (median 0) is
 * left unrated rather than reported as an infinite outlier.
 */
export function rateByAuthor(posts: CollectedPost[]): RatedPost[] {
  const byAuthor = new Map<string, CollectedPost[]>();
  for (const post of posts) {
    const list = byAuthor.get(post.personId) ?? [];
    list.push(post);
    byAuthor.set(post.personId, list);
  }

  const medians = new Map<string, number>();
  for (const [personId, authorPosts] of byAuthor) {
    medians.set(personId, median(authorPosts.map(engagement)));
  }

  return posts.map(post => {
    const authorPosts = byAuthor.get(post.personId) ?? [];
    const baseline = medians.get(post.personId) ?? 0;
    const ratio = authorPosts.length >= MIN_SAMPLE_SIZE && baseline > 0 ? engagement(post) / baseline : null;
    return { ...post, ratio };
  });
}
