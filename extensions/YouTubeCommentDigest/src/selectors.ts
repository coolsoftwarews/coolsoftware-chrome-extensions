/**
 * Every assumption about YouTube's comment DOM lives in this file and nowhere
 * else (same discipline as YouTubeProFilters' selectors.ts). When YouTube
 * changes the comment component — and PRD §5 is explicit that it has before
 * and will again — this is the only module that needs touching, and every
 * lookup returns null/false rather than throwing, so one changed selector
 * degrades one field instead of breaking a comment, a row, or the panel.
 *
 * NOT verified against a live page in this build (no network access to
 * youtube.com in this environment) — see README's "Required pre-ship spike".
 */

export const COMMENTS_SECTION_SELECTOR = 'ytd-comments#comments, ytd-comments';
export const THREAD_SELECTOR = 'ytd-comment-thread-renderer';

/** The top-level comment element inside one thread — tried in order. */
const COMMENT_ROOT_SELECTORS = ['ytd-comment-view-model#comment', 'ytd-comment-renderer#comment', '#comment'];

export function text(root: ParentNode, selector: string): string | null {
  try {
    const element = root.querySelector(selector);
    const value = element?.textContent?.trim();
    return value ? value : null;
  } catch {
    return null;
  }
}

export function attr(root: ParentNode, selector: string, name: string): string | null {
  try {
    return root.querySelector(selector)?.getAttribute(name) ?? null;
  } catch {
    return null;
  }
}

export function commentRoot(thread: Element): Element | null {
  for (const selector of COMMENT_ROOT_SELECTORS) {
    try {
      const found = thread.querySelector(selector);
      if (found) return found;
    } catch {
      /* try the next selector */
    }
  }
  return thread;
}

export function authorName(comment: Element): string | null {
  return text(comment, '#author-text span') ?? text(comment, '#author-text') ?? text(comment, 'a#author-text');
}

export function authorUrl(comment: Element): string | null {
  return attr(comment, '#author-text', 'href') ?? attr(comment, 'a#author-text', 'href');
}

export function commentText(comment: Element): string | null {
  return (
    text(comment, '#content-text') ??
    text(comment, 'yt-attributed-string#content-text') ??
    text(comment, '#content-text span')
  );
}

/**
 * Like count has no single stable home across YouTube's redesigns — try the
 * classic vote-count node first, then an aria-label on whatever the like
 * button currently is ("12 likes", "Like this comment along with 12 other
 * people" style labels both start with a leading number).
 */
export function likeCountText(comment: Element): string | null {
  const classic = text(comment, '#vote-count-middle') ?? text(comment, '#vote-count-left');
  if (classic) return classic;

  try {
    const likeButton = comment.querySelector('like-button-view-model, #like-button, button[aria-label*="like" i]');
    const label = likeButton?.getAttribute('aria-label');
    if (label && /\d/.test(label)) return label;
  } catch {
    /* fall through to null */
  }
  return null;
}

/** Reply-count text lives on the "N replies" toggle button under the thread, not the comment itself. */
export function replyCountText(thread: Element): string | null {
  try {
    const candidates = thread.querySelectorAll('#replies #more-text, #replies tp-yt-paper-button, #replies button');
    for (const node of Array.from(candidates)) {
      const value = node.textContent?.trim();
      if (value && /repl(y|ies)/i.test(value)) return value;
    }
  } catch {
    /* fall through */
  }
  return null;
}

export function publishedText(comment: Element): string | null {
  return (
    text(comment, '.published-time-text a') ??
    text(comment, '#header-author .published-time-text a') ??
    text(comment, 'yt-formatted-string.published-time-text a')
  );
}

export function isPinned(thread: Element): boolean {
  try {
    if (thread.querySelector('ytd-pinned-comment-badge-renderer')) return true;
    const label = thread.querySelector('#pinned-comment-badge, .pinned-comment-badge')?.textContent ?? '';
    return /pinned/i.test(label);
  } catch {
    return false;
  }
}

export function isHearted(comment: Element): boolean {
  try {
    if (comment.querySelector('[is-hearted]')) return true;
    const heart = comment.querySelector('#creator-heart, creator-heart-button');
    if (!heart) return false;
    if (heart.getAttribute('aria-pressed') === 'true') return true;
    const label = heart.getAttribute('aria-label') ?? heart.textContent ?? '';
    return /heart/i.test(label) && heart.classList.contains('is-hearted');
  } catch {
    return false;
  }
}

/** The "1,234 Comments" header text, when YouTube has rendered it. */
export function declaredTotalText(section: Element): string | null {
  return (
    text(section, '#count .count-text') ??
    text(section, 'ytd-comments-header-renderer #count') ??
    text(section, '#leading-section #count')
  );
}

/** True when YouTube has replaced the comment list with its own "turned off" message. */
export function commentsDisabled(section: Element): boolean {
  const message = section.textContent ?? '';
  return /comments (are|is)\s+(turned off|disabled)/i.test(message);
}

export function videoTitleText(): string | null {
  return (
    text(document, 'ytd-watch-metadata h1 yt-formatted-string') ??
    text(document, '#title h1') ??
    (document.title ? document.title.replace(/\s*-\s*YouTube\s*$/, '') : null)
  );
}

export function channelNameText(): string | null {
  return (
    text(document, 'ytd-channel-name #text') ??
    text(document, '#owner #channel-name') ??
    text(document, 'ytd-video-owner-renderer ytd-channel-name')
  );
}
