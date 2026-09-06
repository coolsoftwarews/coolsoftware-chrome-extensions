/**
 * Turns one timeline `<article>` into a RawPost. Returns null for anything
 * that isn't a badgeable post at all — ads, and anything missing the one
 * field (the status id) that everything else keys off. A parse failure here
 * must never throw past the caller (PRD §6); every lookup already degrades
 * to null in selectors.ts, so this function is safe to call on every post,
 * every mutation, without a try/catch of its own — content.ts wraps the loop
 * regardless, as a second line of defence.
 */

import { parseCount } from './velocity';
import { RawPost } from './types';
import * as dom from './selectors';

function statusId(href: string | null): string | null {
  if (!href) return null;
  const match = href.match(/\/status\/(\d+)/);
  return match ? match[1] : null;
}

export function scanPost(post: Element): RawPost | null {
  if (dom.isPromoted(post)) return null;

  const href = dom.permalinkHref(post);
  const id = statusId(href);
  const handle = dom.authorHandle(post);
  if (!id || !handle) return null;

  const time = dom.timeElement(post);
  const datetime = time?.getAttribute('datetime');
  const publishedAt = datetime ? Date.parse(datetime) : NaN;

  return {
    id,
    url: `https://x.com${href}`,
    authorHandle: handle,
    authorName: dom.authorName(post) ?? handle,
    textPreview: dom.bodyText(post),
    likes: parseCount(dom.likeCountText(post)),
    reposts: parseCount(dom.repostCountText(post)),
    replies: parseCount(dom.replyCountText(post)),
    publishedAt: Number.isFinite(publishedAt) ? publishedAt : null,
    isAd: false,
    isQuote: dom.hasQuotedPost(post),
  };
}
