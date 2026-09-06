/**
 * X/Twitter DOM extraction — the hostile half (PRD §6: "A parse failure
 * disables filtering for that post quietly; the timeline must never break").
 *
 * X ships obfuscated, frequently-changing class names but keeps a fairly
 * stable set of `data-testid` attributes (the same anchors the portfolio's
 * other X extensions rely on — see XVelocityFinder/src/selectors.ts and
 * XConversationSaver/src/scrape.ts). Every lookup here returns an empty
 * value rather than throwing, so a changed selector degrades one field
 * instead of taking the timeline down with it.
 *
 * The DOM-walking functions need a real browser and are covered by the
 * manual checklist in README.md; the plain-text helper (`extractHashtags`,
 * used by `buildPost`) lives in rules.ts and is unit tested in
 * scripts/selftest.mjs.
 */

import { extractHashtags } from './rules';
import { ExtractedPost } from './types';

export const POST_SELECTOR = 'article[data-testid="tweet"]';

/** Every post article currently rendered on the page. */
export function findPostArticles(root: ParentNode = document): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(POST_SELECTOR));
}

/** All rendered post text within an article — the post's own body plus, when
 *  present, an embedded quoted post's text (PRD §7: deliberately matched as
 *  one combined surface, disclosed as a simplification, not an attempt to
 *  attribute text to the quoting vs. quoted author). */
function readAllTweetText(article: Element): string {
  const blocks = Array.from(article.querySelectorAll('[data-testid="tweetText"]'));
  return blocks
    .map(block => block.textContent?.trim() ?? '')
    .filter(Boolean)
    .join(' ');
}

/** The display name out of the post's `User-Name` block — the first
 *  non-"@handle" span, matching the pattern the portfolio's other X
 *  extensions already use. */
function readAuthorName(article: Element): string {
  const block = article.querySelector('[data-testid="User-Name"]');
  if (!block) return '';
  const spans = Array.from(block.querySelectorAll('span'))
    .map(span => span.textContent?.trim() ?? '')
    .filter(Boolean);
  return spans.find(s => !s.startsWith('@')) ?? spans[0] ?? '';
}

/** Builds the pure `ExtractedPost` shape rules.ts evaluates. Never throws —
 *  a post whose DOM doesn't match expectations still produces a (possibly
 *  empty) post rather than stopping the scan. */
export function extractPost(article: Element): ExtractedPost {
  try {
    const text = readAllTweetText(article);
    const author = readAuthorName(article);
    return { text, author, hashtags: extractHashtags(`${text} ${author}`) };
  } catch {
    return { text: '', author: '', hashtags: [] };
  }
}

/** Promoted posts carry an explicit indicator; filtering them is left to the
 *  user's own rules like everything else — this is only used to skip an
 *  empty/undetectable article defensively, not to special-case ads. */
export function hasReadableContent(post: ExtractedPost): boolean {
  return post.text.trim().length > 0 || post.author.trim().length > 0;
}
