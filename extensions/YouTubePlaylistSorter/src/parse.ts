/**
 * Parsers for the strings YouTube renders on a playlist row. Pure, DOM-free,
 * so scripts/selftest.mjs can fixture every format headlessly. Every function
 * returns null rather than throwing or guessing — a null field is excluded
 * from sorting/packing by the callers in sort.ts/pack.ts, never treated as
 * zero (PRD §5: a missing duration must never silently count as "0:00").
 */

/** "1:02:03" -> 3723, "9:41" -> 581. Null for badges like "LIVE" or "PREMIERE". */
export function parseDuration(input: string | null | undefined): number | null {
  if (!input) return null;
  const text = input.trim();
  if (!/^\d{1,2}(:\d{2}){1,2}$/.test(text)) return null;

  const parts = text.split(':').map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return null;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

/** 3723 -> "1:02:03", 581 -> "9:41". Inverse of parseDuration, for display. */
export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

const MULTIPLIERS: Record<string, number> = { k: 1e3, m: 1e6, b: 1e9 };

/**
 * "1.2K views" -> 1200, "3,401 views" -> 3401, "No views" -> 0.
 * Also survives the bare forms ("1.2K") a locale might render without the
 * word "views" attached.
 */
export function parseViewCount(input: string | null | undefined): number | null {
  if (!input) return null;
  const text = input.trim().toLowerCase();
  if (!/view/.test(text) && !/^[\d.,\s]+[kmb]?$/i.test(text)) return null;
  if (text.startsWith('no ')) return 0;

  const match = text.match(/([\d.,]+)\s*([kmb])?/);
  if (!match) return null;

  const numeric = Number(match[1].replace(/,/g, ''));
  if (!Number.isFinite(numeric)) return null;

  const suffix = match[2];
  return suffix ? Math.round(numeric * MULTIPLIERS[suffix]) : Math.round(numeric);
}

/**
 * Is this text a relative upload date ("2 years ago", "Streamed 3 days ago")?
 * YouTube's playlist rows only ever expose a relative string, never an
 * absolute date (see PRD §10, open question) — this just confirms the shape
 * so callers can label date-sort as "relative order" rather than a true
 * chronological sort.
 */
export function looksLikeRelativeDate(input: string | null | undefined): boolean {
  if (!input) return false;
  return /\b(second|minute|hour|day|week|month|year)s?\s+ago\b/i.test(input.trim());
}

/**
 * Roughly how long ago a relative date string describes, in milliseconds.
 * Deliberately coarse (months=30d, years=365d) — good enough to *order* rows
 * by recency, not to compute an exact date. Null when the string isn't a
 * relative date at all.
 */
export function relativeDateToMs(input: string | null | undefined): number | null {
  if (!input) return null;
  const match = input
    .trim()
    .toLowerCase()
    .match(/(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago/);
  if (!match) return null;

  const amount = Number(match[1]);
  const unitMs: Record<string, number> = {
    second: 1000,
    minute: 60 * 1000,
    hour: 60 * 60 * 1000,
    day: 24 * 60 * 60 * 1000,
    week: 7 * 24 * 60 * 60 * 1000,
    month: 30 * 24 * 60 * 60 * 1000,
    year: 365 * 24 * 60 * 60 * 1000,
  };
  const unit = unitMs[match[2]];
  if (!Number.isFinite(amount) || !unit) return null;
  return amount * unit;
}

/** Pulls the 11-char video id out of a /watch?v= href. */
export function parseVideoId(href: string | null | undefined): string | null {
  if (!href) return null;
  const match = href.match(/[?&]v=([\w-]{11})/);
  return match ? match[1] : null;
}
