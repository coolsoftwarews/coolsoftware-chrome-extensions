/**
 * Pure text parsing — no DOM, no chrome.*. Kept separate from selectors.ts so
 * scripts/selftest.mjs can check every rule headlessly.
 */

/** "24.5K" / "1.2M" / "3,402" / "274K views" → a number, or null when unreadable. */
export function parseCompactNumber(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const match = raw.replace(/,/g, '').match(/([\d.]+)\s*([KkMmBb]?)/);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  const suffix = match[2].toUpperCase();
  const multiplier = suffix === 'K' ? 1_000 : suffix === 'M' ? 1_000_000 : suffix === 'B' ? 1_000_000_000 : 1;
  return Math.round(value * multiplier);
}

/** "0:45" / "1:03:20" → seconds. */
export function parseDurationLabel(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const parts = raw.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!parts) return null;
  const [, a, b, c] = parts;
  if (c !== undefined) return Number(a) * 3600 + Number(b) * 60 + Number(c);
  return Number(a) * 60 + Number(b);
}

/** `/video/1234567890123456789` (with or without a leading `@handle/`) → the id. */
export function parseVideoId(href: string | null | undefined): string | null {
  if (!href) return null;
  const match = href.match(/\/video\/(\d+)/) ?? href.match(/\/photo\/(\d+)/);
  return match ? match[1] : null;
}

/** `/@handle` or a full profile URL → `@handle`, lowercased for use as a cache key. */
export function parseProfileId(hrefOrUrl: string): string | null {
  const match = hrefOrUrl.match(/@([\w.-]+)/);
  return match ? `@${match[1].toLowerCase()}` : null;
}

/** First line of a caption, trimmed and length-capped so a huge caption never balloons the UI. */
export function firstLine(caption: string | null | undefined): string | null {
  if (!caption) return null;
  const line = caption.split(/\r?\n/, 1)[0]?.trim();
  if (!line) return null;
  return line.length > 140 ? `${line.slice(0, 139)}…` : line;
}

/**
 * Hashtags out of whatever caption text is readable. Matches Unicode word
 * characters so this doesn't silently drop non-Latin scripts (§7: captions in
 * mixed languages must not assume English).
 */
export function extractHashtags(caption: string | null | undefined): string[] {
  if (!caption) return [];
  const matches = caption.match(/#[\p{L}\p{N}_]+/gu) ?? [];
  const seen = new Set<string>();
  for (const raw of matches) seen.add(raw.toLowerCase());
  return [...seen];
}

/**
 * Whether a hook line "opens with a question" — matched on punctuation alone
 * (a leading/trailing `?`), never on grammar, so it holds across languages
 * (§7: count patterns, don't parse grammar).
 */
export function looksLikeQuestion(line: string | null | undefined): boolean {
  if (!line) return false;
  return line.trim().endsWith('?');
}

/** Whether a hook line opens with a digit — "3 things", "5 signs", a listicle-style hook. */
export function looksLikeNumberOpener(line: string | null | undefined): boolean {
  if (!line) return false;
  return /^[\s"'“]*\d/.test(line);
}
