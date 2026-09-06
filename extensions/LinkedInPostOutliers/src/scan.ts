/**
 * Turns whatever's currently rendered into RawPost[]. DOM structure lookups
 * live in dom.ts; text-shape parsing lives in text.ts. This module just
 * wires the two together, and never lets one bad post take the rest down.
 */

import * as dom from './dom';
import { extractCounts, normalizePostUrl, normalizeProfileUrl, parseRelativeTime, truncateText } from './text';
import { RawPost } from './types';

export interface ScanResult {
  posts: RawPost[];
  /** True when post containers were present but nothing usable could be read from any of them. */
  failed: boolean;
}

/**
 * The stable identity of one post container: its dedupe id and its author.
 * Exported separately from scanPosts so content.ts's badge-placement pass
 * (which needs the *live* container reference, not just a RawPost) can
 * derive exactly the same id without a second, drifting implementation.
 */
export interface PostIdentity {
  id: string;
  authorId: string;
  authorName: string;
  isRepost: boolean;
}

export function identifyPost(container: Element): PostIdentity | null {
  const author = dom.detectAuthor(container);
  if (!author) return null;

  const authorId = normalizeProfileUrl(author.href);
  const authorName = truncateText(author.name, 120);
  if (!authorName) return null;

  const urn = dom.postUrn(container);
  // A stable dedupe key (PRD §7): the URN when LinkedIn exposes one, else a
  // fallback built from the author and a slice of the post's own text so the
  // same post seen twice in one scan still collapses to one row.
  const id = urn ?? `fallback:${authorId}:${truncateText(container.textContent ?? '', 60)}`;

  return { id, authorId, authorName, isRepost: author.isRepost };
}

export function scanPosts(now = Date.now()): ScanResult {
  const containers = dom.postContainers();
  if (containers.length === 0) return { posts: [], failed: false };

  const posts: RawPost[] = [];
  let usable = 0;

  for (const container of containers) {
    try {
      const identity = identifyPost(container);
      if (!identity) continue;

      const urn = dom.postUrn(container);
      const counts = extractCounts(dom.findCountsBlockText(container));
      const relativeLabel = dom.findRelativeLabel(container);
      const postUrlRaw = dom.findPostUrl(container, urn);

      if (counts.reactions !== null || counts.comments !== null) usable++;

      posts.push({
        id: identity.id,
        authorId: identity.authorId,
        authorName: identity.authorName,
        authorHeadline: truncateText(dom.findHeadline(container), 160),
        postType: dom.derivePostType(container),
        isRepost: identity.isRepost,
        pinned: dom.isPinnedOrFeatured(container),
        reactions: counts.reactions,
        comments: counts.comments,
        reposts: counts.reposts,
        postedAt: parseRelativeTime(relativeLabel, now),
        postedAtLabel: relativeLabel,
        url: postUrlRaw ? normalizePostUrl(postUrlRaw) : '',
      });
    } catch {
      // One post's markup being unexpected must never take the rest down.
      continue;
    }
  }

  // Containers existed but not one of them yielded a count — that's the DOM
  // rewrite PRD §6/§8 asks to detect, not merely a quiet page.
  const failed = posts.length > 0 && usable === 0;
  return { posts, failed };
}
