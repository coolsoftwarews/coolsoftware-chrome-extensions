/**
 * Pure logic — no DOM, no chrome.* — so scripts/selftest.mjs can check every
 * one of these headlessly. The DOM-bound half that calls into these lives in
 * scrape.ts and content.ts.
 *
 * Nothing in this file builds, parses or even names YouTube's signed
 * video-streaming CDN, a player/format response, or a stream URL of any kind
 * — see PRD-47 §2/§4. scripts/selftest.mjs asserts that absence as a hard
 * guardrail (grepping src/*.ts for the forbidden domain, named in
 * README.md/PRIVACY.md rather than here), not just a comment.
 */

import { ScrapedVideo, UploadRecord } from './types';

/* ── Channel identity / the ownership gate ──────────────────────────────── */

/**
 * Normalizes a channel key — either a channel id (`UC…`, case-sensitive by
 * YouTube's own rule) or an `@handle` (not case-sensitive; YouTube itself
 * treats `@Creator` and `@creator` as the same handle) — into one comparable
 * form. IDs are trimmed only; handles are lowercased too.
 */
export function normalizeChannelKey(raw: string | null | undefined): string {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return '';
  return trimmed.startsWith('@') ? trimmed.toLowerCase() : trimmed;
}

/**
 * The ownership-match predicate (PRD §5): true only when the channel being
 * viewed is confirmably one of the accounts the account-switcher / Studio
 * identity element says the signed-in session owns.
 *
 * Fails closed on every ambiguous input: an empty `viewedKey`, an empty
 * `ownKeys` list, or no exact match after normalizing both sides all return
 * false. There is no fuzzy/partial match here on purpose — the Archive
 * button must never render on a guess.
 */
export function isOwnChannelMatch(ownKeys: readonly string[], viewedKey: string | null | undefined): boolean {
  const viewed = normalizeChannelKey(viewedKey);
  if (!viewed) return false;
  return ownKeys.some(key => normalizeChannelKey(key) === viewed);
}

/* ── Video ids and URLs ──────────────────────────────────────────────────── */

const WATCH_ID_RE = /[?&]v=([\w-]{6,})/;
const SHORT_ID_RE = /\/shorts\/([\w-]{6,})/;
const LIVE_ID_RE = /\/live\/([\w-]{6,})/;
const STUDIO_ID_RE = /\/video\/([\w-]{6,})(?:\/|$)/;

/** Extracts a video id from any href shape this extension needs to read:
 *  a watch URL, a Shorts URL, a live URL, or a Studio video URL. Returns
 *  null rather than guessing when none match. */
export function parseVideoId(href: string | null | undefined): string | null {
  if (!href) return null;
  return WATCH_ID_RE.exec(href)?.[1] ?? SHORT_ID_RE.exec(href)?.[1] ?? LIVE_ID_RE.exec(href)?.[1] ?? STUDIO_ID_RE.exec(href)?.[1] ?? null;
}

/** The canonical watch URL for a video id — built from the id, never read
 *  as a raw href off the page (some layouts render relative or shortened
 *  hrefs). */
export function canonicalWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

/**
 * The video's page in YouTube Studio. There is no public, stable deep link
 * straight into the Download *action* itself (it lives behind that video's
 * ⋮ menu) — so this points at the video's own Studio editor page, where the
 * user reaches Download in one more click, through YouTube's own sanctioned
 * path. This extension gets the user to the door, not through it (PRD §2/§4).
 */
export function studioEditUrl(videoId: string): string {
  return `https://studio.youtube.com/video/${videoId}/edit`;
}

/* ── Displayed counts ────────────────────────────────────────────────────── */

/**
 * Parses a view/like count exactly as YouTube displays it — "12,345",
 * "1.2K views", "3.4M". Returns null (not 0) when nothing usable is present;
 * a count YouTube didn't render (likes hidden by the creator, a just-
 * published video with no view count yet) must never be misrepresented as
 * zero (PRD §4: "as currently displayed").
 */
export function parseDisplayedCount(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/,/g, '');
  const match = cleaned.match(/(\d+(?:\.\d+)?)\s*([KMB])?/i);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  const suffix = match[2]?.toUpperCase();
  const multiplier = suffix === 'K' ? 1_000 : suffix === 'M' ? 1_000_000 : suffix === 'B' ? 1_000_000_000 : 1;
  return Math.round(value * multiplier);
}

/* ── Assembling / re-touching a stored record ────────────────────────────── */

