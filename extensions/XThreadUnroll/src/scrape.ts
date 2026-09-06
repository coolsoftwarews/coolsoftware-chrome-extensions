/**
 * The DOM half: finding tweets on the page, deciding which ones are the
 * start of a same-author reply chain (PRD-25 §4/§5), and reading whatever
 * X has rendered for each post in that chain. Ported from
 * XConversationSaver's scrape.ts (PRD-13) — same `data-testid` heuristics,
 * same "every field is optional, nothing throws" posture — with the chain
 * walk extended to handle interleaved foreign replies and mid-thread
 * deleted-post placeholders (PRD-25 §7), which XConversationSaver's
 * "one thread, don't worry about other authors resuming" scope didn't need.
 *
 * DOM-bound code is not unit-tested; it is covered by the manual checklist
 * in README.md, the same split every DOM-reading extension in this
 * portfolio uses.
 */

import { canonicalStatusUrl, cleanText, mediaLabel, normalizeHandle, parseStatusId } from './parse';
import { UnrolledPost } from './types';

export const TWEET_SELECTOR = 'article[data-testid="tweet"]';

/** X's own boundary between a conversation and its algorithmic suggestions. */
const BOUNDARY_TEXT = /more (tweets|posts)|discover more|you might like/i;
const SHOW_MORE_TEXT = /show (more|additional) (repl(y|ies))/i;
/** The placeholder X renders where a post used to be. */
const DELETED_TEXT = /this (tweet|post) (is unavailable|was deleted|has been deleted)/i;

function text(el: Element | null | undefined): string {
  return (el?.textContent ?? '').trim();
}

function readAuthor(root: ParentNode): { author: string; handle: string } {
  const nameBlock = root.querySelector('[data-testid="User-Name"]');
  if (!nameBlock) return { author: '', handle: '' };

  const link = nameBlock.querySelector<HTMLAnchorElement>('a[role="link"][href^="/"]');
  const href = link?.getAttribute('href') ?? '';
  const handle = normalizeHandle(href.replace(/^\//, '').split(/[/?#]/)[0] ?? '');

  const spans = Array.from(nameBlock.querySelectorAll('span'))
    .map(span => text(span))
    .filter(Boolean);
  const author = spans.find(s => !s.startsWith('@')) ?? spans[0] ?? '';

  return { author, handle };
}

function readAvatar(root: ParentNode): string {
  const img =
    root.querySelector<HTMLImageElement>('[data-testid^="UserAvatar-Container"] img') ??
    root.querySelector<HTMLImageElement>('[data-testid="Tweet-User-Avatar"] img');
  return img?.src ?? '';
}

function readPermalink(root: ParentNode, handle: string): { id: string | null; url: string } {
  const timeEl = root.querySelector('time');
  const link = timeEl?.closest('a');
  const href = link?.getAttribute('href') ?? '';
  const id = parseStatusId(href);
  if (!id) return { id: null, url: '' };
  return { id, url: handle ? canonicalStatusUrl(handle, id) : new URL(href, 'https://x.com').toString() };
}

function readQuoted(root: ParentNode, mainTextEl: Element | null): UnrolledPost['quoted'] {
  const nameBlocks = Array.from(root.querySelectorAll('[data-testid="User-Name"]'));
  const textBlocks = Array.from(root.querySelectorAll('[data-testid="tweetText"]')).filter(el => el !== mainTextEl);
  if (nameBlocks.length < 2 || !textBlocks.length) return null;

  const quotedNameBlock = nameBlocks[nameBlocks.length - 1];
  const { author, handle } = readAuthor(quotedNameBlock.parentElement ?? quotedNameBlock);
  const quotedText = cleanText(text(textBlocks[textBlocks.length - 1]));
  if (!handle && !quotedText) return null;
  return { author, handle, text: quotedText };
}

function readMedia(root: ParentNode): UnrolledPost['media'] {
  const photos = root.querySelectorAll('[data-testid="tweetPhoto"]');
  const videos = root.querySelectorAll('[data-testid="videoPlayer"], [data-testid="videoComponent"]');
  const count = photos.length + videos.length;
  const img = root.querySelector<HTMLImageElement>('[data-testid="tweetPhoto"] img');
  const video = root.querySelector<HTMLVideoElement>('video');
  return {
    count,
    label: mediaLabel(count, videos.length > 0),
    thumbnailUrl: img?.src ?? video?.poster ?? '',
  };
}

/** Reads one tweet `<article>` into a reading-view post. Never throws — a
 *  post that fails to parse is skipped by the caller, not the whole unroll. */
export function extractPost(article: Element): UnrolledPost | null {
  try {
    const { author, handle } = readAuthor(article);
    const { id, url } = readPermalink(article, handle);
    if (!id) return null;

    const textEl = article.querySelector('[data-testid="tweetText"]');

    return {
      id,
      author,
      handle,
      avatarUrl: readAvatar(article),
      text: cleanText(text(textEl)),
      postDate: article.querySelector('time')?.getAttribute('datetime') ?? '',
      url,
      media: readMedia(article),
      quoted: readQuoted(article, textEl),
      deleted: false,
    };
  } catch {
    return null;
  }
}

const DELETED_PLACEHOLDER: UnrolledPost = {
  id: '',
  author: '',
  handle: '',
  avatarUrl: '',
  text: '',
  postDate: '',
  url: '',
  media: { count: 0, label: '', thumbnailUrl: '' },
  quoted: null,
  deleted: true,
};

/** Every tweet article currently rendered on the page, in document order. */
export function findTweetArticles(root: ParentNode = document): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(TWEET_SELECTOR));
}

