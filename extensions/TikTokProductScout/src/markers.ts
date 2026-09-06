/**
 * Commercial-marker detection. PRD §4: "Commercial markers are heuristics.
 * Shop links are reliable; caption patterns are not. Label the difference in
 * the badge and never present a heuristic as a fact." That distinction is the
 * whole point of this file — `confidence` travels with every marker so the UI
 * can never collapse the two into one claim.
 *
 * DOM-verified markers (an actual TikTok Shop link/tag in the tile) are built
 * by scan.ts and passed in here alongside the caption; this file only ever
 * *adds* heuristic markers from text, and never invents a 'verified' one.
 */

import { Marker } from './types';

interface CaptionPattern {
  test: RegExp;
  type: Marker['type'];
  label: string;
}

// Ordered roughly by how much they imply an actual sale is happening.
const CAPTION_PATTERNS: CaptionPattern[] = [
  { test: /#tiktokshop\b/i, type: 'shop_language', label: '#TikTokShop' },
  { test: /#tiktokmademebuyit\b/i, type: 'shop_language', label: '#TikTokMadeMeBuyIt' },
  { test: /link in (my )?bio/i, type: 'bio_link', label: 'Link in bio' },
  { test: /\bshop\s?(now|my|link|this)\b/i, type: 'shop_language', label: 'Shop language' },
  { test: /\b(use\s+)?code\s*[:\-]?\s*[A-Z0-9]{3,15}\b/, type: 'discount_code', label: 'Discount code' },
  { test: /\b\d{1,2}\s?%\s?off\b/i, type: 'discount_code', label: '% off' },
  { test: /\bdiscount\b/i, type: 'discount_code', label: 'Discount mentioned' },
  { test: /\baffiliate\b/i, type: 'bio_link', label: 'Affiliate mention' },
];

/** Heuristic markers found in a caption. Never marked 'verified'. */
export function detectCaptionMarkers(caption: string): Marker[] {
  if (!caption) return [];
  const found: Marker[] = [];
  const seen = new Set<Marker['type']>();
  for (const pattern of CAPTION_PATTERNS) {
    if (!pattern.test.test(caption)) continue;
    if (seen.has(pattern.type)) continue; // one marker per type is enough signal
    seen.add(pattern.type);
    found.push({ type: pattern.type, confidence: 'heuristic', label: pattern.label });
  }
  return found;
}

/** Merges scan.ts's DOM-verified markers with caption heuristics, verified first. */
export function combineMarkers(domVerified: Marker[], caption: string): Marker[] {
  return [...domVerified, ...detectCaptionMarkers(caption)];
}

export function hasCommercialMarker(markers: Marker[]): boolean {
  return markers.length > 0;
}

export function hasVerifiedMarker(markers: Marker[]): boolean {
  return markers.some(m => m.confidence === 'verified');
}

/** The compact badge fragment: "🛒 shop link" for a verified marker, "🛒 possible link" for a heuristic-only one. */
export function markerBadgeLabel(markers: Marker[]): string | null {
  if (!markers.length) return null;
  return hasVerifiedMarker(markers) ? '🛒 shop link' : '🛒 possible link';
}

/** A stable key used to auto-group future videos with the same shop item / caption keyword. */
export function groupKeyFor(markers: Marker[]): string | null {
  const verified = markers.find(m => m.confidence === 'verified');
  if (verified) return `shop:${verified.label.toLowerCase()}`;
  const heuristic = markers[0];
  return heuristic ? `caption:${heuristic.type}` : null;
}
