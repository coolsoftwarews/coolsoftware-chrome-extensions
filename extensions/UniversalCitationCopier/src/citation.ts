/**
 * Citation formatting — pure string logic, no DOM.
 *
 * Everything here operates on plain data (`RawMeta` in, `PageMetadata` out,
 * `PageMetadata` in, a formatted string out), which is what makes it testable
 * without a browser (scripts/selftest.mjs). The only DOM-touching code in this
 * extension is `collectRawMeta` in `extract.ts` — a thin, untested-by-design
 * shim whose entire job is to hand a `RawMeta` bag to `deriveMetadata` below.
 *
 * PRD §5 sets the rule this file exists to satisfy: no missing field may ever
 * produce a visible artifact — no "undefined", no empty "()", no dangling
 * ", ," or ". .". Every formatter is written so a missing field changes the
 * sentence structure instead of leaving a hole in it.
 */

/** Exactly what `extract.ts` reads off the live DOM — untouched strings. */
export interface RawMeta {
  documentTitle: string | null;
  ogTitle: string | null;
  ogSiteName: string | null;
  metaAuthor: string | null;
  articleAuthor: string | null;
  relAuthorText: string | null;
  bylineText: string | null;
  publishedTime: string | null;
  canonicalUrl: string | null;
  locationHref: string;
  h1Text: string | null;
}

export interface DateParts {
  year: number;
  month: number; // 1-12
  day: number;
}

export interface PageMetadata {
  title: string;
  siteName: string;
  /** Already best-effort "as given" — inversion happens at format time. */
  author: string | null;
  publishedDate: DateParts | null;
  url: string;
}

/* ── Field fallback chains (PRD §5) ─────────────────────────────────────── */

