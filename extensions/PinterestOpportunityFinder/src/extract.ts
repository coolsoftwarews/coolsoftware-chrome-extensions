/**
 * DOM extraction — the one part of this extension that cannot be unit tested
 * headlessly (no DOM in Node), so it is covered by the manual checklist in
 * README.md instead of scripts/selftest.mjs, same split as WebHighlighter's
 * anchor.ts vs quote.ts.
 *
 * Pinterest's internal component names and class hashes change often; the
 * one thing that has stayed stable for years is the `/pin/<id>/` URL shape,
 * so extraction anchors on that rather than any CSS class. Every per-card
 * step is wrapped so one malformed card degrades that one card to "no data"
 * instead of aborting the whole scan (PRD §7: "DOM changes failing quietly").
 */

import { PinCard } from './types';

const PIN_HREF_RE = /\/pin\/(\d+)/;
const PROMOTED_RE = /\bpromoted\b/i;
const IDEA_PIN_RE = /\bidea pins?\b/i;
const DOMAIN_RE = /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}\b/i;
const SAVE_RE = /([\d][\d,.]*)\s*([kKmM]?)\s*(?:saves?|reactions?|people saved|enregistrements?)/i;

function parseCompactNumber(digits: string, suffix: string): number | null {
  const n = Number(digits.replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  const mult = suffix.toLowerCase() === 'k' ? 1_000 : suffix.toLowerCase() === 'm' ? 1_000_000 : 1;
  return Math.round(n * mult);
}

function parseSaveCount(container: Element): number | null {
  // aria-labels are the more reliable source ("142 people saved this Pin");
  // scan them before falling back to visible text, which is more likely to
  // pick up an unrelated number on the card.
  const labelled = Array.from(container.querySelectorAll<HTMLElement>('[aria-label]'))
    .map(el => el.getAttribute('aria-label') || '')
    .concat(container.getAttribute?.('aria-label') || '');

  for (const label of labelled) {
    const match = label.match(SAVE_RE);
    if (match) {
      const count = parseCompactNumber(match[1], match[2]);
      if (count != null) return count;
    }
  }

  const text = container.textContent || '';
  const match = text.match(SAVE_RE);
  if (match) return parseCompactNumber(match[1], match[2]);
  return null;
}

function extractDomain(container: Element, imgEl: Element | null): string | null {
  for (const el of Array.from(container.querySelectorAll('span, div, a, p'))) {
    if (imgEl && (el === imgEl || el.contains(imgEl))) continue;
    const text = (el.textContent || '').trim();
    if (!text || text.length > 60 || text.includes(' ')) continue;
    const match = text.match(DOMAIN_RE);
    if (match && !/pinterest\./i.test(match[0]) && !/pinimg\.com/i.test(match[0])) {
      return match[0].toLowerCase();
    }
  }
  return null;
}

/** i.pinimg.com URLs carry the rendered size in the path (e.g. `/564x/`); strip it so the same source image is recognised across sizes for repin grouping (PRD §7). */
export function normalizeImageUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const match = raw.match(/pinimg\.com\/(?:originals|\d+x\d*|\d+x)\/(.+)$/i);
  if (match) return match[1].split('?')[0];
  return raw.split('?')[0];
}

function extractText(container: Element, img: HTMLImageElement | null): { title: string; description: string } {
  const heading = container.querySelector('[role="heading"], h1, h2, h3');
  const title = (heading?.textContent || img?.alt || '').trim().slice(0, 300);

  let description = '';
  for (const el of Array.from(container.querySelectorAll('div, span, p'))) {
    const text = (el.textContent || '').trim();
    if (text && text !== title && text.length > 12 && text.length < 400 && el.querySelector('img,svg') == null) {
      description = text.slice(0, 400);
      break;
    }
  }
  return { title, description };
}

/** Best-effort only (PRD §4: "where detectable") — real detection needs OCR this extension deliberately doesn't ship. null means "not detected", never a guessed false. */
function detectTextOverlay(img: HTMLImageElement | null, width: number | null, height: number | null): boolean | null {
  if (!img) return null;
  const alt = (img.alt || '').trim();
  if (!alt) return null;
  const hasShoutyPunctuation = /[!?]/.test(alt) || /\b[A-Z]{3,}\b/.test(alt);
  const wordCount = alt.split(/\s+/).length;
  if (alt.length >= 40 && (hasShoutyPunctuation || wordCount >= 6)) return true;
  if (alt.length < 12) return false;
  return null;
}

function resolveContainer(anchor: HTMLAnchorElement): Element {
  let node: Element = anchor;
  for (let depth = 0; depth < 8; depth++) {
    const parent = node.parentElement;
    if (!parent) break;
    if (parent.getAttribute('role') === 'listitem') return parent;
    node = parent;
  }
  // No role="listitem" ancestor found (markup drift) — fall back to three
  // levels up from the anchor, a reasonable "one card" boundary in practice.
  let fallback: Element = anchor;
  for (let i = 0; i < 3 && fallback.parentElement; i++) fallback = fallback.parentElement;
  return fallback;
}

function idFromHref(href: string): string | null {
  const match = href.match(PIN_HREF_RE);
  return match ? match[1] : null;
}

export interface ScanResult {
  pins: PinCard[];
  /** Container element for each pin id — used by content.ts to paint badges without a second DOM pass. */
  elements: Map<string, Element>;
}

export function scanPins(root: ParentNode = document): ScanResult {
  const anchors = Array.from(root.querySelectorAll<HTMLAnchorElement>('a[href*="/pin/"]'));
  const visited = new Set<Element>();
  const pins: PinCard[] = [];
  const elements = new Map<string, Element>();
  let rank = 0;

  for (const anchor of anchors) {
    try {
      const id = idFromHref(anchor.getAttribute('href') || '');
      if (!id) continue;

      const container = resolveContainer(anchor);
      if (visited.has(container)) continue;
      visited.add(container);

      const img = container.querySelector('img');
      const { title, description } = extractText(container, img);
      const cardText = container.textContent || '';

      const width = img?.naturalWidth || Number(img?.getAttribute('width')) || null;
      const height = img?.naturalHeight || Number(img?.getAttribute('height')) || null;

      const pin: PinCard = {
        id,
        rank: rank++,
        title,
        description,
        domain: extractDomain(container, img),
        saveCount: parseSaveCount(container),
        isPromoted: PROMOTED_RE.test(cardText) || PROMOTED_RE.test(container.getAttribute('aria-label') || ''),
        isIdeaPin: IDEA_PIN_RE.test(cardText) || IDEA_PIN_RE.test(container.getAttribute('aria-label') || ''),
        imageWidth: width || null,
        imageHeight: height || null,
        hasTextOverlay: detectTextOverlay(img, width || null, height || null),
        imageUrl: normalizeImageUrl(img?.currentSrc || img?.src || null),
        pinUrl: new URL(anchor.getAttribute('href') || `/pin/${id}/`, location.origin).toString(),
      };

      pins.push(pin);
      elements.set(id, container);
    } catch {
      // One malformed card must never take down the scan (PRD §7).
      continue;
    }
  }

  return { pins, elements };
}

/** Pins only, for callers that don't need to paint anything on the page. */
export function extractPins(root: ParentNode = document): PinCard[] {
  return scanPins(root).pins;
}