/**
 * Turns a fresh scrape into a stored record. Archiving the same video id a
 * second time (title/description edited since, a stat that moved) updates
 * every captured field and `updatedAt`, but keeps the original `archivedAt`
 * and whatever `thumbnailSavedAt` already holds — "update in place, don't
 * duplicate", the same rule every Saver in this portfolio follows (PRD §7).
 */
export function buildRecord(
  scraped: ScrapedVideo,
  existing: UploadRecord | null,
  channelKey: string,
  now: number
): UploadRecord {
  return {
    videoId: scraped.videoId,
    url: scraped.url,
    title: scraped.title,
    description: scraped.description,
    publishDateText: scraped.publishDateText,
    views: scraped.views,
    likes: scraped.likes,
    thumbnailUrl: scraped.thumbnailUrl,
    studioUrl: studioEditUrl(scraped.videoId),
    channelKey,
    archivedAt: existing?.archivedAt ?? now,
    updatedAt: now,
    thumbnailSavedAt: existing?.thumbnailSavedAt ?? null,
  };
}

/** Pure updater applied once the background worker confirms the thumbnail
 *  image actually saved (PRD §7 — a missing thumbnail retries, it never
 *  blocks the rest of the entry). */
export function markThumbnailSaved(record: UploadRecord, at: number): UploadRecord {
  return { ...record, thumbnailSavedAt: at };
}

/* ── Search ──────────────────────────────────────────────────────────────── */

/** Client-side search across title, description and video id (PRD §4:
 *  "searchable client-side by title/description text"). An empty query
 *  matches everything. */
export function matchesRecordSearch(record: UploadRecord, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return (
    record.title.toLowerCase().includes(needle) ||
    record.description.toLowerCase().includes(needle) ||
    record.videoId.toLowerCase().includes(needle)
  );
}

/* ── Filenames ───────────────────────────────────────────────────────────── */

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function dateStamp(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** e.g. "youtube-upload-archiver-2026-09-06.csv" — same dated-export
 *  convention as every other Saver in this portfolio. */
export function buildExportFilename(format: 'csv' | 'md' | 'json', date: Date = new Date()): string {
  return `youtube-upload-archiver-${dateStamp(date)}.${format}`;
}

/** Strips path-hostile characters from a video title so it's safe as (part
 *  of) a downloaded filename, collapsing the gaps left behind rather than
 *  leaving doubled spaces. */
function sanitizeForFilename(text: string): string {
  const cleaned = text.replace(/["/\\:*?<>|]/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned.slice(0, 80);
}

/** Where a video's thumbnail image is written on disk — namespaced under
 *  the extension's own folder so a large archive doesn't scatter files
 *  across the user's whole Downloads directory. */
export function buildThumbnailFilename(videoId: string, title: string): string {
  const label = sanitizeForFilename(title);
  const base = label ? `${videoId} - ${label}` : videoId;
  return `youtube-upload-archiver/${base}.jpg`;
}

/* ── CSV / Markdown export (pure, fully tested) ───────────────────────────── */

function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

const CSV_HEADER = ['Video ID', 'Title', 'Description', 'Published', 'Views', 'Likes', 'URL', 'Studio URL', 'Archived At', 'Updated At'].join(',');

export function toCsv(records: UploadRecord[]): string {
  const rows = records.map(r =>
    [
      csvField(r.videoId),
      csvField(r.title),
      csvField(r.description),
      csvField(r.publishDateText),
      r.views === null ? '' : String(r.views),
      r.likes === null ? '' : String(r.likes),
      csvField(r.url),
      csvField(r.studioUrl),
      new Date(r.archivedAt).toISOString(),
      new Date(r.updatedAt).toISOString(),
    ].join(',')
  );
  return [CSV_HEADER, ...rows].join('\r\n') + '\r\n';
}

export function toMarkdown(records: UploadRecord[]): string {
  if (!records.length) return '# YouTube Upload Archive\n\nNo videos archived yet.\n';

  const lines = ['# YouTube Upload Archive', ''];
  for (const r of records) {
    lines.push(`## ${r.title || r.videoId}`, '');
    if (r.description) lines.push(`> ${r.description.replace(/\n/g, '\n> ')}`, '');
    lines.push(`- Published: ${r.publishDateText || 'unknown'}`);
    lines.push(`- Views: ${r.views === null ? 'not shown' : r.views}`);
    lines.push(`- Likes: ${r.likes === null ? 'not shown' : r.likes}`);
    lines.push(`- [Watch on YouTube](${r.url})`);
    lines.push(`- [Open in YouTube Studio](${r.studioUrl})`);
    lines.push('');
  }
  return lines.join('\n');
}
