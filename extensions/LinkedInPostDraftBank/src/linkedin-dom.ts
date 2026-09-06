/**
 * The DOM-bound half: finding LinkedIn's post composer, the signed-in user's
 * own profile, and their own published posts on their own activity page.
 * Nothing here is pure enough to unit test — it needs a real page — so it is
 * exercised by hand against LinkedIn (see README "Manual test checklist"),
 * same split as WebHighlighter's src/anchor.ts and LinkedInLeadFinder's
 * src/linkedin-dom.ts.
 *
 * Every selector list has fallbacks because LinkedIn's class names are
 * unstable and were not verified against a live page in this build
 * environment (no network access to linkedin.com) — see README's manual
 * pre-ship checklist, same honesty posture as this portfolio's other
 * LinkedIn/Reddit builds.
 *
 * SAFETY: findComposerEditor/insertTemplateText are the *only* place in this
 * codebase that ever writes into LinkedIn's own page, and only ever inserts
 * text the user explicitly chose to reuse into a composer *they* opened —
 * never anything auto-generated, never a submit/click on their behalf.
 */

import { cleanComposerText, cleanText } from './text';

function firstMatch<T extends Element>(root: ParentNode, selectors: string[]): T | null {
  for (const selector of selectors) {
    try {
      const el = root.querySelector<T>(selector);
      if (el) return el;
    } catch {
      /* an invalid selector on an old LinkedIn build should not break the rest */
    }
  }
  return null;
}

function allMatches<T extends Element>(root: ParentNode, selectors: string[]): T[] {
  for (const selector of selectors) {
    try {
      const found = Array.from(root.querySelectorAll<T>(selector));
      if (found.length) return found;
    } catch {
      /* ignore and try the next fallback */
    }
  }
  return [];
}

function isVisible(el: HTMLElement): boolean {
  return el.offsetParent !== null || el.getClientRects().length > 0;
}

/* ── Composer ────────────────────────────────────────────────────────── */

const EDITOR_SELECTORS = ['.ql-editor[contenteditable="true"]', 'div[role="textbox"][contenteditable="true"]'];

/**
 * A contenteditable box that isn't the post composer (a comment box, a
 * message thread) must never get the truncation overlay — a wrong guess here
 * is worse than showing nothing. Uses the editor's own accessible label
 * first, falling back to a nearby dialog heading.
 */
function looksLikePostComposer(el: HTMLElement): boolean {
  const label = (
    el.getAttribute('aria-label') ||
    el.getAttribute('aria-placeholder') ||
    el.getAttribute('data-placeholder') ||
    ''
  ).toLowerCase();
  if (label.includes('comment') || label.includes('message') || label.includes('reply')) return false;
  if (label.includes('post') || label.includes('share') || label.includes('write an article')) return true;

  const dialog = el.closest('div[role="dialog"]');
  const heading = cleanText(dialog?.querySelector('h2, [id*="header" i]')?.textContent).toLowerCase();
  if (heading.includes('comment') || heading.includes('message')) return false;
  return heading.includes('post');
}

export function findComposerEditor(root: ParentNode = document): HTMLElement | null {
  for (const selector of EDITOR_SELECTORS) {
    let candidates: HTMLElement[];
    try {
      candidates = Array.from(root.querySelectorAll<HTMLElement>(selector));
    } catch {
      continue;
    }
    const match = candidates.find(el => isVisible(el) && looksLikePostComposer(el));
    if (match) return match;
  }
  return null;
}

export function readComposerText(editor: HTMLElement): string {
  return cleanComposerText(editor.innerText || editor.textContent);
}

const MEDIA_HINT_SELECTORS = [
  '[class*="share-images" i]',
  '[class*="share-native-document" i]',
  '[class*="share-poll" i]',
  '[class*="video-upload" i]',
  'button[aria-label*="remove" i]',
];

/**
 * Whether the open composer already has an image, document or poll attached
 * — those change the real truncation math (PRD §7), so the overlay should
 * flag reduced confidence rather than silently showing a text-only estimate.
 */
