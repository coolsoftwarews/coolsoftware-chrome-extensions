/**
 * Parsers for the strings YouTube puts in the DOM. All of them return null
 * rather than throwing or guessing — a null propagates into "unknown" and a
 * result with an unknown value is never filtered out by a bound on that value.
 */

const MULTIPLIERS: Record<string, number> = {
  k: 1e3,
  m: 1e6,
  b: 1e9,
};

/**
 * "1.2M views" → 1200000, "1,234 views" → 1234, "No views" → 0.
 * Also survives the bare forms ("1.2M") used in subscriber counts.
 */
export function parseCompactNumber(input: string | null | undefined): number | null {
  if (!input) return null;
  const text = input.trim().toLowerCase();
  if (text.startsWith('no ')) return 0;

  const match = text.match(/([\d.,]+)\s*([kmb])?/);
  if (!match) return null;

  const digits = match[1];
  const suffix = match[2];

  // "1,234" is a thousands separator; "1.2M" is a decimal plus a suffix.
  // Stripping commas handles both, because a suffixed number never groups.
  const numeric = Number(digits.replace(/,/g, ''));
  if (!Number.isFinite(numeric)) return null;

  return suffix ? Math.round(numeric * MULTIPLIERS[suffix]) : numeric;
}

const UNIT_MS: Record<string, number> = {
  second: 1000,
  minute: 60 * 1000,
  hour: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
  year: 365 * 24 * 60 * 60 * 1000,
};

/**
 * "3 days ago" / "Streamed 2 weeks ago" / "1 year ago" → epoch ms.
 * Deliberately coarse: months are 30 days, years are 365. The filters this
 * feeds are all bucketed in days or larger, so the drift never changes a
 * verdict near the preset boundaries.
 */
export function parseRelativeDate(input: string | null | undefined, now = Date.now()): number | null {
  if (!input) return null;
  const match = input.trim().toLowerCase().match(/(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago/);
  if (!match) return null;

  const amount = Number(match[1]);
  const unit = UNIT_MS[match[2]];
  if (!Number.isFinite(amount) || !unit) return null;

  return now - amount * unit;
}

/** "1:02:03" → 3723, "9:41" → 581. Returns null for badges like "LIVE". */
export function parseDuration(input: string | null | undefined): number | null {
  if (!input) return null;
  const text = input.trim();
  if (!/^\d{1,2}(:\d{2}){1,2}$/.test(text)) return null;

  const parts = text.split(':').map(Number);
  return parts.reduce((total, part) => total * 60 + part, 0);
}

/** Pulls the video id out of any /watch, /shorts or youtu.be style href. */
export function parseVideoId(href: string | null | undefined): string | null {
  if (!href) return null;
  const watch = href.match(/[?&]v=([\w-]{11})/);
  if (watch) return watch[1];
  const shorts = href.match(/\/shorts\/([\w-]{11})/);
  if (shorts) return shorts[1];
  return null;
}

/**
 * Reduces a channel href to a stable cache key: the UC… id when present,
 * otherwise the @handle. Both forms are unique per channel, and a given
 * search page uses one form consistently, so mixing them costs at most one
 * duplicate fetch.
 */
export function parseChannelKey(href: string | null | undefined): string | null {
  if (!href) return null;
  const id = href.match(/\/channel\/(UC[\w-]+)/);
  if (id) return id[1];
  const handle = href.match(/\/(@[\w.\-]+)/);
  if (handle) return handle[1];
  const legacy = href.match(/\/(?:c|user)\/([\w.\-]+)/);
  if (legacy) return legacy[1];
  return null;
}

/** Median of a numeric list; null for an empty list. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid];
}

/** 2400 → "2.4K". Used for badges, so it stays short over exact. */
export function formatCompact(value: number): string {
  if (value >= 1e9) return `${trimZero(value / 1e9)}B`;
  if (value >= 1e6) return `${trimZero(value / 1e6)}M`;
  if (value >= 1e3) return `${trimZero(value / 1e3)}K`;
  return String(Math.round(value));
}

function trimZero(value: number): string {
  const fixed = value.toFixed(1);
  return fixed.endsWith('.0') ? fixed.slice(0, -2) : fixed;
}
