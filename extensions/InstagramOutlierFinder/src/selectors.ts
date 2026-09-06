/**
 * Every assumption about Instagram's DOM lives in this file and nowhere
 * else. Instagram rewrites its markup on a schedule the PRD calls out by
 * name (§7, §9) — when that happens, this is the only module that needs
 * touching, and every lookup here returns null/[] rather than throwing, so a
 * changed selector degrades one field instead of taking the grid down.
 *
 * Not verified against a live, logged-in Instagram session — built from the
 * publicly documented shape of the profile grid (permalink anchors wrapping
 * each tile, a hover overlay carrying like/comment counts, a play-count
 * chip on Reels, hydration JSON in nearby <script> tags). Re-validate the
 * selectors below against a real profile before shipping; content.ts's
 * quiet-notice + parse-failure counter exist precisely for the day this
 * drifts.
 */

import { PostKind } from './types';

const PERMALINK_RE = /\/(p|reel|tv)\/([A-Za-z0-9_-]{5,})\/?/;

/** Paths that are never a profile grid, however much they look like one. */
const RESERVED_ROOTS = new Set([
  'explore',
  'reels',
  'direct',
  'accounts',
  'stories',
  'p',
  'reel',
  'tv',
  'about',
  'legal',
  'developer',
]);

export function isProfilePath(pathname: string): boolean {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 0) return false;
  if (RESERVED_ROOTS.has(segments[0].toLowerCase())) return false;
  // A profile URL is exactly /<handle>/ or /<handle>/tagged/ etc — never a
  // deeper permalink, which this pattern would also otherwise match.
  return segments.length === 1 || (segments.length === 2 && segments[1] !== 'p' && segments[1] !== 'reel');
}

export function profileHandle(pathname: string): string | null {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 0 || RESERVED_ROOTS.has(segments[0].toLowerCase())) return null;
  return segments[0];
}

/** The grid's root — where the header strip and filter row are inserted above. */
export function gridContainer(): HTMLElement | null {
  return (
    document.querySelector<HTMLElement>('main article') ??
    document.querySelector<HTMLElement>('main [role="tabpanel"]') ??
    document.querySelector<HTMLElement>('main')
  );
}

/** One entry per grid tile: the permalink anchor that wraps it. */
export function tileAnchors(): HTMLAnchorElement[] {
  const container = gridContainer() ?? document;
  const anchors = Array.from(container.querySelectorAll<HTMLAnchorElement>('a[href]'));
  const seen = new Set<string>();
  const tiles: HTMLAnchorElement[] = [];

  for (const anchor of anchors) {
    const href = anchor.getAttribute('href');
    if (!href || !PERMALINK_RE.test(href)) continue;
    const shortcode = extractShortcode(href);
    if (!shortcode || seen.has(shortcode)) continue;
    seen.add(shortcode);
    tiles.push(anchor);
  }

  return tiles;
}

export function extractShortcode(href: string | null | undefined): string | null {
  if (!href) return null;
  const match = href.match(PERMALINK_RE);
  return match ? match[2] : null;
}

export function kindFromTile(tile: HTMLAnchorElement, href: string): PostKind {
  if (href.includes('/reel/')) return 'reel';
  const svgs = Array.from(tile.querySelectorAll<SVGElement>('svg[aria-label]'));
  if (svgs.some(svg => /carousel|album|slides/i.test(svg.getAttribute('aria-label') ?? ''))) return 'carousel';
  if (svgs.some(svg => /reel|clip|video/i.test(svg.getAttribute('aria-label') ?? ''))) return 'reel';
  return 'post';
}

export function isPinnedTile(tile: HTMLAnchorElement): boolean {
  const svgs = Array.from(tile.querySelectorAll<SVGElement>('svg[aria-label]'));
  if (svgs.some(svg => /pin/i.test(svg.getAttribute('aria-label') ?? ''))) return true;
  return /pinned/i.test(tile.getAttribute('aria-label') ?? '');
}

/** Text near a play/reel icon — the visible view/plays count Instagram shows on Reel tiles. */
export function viewsTextFromTile(tile: HTMLAnchorElement): string | null {
  return textNearIcon(tile, /play|clip|reel|view/i);
}

/** Text near a heart icon — Instagram's hover overlay, present in the DOM whether or not it's visually hovered. */
export function likesTextFromTile(tile: HTMLAnchorElement): string | null {
  return textNearIcon(tile, /like/i);
}

/** Text near a speech-bubble icon in the same overlay. */
export function commentsTextFromTile(tile: HTMLAnchorElement): string | null {
  return textNearIcon(tile, /comment/i);
}

function textNearIcon(tile: HTMLAnchorElement, labelPattern: RegExp): string | null {
  const svgs = Array.from(tile.querySelectorAll<SVGElement>('svg[aria-label]'));
  for (const svg of svgs) {
    const label = svg.getAttribute('aria-label') ?? '';
    if (!labelPattern.test(label)) continue;

    // The count usually sits as a sibling span next to the icon, or as the
    // next text-bearing element within the icon's immediate container.
    const container = svg.parentElement;
    const candidate =
      container?.querySelector('span') ??
      (svg.nextElementSibling as HTMLElement | null) ??
      container?.nextElementSibling;
    const text = candidate?.textContent?.trim();
    if (text && /\d/.test(text)) return text;
  }
  return null;
}

/** Every <script> body on the page that might carry hydration JSON, bounded and pre-filtered for cheapness. */
export function candidateScriptTexts(): string[] {
  const scripts = Array.from(document.querySelectorAll('script'));
  const texts: string[] = [];
  for (const script of scripts) {
    const text = script.textContent;
    if (!text || text.length < 40 || text.length > 4_000_000) continue;
    if (!text.includes('shortcode') && !text.includes('"code"')) continue;
    texts.push(text);
  }
  return texts;
}