/** Text of whatever X rendered directly between two tweet articles (not
 *  inside either one) — where boundary/"show more"/deleted markers live. */
function betweenText(from: Element, to: Element | null): string {
  let node: Element | null = from.nextElementSibling ?? from.parentElement?.nextElementSibling ?? null;
  let out = '';
  let guard = 0;
  while (node && node !== to && guard < 20) {
    if (node.matches(TWEET_SELECTOR)) break;
    out += ' ' + text(node);
    node = node.nextElementSibling;
    guard++;
  }
  return out;
}

export interface ChainResult {
  /** Ordered, same-author posts plus deleted-gap placeholders. Foreign
   *  (other-author) replies interleaved between them are never included
   *  (PRD-25 §7). */
  items: UnrolledPost[];
  truncated: boolean;
  cappedAt200: boolean;
  /** True once X's own "More Tweets"/"Discover more" boundary was reached —
   *  a reliable "nothing more to gain from scrolling" signal. */
  boundaryHit: boolean;
}

const EMPTY_CHAIN: ChainResult = { items: [], truncated: false, cappedAt200: false, boundaryHit: false };

/**
 * Walks forward from `origin` through whatever tweets are currently
 * rendered, collecting every post by the same author, in order — skipping
 * over (never absorbing) replies from other accounts that X interleaves
 * into the same DOM run (PRD-25 §7), and inserting a placeholder wherever a
 * "this post is unavailable" gap appears mid-thread. Stops at X's own
 * "More Tweets" boundary, or after `maxPosts` same-author posts (a 200-post
 * safety valve — PRD-25 §7's "very long threads" case).
 *
 * Recomputed from scratch on every call rather than incrementally updated —
 * simpler and correct by construction as auto-scroll grows the DOM, at the
 * cost of re-walking already-seen nodes; cheap in practice since X only
 * ever mounts a few dozen articles at once (virtualization).
 */
export function gatherChain(origin: Element, rootHandle: string, maxPosts = 200): ChainResult {
  const all = findTweetArticles(document);
  const startIndex = all.indexOf(origin as HTMLElement);
  if (startIndex === -1) return EMPTY_CHAIN;

  const normalizedRoot = normalizeHandle(rootHandle);
  const items: UnrolledPost[] = [];
  let truncated = false;
  let cappedAt200 = false;
  let boundaryHit = false;
  let deletedPending = false;
  let lastKept: Element = origin;
  // Bounds total scan work independent of how many foreign replies are
  // interleaved, so a busy reply section can't make this unbounded.
  const scanBudget = Math.max(40, maxPosts * 4);
  let scanned = 0;

  for (let i = startIndex; i < all.length && scanned < scanBudget; i++, scanned++) {
    const candidate = all[i];
    const between = i === startIndex ? '' : betweenText(lastKept, candidate);

    if (BOUNDARY_TEXT.test(between)) {
      boundaryHit = true;
      break;
    }
    if (SHOW_MORE_TEXT.test(between)) truncated = true;
    if (DELETED_TEXT.test(between)) deletedPending = true;

    const { handle } = readAuthor(candidate);
    if (i > startIndex && normalizeHandle(handle) !== normalizedRoot) {
      // A different author's reply interleaved mid-chain — skip it, keep
      // scanning; the same author may resume later in the DOM.
      lastKept = candidate;
      continue;
    }

    if (deletedPending) {
      items.push(DELETED_PLACEHOLDER);
      deletedPending = false;
    }

    const post = extractPost(candidate);
    if (post) items.push(post);
    lastKept = candidate;

    if (items.filter(p => !p.deleted).length >= maxPosts) {
      cappedAt200 = true;
      break;
    }
  }

  if (!boundaryHit && !cappedAt200 && items.length) {
    const after = betweenText(lastKept, null);
    if (SHOW_MORE_TEXT.test(after)) truncated = true;
  }

  return { items, truncated, cappedAt200, boundaryHit };
}

/**
 * Cheap badge-eligibility check for whatever's currently rendered — a
 * bounded lookahead (not the full 200-post walk) so scanning every visible
 * tweet on every DOM mutation stays fast. An article is a thread *root*
 * only if it is not itself an immediate same-author continuation of the
 * previous article (so only the first post of a chain gets the control).
 */
export function isThreadRoot(articles: HTMLElement[], index: number): boolean {
  const article = articles[index];
  const { handle } = readAuthor(article);
  if (!handle) return false;

  const previous = articles[index - 1];
  if (previous) {
    const between = betweenText(previous, article);
    if (!BOUNDARY_TEXT.test(between)) {
      const { handle: prevHandle } = readAuthor(previous);
      if (normalizeHandle(prevHandle) === normalizeHandle(handle)) return false; // an interior post, not a root
    }
  }

  const chain = gatherChain(article, handle, 2);
  return chain.items.filter(p => !p.deleted).length >= 2;
}