export function composerHasMedia(editor: HTMLElement): boolean {
  const container =
    editor.closest<HTMLElement>('div[role="dialog"]') ?? editor.closest<HTMLElement>('form') ?? document.body;
  return MEDIA_HINT_SELECTORS.some(selector => {
    try {
      return Boolean(container.querySelector(selector));
    } catch {
      return false;
    }
  });
}

/**
 * Replaces the composer's current content with `text`. Uses execCommand,
 * which every rich-text editor framework (including LinkedIn's Quill-based
 * one) listens to via native input events — no framework-specific API needed.
 * Falls back to a direct textContent write + a synthetic input event for the
 * rare case execCommand is unavailable.
 */
export function insertTemplateText(editor: HTMLElement, text: string): void {
  editor.focus();
  const selection = window.getSelection();
  if (selection) {
    const range = document.createRange();
    range.selectNodeContents(editor);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  const inserted = document.execCommand && document.execCommand('insertText', false, text);
  if (!inserted) {
    editor.textContent = text;
    editor.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
  }
}

/* ── The signed-in user's own profile ───────────────────────────────── */

const ME_LINK_SELECTORS = [
  'a.global-nav__me-photo',
  '.global-nav__me a[href*="/in/"]',
  'nav[aria-label="Primary Navigation" i] a[href*="/in/"]',
];

export function normalizeProfileUrl(href: string | null | undefined): string | null {
  if (!href) return null;
  try {
    const url = new URL(href, 'https://www.linkedin.com');
    const path = url.pathname.toLowerCase().replace(/\/+$/, '');
    if (!path.startsWith('/in/')) return null;
    return `https://www.linkedin.com${path}`;
  } catch {
    return null;
  }
}

export function findOwnProfileUrl(root: ParentNode = document): string | null {
  for (const selector of ME_LINK_SELECTORS) {
    let el: HTMLAnchorElement | null;
    try {
      el = root.querySelector<HTMLAnchorElement>(selector);
    } catch {
      continue;
    }
    const normalized = normalizeProfileUrl(el?.getAttribute('href'));
    if (normalized) return normalized;
  }
  return null;
}

/**
 * True only when the current tab is the signed-in user's *own* activity feed
 * (PRD §4: "captured from their own profile's activity feed only — never
 * other users' posts"). Comparing the URL's vanity segment against the nav
 * "Me" link is the guard against ever archiving someone else's posts.
 */
export function isOwnActivityPage(): boolean {
  const match = location.pathname.match(/^\/in\/([^/]+)\/recent-activity/i);
  if (!match) return false;
  const own = findOwnProfileUrl();
  if (!own) return false;
  const ownVanity = own.split('/in/')[1];
  return Boolean(ownVanity) && ownVanity === match[1].toLowerCase();
}

/* ── Own published posts ────────────────────────────────────────────── */

const POST_SELECTORS = ['div.feed-shared-update-v2[data-urn]', 'div[data-urn].occludable-update'];
const POST_TEXT_SELECTORS = ['.update-components-text', '.feed-shared-update-v2__description'];
const POST_DATE_SELECTORS = ['.update-components-actor__sub-description time', 'time'];

export function findPosts(root: ParentNode = document): HTMLElement[] {
  return allMatches<HTMLElement>(root, POST_SELECTORS);
}

export interface ExtractedPost {
  postUrn: string;
  postUrl: string;
  text: string;
  publishedAtLabel: string;
}

export function extractPost(post: HTMLElement): ExtractedPost | null {
  const urn = post.getAttribute('data-urn') || post.getAttribute('data-id');
  if (!urn) return null;

  const textEl = firstMatch<HTMLElement>(post, POST_TEXT_SELECTORS);
  const dateEl = firstMatch<HTMLElement>(post, POST_DATE_SELECTORS);

  return {
    postUrn: urn,
    postUrl: `https://www.linkedin.com/feed/update/${encodeURIComponent(urn)}/`,
    text: cleanComposerText(textEl?.innerText || textEl?.textContent),
    publishedAtLabel: cleanText(dateEl?.getAttribute('datetime') || dateEl?.textContent),
  };
}
