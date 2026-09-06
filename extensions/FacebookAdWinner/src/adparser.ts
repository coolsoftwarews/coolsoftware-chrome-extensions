/**
 * Turns the rendered text of one Ad Library card into structured fields.
 *
 * Pure string logic — no DOM — so it can be unit tested against fixed text
 * fixtures (scripts/selftest.mjs) without a live page. The DOM half (finding
 * card elements, reading `innerText`, pulling the thumbnail/link) lives in
 * content.ts.
 *
 * The Ad Library's markup is unstable (no public API, classes are
 * obfuscated), but its *text* is not: every card prints a "Library ID:"
 * line, a "Started running on <date>" line, and an explicit Active/Inactive
 * state. This parser leans on those strings rather than any CSS selector.
 * When a card's text doesn't match, every field below comes back null and
 * the caller skips that card rather than guessing — a parse failure disables
 * one badge, quietly; it must never break the page (PRD §6).
 */

import { AdFormat, AdStatus } from './types';

const MONTHS: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Parses "Jan 15, 2026", "15 Jan 2026" or "January 15, 2026" into an ISO
 * date (YYYY-MM-DD). Returns null for anything it doesn't recognize rather
 * than guessing a date.
 */
export function parseDateToIso(raw: string): string | null {
  const text = raw.trim();

  let m = text.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m) {
    const month = MONTHS[m[1].toLowerCase()];
    if (month) return `${m[3]}-${pad2(month)}-${pad2(Number(m[2]))}`;
  }

  m = text.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (m) {
    const month = MONTHS[m[2].toLowerCase()];
    if (month) return `${m[3]}-${pad2(month)}-${pad2(Number(m[1]))}`;
  }

  m = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return text;

  return null;
}

export interface ParsedCardFields {
  libraryId: string | null;
  startDate: string | null;
  stopDate: string | null;
  status: AdStatus;
}

const LIBRARY_ID_RE = /Library ID:?\s*([0-9]{6,})/i;
const START_RE = /Started running on\s+([A-Za-z0-9,\s]+?)(?:\s*[·|]|\s*$|\n)/i;
const STOP_RE = /Stopped running on\s+([A-Za-z0-9,\s]+?)(?:\s*[·|]|\s*$|\n)/i;
const INACTIVE_RE = /\bInactive\b/i;
const ACTIVE_RE = /\bActive\b/i;

/** Parses one ad card's flattened text. `null` fields mean "could not read". */
export function parseAdCardText(text: string): ParsedCardFields {
  const normalized = text.replace(/ /g, ' ');

  const libraryMatch = normalized.match(LIBRARY_ID_RE);
  const startMatch = normalized.match(START_RE);
  const stopMatch = normalized.match(STOP_RE);

  const startDate = startMatch ? parseDateToIso(startMatch[1].trim()) : null;
  const stopDate = stopMatch ? parseDateToIso(stopMatch[1].trim()) : null;

  // Explicit "Inactive" always wins over a stray "Active" elsewhere in the
  // card (e.g. inside "Active on Facebook and Instagram" platform copy).
  const status: AdStatus = INACTIVE_RE.test(normalized) || Boolean(stopDate)
    ? 'stopped'
    : ACTIVE_RE.test(normalized)
      ? 'active'
      // No explicit state text at all: treat "no stop date" as active, the
      // Library's own default reading.
      : stopDate
        ? 'stopped'
        : 'active';

  return {
    libraryId: libraryMatch ? libraryMatch[1] : null,
    startDate,
    stopDate,
    status,
  };
}

export interface FormatSignals {
  hasVideo: boolean;
  imageCount: number;
}

/** Format is read from the DOM (a <video> tag, multiple image cards), not text — this just names the result. */
export function detectFormatFromSignals(signals: FormatSignals): AdFormat {
  if (signals.hasVideo) return 'video';
  if (signals.imageCount > 1) return 'carousel';
  if (signals.imageCount === 1) return 'image';
  return 'unknown';
}

/**
 * Best-effort body copy extraction: the card's text minus the chrome lines
 * (Library ID, dates, status, "See ad details" etc.) that every card prints.
 * Leaves the advertiser name to the DOM (it is a distinct, styled element).
 */
const CHROME_LINE_RE =
  /^(Library ID:?|Started running on|Stopped running on|Active|Inactive|Sponsored|See ad details|See summary details|Platforms?:?)/i;

export function extractBodyText(cardText: string): string {
  return cardText
    .split(/\n+/)
    .map(line => line.trim())
    .filter(line => line && !CHROME_LINE_RE.test(line))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}
