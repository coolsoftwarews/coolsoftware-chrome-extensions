/**
 * Turns a raw scrape (whatever content.ts could read off the page) into a
 * capture card, plus the search/group logic the panel needs. Deliberately
 * pure — no DOM, no chrome.* — so scripts/selftest.mjs can check it
 * headlessly. The DOM-bound half that produces a RawCapture lives in
 * content.ts and needs a real browser, same split as WebHighlighter's
 * quote.ts / anchor.ts and InstagramResearchSaver's capture.ts / scrape.ts.
 */

import { Collection, DEFAULT_COLLECTIONS, DomainGroup, PinCapture, RawCapture } from './types';

const MAX_TITLE_STORE_LENGTH = 300;
const MAX_DESCRIPTION_STORE_LENGTH = 3000;

/**
 * Pinterest pin URLs look like `/pin/1234567890123456789/` or
 * `/pin/some-descriptive-slug--1234567890123456789/`. The trailing digit run
 * is the stable id; falling back to the raw string keeps idea pins and any
 * URL shape we didn't anticipate from throwing (PRD §8).
 */
export function pinIdFromUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl, 'https://www.pinterest.com');
    const match = url.pathname.match(/\/pin\/(?:.*-)?(\d{6,})\/?$/);
    if (match) return `pin:${match[1]}`;
  } catch {
    /* fall through to the raw-string fallback below */
  }
  return rawUrl.trim().toLowerCase();
}

/** Canonical `https://www.pinterest.com/pin/{id}/` when an id could be found. */
export function normalizePinUrl(rawUrl: string): string {
  const id = pinIdFromUrl(rawUrl);
  if (id.startsWith('pin:')) return `https://www.pinterest.com/pin/${id.slice(4)}/`;
  try {
    const url = new URL(rawUrl, 'https://www.pinterest.com');
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return rawUrl;
  }
}

/** `example.com` — used for the destination-domain fallback and the domain grouping view. */
export function domainFromUrl(rawUrl: string): string {
  if (!rawUrl) return '';
  try {
    return new URL(rawUrl).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return rawUrl
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .split('/')[0]
      .toLowerCase();
  }
}

function clamp(text: string, max: number): string {
  const trimmed = (text ?? '').trim();
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

/** Picks what gets stored as the image: the size-capped data URI, or the remote URL (PRD §6). */
export function chooseImage(raw: Pick<RawCapture, 'imageDataUri' | 'imageRemoteUrl'>): {
  imageUrl: string;
  imageIsRemote: boolean;
} {
  if (raw.imageDataUri) return { imageUrl: raw.imageDataUri, imageIsRemote: false };
  return { imageUrl: raw.imageRemoteUrl, imageIsRemote: true };
}

/**
 * Builds (or updates) the capture card for a pin. Saving the same pin twice
 * (PRD §8) updates the card in place — image, title, description and numbers
 * refresh — but the collection and note the user already set are preserved,
 * and the first-seen date does not move.
 */
export function buildCapture(raw: RawCapture, existing: PinCapture | null, defaultCollectionId: string): PinCapture {
  const now = Date.now();
  const image = chooseImage(raw);
  const destinationUrl = raw.destinationUrlRaw?.trim() ?? '';
  // Lowercased regardless of source: a scraped label and a derived-from-URL
  // domain must group together in the "who keeps showing up" view even if
  // Pinterest ever renders the label with different casing.
  const destinationDomain = (raw.destinationDomainRaw?.trim() || domainFromUrl(destinationUrl)).toLowerCase();

  return {
    id: pinIdFromUrl(raw.pinUrl),
    pinUrl: normalizePinUrl(raw.pinUrl),
    imageUrl: image.imageUrl,
    imageIsRemote: image.imageIsRemote,
    title: clamp(raw.titleRaw, MAX_TITLE_STORE_LENGTH),
    description: clamp(raw.descriptionRaw, MAX_DESCRIPTION_STORE_LENGTH),
    descriptionTruncated: raw.descriptionTruncated,
    destinationDomain,
    destinationUrl,
    boardName: raw.boardNameRaw?.trim() ?? '',
    creator: raw.creatorRaw?.replace(/^@/, '').trim() ?? '',
    savesRaw: raw.savesRaw?.trim() ?? '',
    capturedFrom: raw.capturedFrom,
    dateSeen: existing?.dateSeen ?? new Date().toISOString().slice(0, 10),
    savedAt: existing?.savedAt ?? now,
    updatedAt: now,
    note: existing?.note ?? '',
    collectionId: existing?.collectionId ?? defaultCollectionId,
  };
}

export function defaultCollections(): Collection[] {
  const now = Date.now();
  return DEFAULT_COLLECTIONS.map((c, i) => ({ ...c, createdAt: now + i }));
}

/** Cards matching a search across title, description, domain and note (PRD §4). */
export function matchesSearch(pin: PinCapture, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    pin.title.toLowerCase().includes(q) ||
    pin.description.toLowerCase().includes(q) ||
    pin.destinationDomain.toLowerCase().includes(q) ||
    pin.note.toLowerCase().includes(q)
  );
}

/**
 * "Who keeps showing up" (PRD §4/§11) — pins grouped by destination domain,
 * most-frequent first. Pins with no visible destination (idea pins, PRD §8)
 * land in a labelled group rather than vanishing.
 */
export function groupByDomain(pins: PinCapture[]): DomainGroup[] {
  const groups = new Map<string, PinCapture[]>();
  for (const pin of pins) {
    const key = pin.destinationDomain || '(no destination)';
    const list = groups.get(key) ?? [];
    list.push(pin);
    groups.set(key, list);
  }
  return [...groups.entries()]
    .map(([domain, list]) => ({
      domain,
      count: list.length,
      pins: [...list].sort((a, b) => b.savedAt - a.savedAt),
    }))
    .sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain));
}