function firstNonEmpty(...values: (string | null | undefined)[]): string | null {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

/** `example.com` from any absolute URL; empty string if the URL is unusable. */
export function hostnameOf(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * Strips the fragment and common tracking parameters. Citations should show
 * the real, resolvable URL, so — unlike a dedupe key — this deliberately does
 * NOT touch `www.`, trailing slashes, or non-tracking query parameters.
 */
const TRACKING_PARAMS = [/^utm_/i, /^fbclid$/i, /^gclid$/i, /^igshid$/i, /^mc_(cid|eid)$/i, /^ref_src$/i];

export function cleanCitationUrl(rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return rawUrl.trim();
  }
  url.hash = '';
  const kept: [string, string][] = [];
  for (const [key, value] of url.searchParams) {
    if (TRACKING_PARAMS.some(pattern => pattern.test(key))) continue;
    kept.push([key, value]);
  }
  url.search = '';
  for (const [key, value] of kept) url.searchParams.append(key, value);
  return url.toString();
}

const UNSUPPORTED_PROTOCOLS = ['chrome:', 'chrome-extension:', 'edge:', 'about:', 'devtools:', 'view-source:'];

/** Pages this extension can't read metadata from — used to show a clear error rather than a broken citation. */
export function isSupportedPageUrl(rawUrl: string | undefined): boolean {
  if (!rawUrl) return false;
  try {
    const url = new URL(rawUrl);
    if (UNSUPPORTED_PROTOCOLS.includes(url.protocol)) return false;
    if (url.protocol === 'file:') return false;
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Parses an ISO-ish date string into plain parts, or null if it isn't one. */
export function parseDateParts(raw: string | null): DateParts | null {
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

/**
 * Turns `raw`'s field chain into the final page metadata. Every field has a
 * terminal fallback so the formatters never see `null` for title/siteName/url.
 */
export function deriveMetadata(raw: RawMeta): PageMetadata {
  const url = cleanCitationUrl(firstNonEmpty(raw.canonicalUrl, raw.locationHref) ?? raw.locationHref);
  const host = hostnameOf(url);

  const title = firstNonEmpty(raw.ogTitle, raw.documentTitle, raw.h1Text) ?? 'Untitled page';
  const siteName = firstNonEmpty(raw.ogSiteName) ?? host;
  const author = firstNonEmpty(raw.metaAuthor, raw.articleAuthor, raw.relAuthorText, raw.bylineText);
  const publishedDate = parseDateParts(raw.publishedTime);

  return { title, siteName, author, publishedDate, url };
}

/* ── Author-name inversion ("First Last" → "Last, First") ──────────────── */

const ORG_HINTS =
  /\b(inc|llc|ltd|co|corp|company|times|news|press|staff|team|editorial|associates?|associated|bureau|agency|university|dept|department|magazine|journal|wire|reuters|ap|bbc|cnn|desk)\b/i;

/**
 * Best-effort only (PRD §10): inverts a plain "First Last" name for
 * bibliography-style entries. Leaves anything that doesn't clearly look like
 * a two-token Western personal name untouched — an org byline or a
 * non-Latin/no-space name is not "fixed" incorrectly, it's left as given.
 */
export function invertAuthorName(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  if (trimmed.includes(',')) return trimmed; // already "Last, First", or an org name with a comma
  if (ORG_HINTS.test(trimmed)) return trimmed;

  const tokens = trimmed.split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return trimmed;

  const last = tokens[tokens.length - 1];
  const rest = tokens.slice(0, -1).join(' ');
  return `${last}, ${rest}`;
}

/* ── Date rendering ──────────────────────────────────────────────────────── */

const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const MONTHS_ABBR = [
  'Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'June',
  'July', 'Aug.', 'Sept.', 'Oct.', 'Nov.', 'Dec.',
];

function todayParts(now: Date = new Date()): DateParts {
  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
}

/** `2024, March 5` — the inside of APA's `(Year, Month Day)`. */
function apaDate(parts: DateParts): string {
  return `${parts.year}, ${MONTHS_LONG[parts.month - 1]} ${parts.day}`;
}

/** `5 Mar. 2024` — MLA's day-month-year, abbreviated month except May/June/July. */
function mlaDate(parts: DateParts): string {
  return `${parts.day} ${MONTHS_ABBR[parts.month - 1]} ${parts.year}`;
}

/** `March 5, 2024` — Chicago's month-day-year, full month name. */
function chicagoDate(parts: DateParts): string {
  return `${MONTHS_LONG[parts.month - 1]} ${parts.day}, ${parts.year}`;
}

/* ── Formatters ──────────────────────────────────────────────────────────── */

export function formatMarkdownLink(meta: PageMetadata): string {
  // A literal `]` or `)` in the title would break the Markdown link syntax.
  const safeTitle = meta.title.replace(/\]/g, '\\]');
  return `[${safeTitle}](${meta.url})`;
}

export function formatPlainUrl(meta: PageMetadata): string {
  return meta.url;
}

export function formatAPA(meta: PageMetadata): string {
  const date = `(${meta.publishedDate ? apaDate(meta.publishedDate) : 'n.d.'})`;
  const site = meta.siteName ? ` ${meta.siteName}.` : '';

  if (meta.author) {
    return `${invertAuthorName(meta.author)}. ${date}. ${meta.title}.${site} ${meta.url}`;
  }
  // No author: APA moves the title into the author slot, so the date comes second.
  return `${meta.title}. ${date}.${site} ${meta.url}`;
}

export function formatMLA(meta: PageMetadata, now: Date = new Date()): string {
  void now; // MLA omits rather than substitutes "accessed" when the publish date is unknown.
  const authorPart = meta.author ? `${invertAuthorName(meta.author)}. ` : '';
  const datePart = meta.publishedDate ? `, ${mlaDate(meta.publishedDate)}` : '';
  return `${authorPart}"${meta.title}." ${meta.siteName}${datePart}, ${meta.url}.`;
}

export function formatChicago(meta: PageMetadata, now: Date = new Date()): string {
  const authorPart = meta.author ? `${invertAuthorName(meta.author)}. ` : '';
  const datePart = meta.publishedDate
    ? `${chicagoDate(meta.publishedDate)}. `
    : `Accessed ${chicagoDate(todayParts(now))}. `;
  return `${authorPart}"${meta.title}." ${meta.siteName}. ${datePart}${meta.url}.`;
}

/* ── Dispatch ────────────────────────────────────────────────────────────── */

export type FormatId = 'markdown' | 'url' | 'apa' | 'mla' | 'chicago';

export const FORMAT_IDS: FormatId[] = ['markdown', 'url', 'apa', 'mla', 'chicago'];

export const FORMAT_LABELS: Record<FormatId, string> = {
  markdown: 'Markdown link',
  url: 'Plain URL',
  apa: 'APA',
  mla: 'MLA',
  chicago: 'Chicago',
};

export const DEFAULT_FORMAT: FormatId = 'markdown';

export function formatCitation(id: FormatId, meta: PageMetadata, now: Date = new Date()): string {
  switch (id) {
    case 'markdown':
      return formatMarkdownLink(meta);
    case 'url':
      return formatPlainUrl(meta);
    case 'apa':
      return formatAPA(meta);
    case 'mla':
      return formatMLA(meta, now);
    case 'chicago':
      return formatChicago(meta, now);
  }
}

export function isFormatId(value: unknown): value is FormatId {
  return typeof value === 'string' && (FORMAT_IDS as string[]).includes(value);
}
