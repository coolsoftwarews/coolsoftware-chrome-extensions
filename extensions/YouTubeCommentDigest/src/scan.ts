/**
 * The DOM-bound half: finds the comment section, walks every currently-mounted
 * thread, and turns each into a Comment via the pure comment.ts builder. This
 * file itself has no unit tests (it needs a live YouTube DOM) — the logic it
 * delegates to (comment.ts, parse.ts) does. See README's manual checklist.
 */

import { buildComment, RawCommentFields } from './comment';
import * as dom from './selectors';
import { Comment, VideoMeta } from './types';

export function findCommentsSection(): Element | null {
  return document.querySelector(dom.COMMENTS_SECTION_SELECTOR);
}

export function readVideoMeta(): VideoMeta {
  const url = new URL(location.href);
  return {
    videoId: url.searchParams.get('v'),
    title: dom.videoTitleText(),
    channel: dom.channelNameText(),
  };
}

function readThread(thread: Element): RawCommentFields | null {
  const comment = dom.commentRoot(thread);
  if (!comment) return null;

  return {
    author: dom.authorName(comment),
    authorUrl: dom.authorUrl(comment),
    text: dom.commentText(comment),
    likeCountText: dom.likeCountText(comment),
    replyCountText: dom.replyCountText(thread),
    publishedText: dom.publishedText(comment),
    pinned: dom.isPinned(thread),
    hearted: dom.isHearted(comment),
  };
}

export interface ScanResult {
  comments: Comment[];
  commentsDisabled: boolean;
  declaredTotalText: string | null;
}

/**
 * Reads whatever is currently mounted — never fetches, never waits (PRD §5:
 * this is a mirror, not a crawler). A thread that yields no readable author
 * and no readable text at all (an ad slot, a malformed node) is skipped
 * rather than shown as an empty row; every other field degrades individually.
 */
export function scanAll(now = Date.now()): ScanResult {
  const section = findCommentsSection();
  if (!section) return { comments: [], commentsDisabled: false, declaredTotalText: null };

  const threads = Array.from(section.querySelectorAll(dom.THREAD_SELECTOR));
  const comments: Comment[] = [];

  threads.forEach((thread, index) => {
    const fields = readThread(thread);
    if (!fields) return;
    if (!fields.author && !fields.text) return;
    comments.push(buildComment(fields, index, now));
  });

  return {
    comments,
    commentsDisabled: comments.length === 0 && dom.commentsDisabled(section),
    declaredTotalText: dom.declaredTotalText(section),
  };
}

/**
 * Scrolls the native comment section toward its own end so YouTube's own
 * lazy-load fires — exactly what a manual scroll does, nothing more (PRD §4:
 * "load more" is a trigger for YouTube's own loading, never a fetch of our own).
 */
export function triggerLoadMore(): boolean {
  const section = findCommentsSection();
  if (!section) return false;
  section.scrollIntoView({ block: 'end', behavior: 'auto' });
  window.scrollBy({ top: window.innerHeight, behavior: 'auto' });
  return true;
}

export function scrollToComment(id: string): boolean {
  const section = findCommentsSection();
  if (!section) return false;
  const threads = Array.from(section.querySelectorAll(dom.THREAD_SELECTOR));
  for (let index = 0; index < threads.length; index += 1) {
    const fields = readThread(threads[index]);
    if (!fields) continue;
    const comment = buildComment(fields, index);
    if (comment.id === id) {
      threads[index].scrollIntoView({ block: 'center', behavior: 'smooth' });
      return true;
    }
  }
  return false;
}
