/**
 * The export layer: one video's notes in, Markdown or CSV out. Deliberately
 * pure — no DOM, no chrome.* — so scripts/selftest.mjs can check every
 * format headlessly, same split as WebHighlighter's and
 * RedditVoiceOfCustomer's formatters.ts.
 */

import { VideoNote } from './types';
import { youtubeTimestampUrl } from './url';

/** "12:34" under an hour, "1:02:03" at or over one — the same shape a
 *  YouTube scrubber itself uses, so it reads as familiar. */
export function timeLabel(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function sanitizeFilenamePart(raw: string): string {
  return raw
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** `{video title} - notes.{ext}`, sanitized and capped at 120 chars,
 *  extension kept after truncation — same convention as the sibling
 *  extensions' filename builders. */
export function buildFilename(videoTitle: string, kind: 'md' | 'csv', date = new Date()): string {
  const stamp = date.toISOString().slice(0, 10);
  const title = sanitizeFilenamePart(videoTitle || 'video') || 'video';
  const suffix = ` - notes - ${stamp}.${kind}`;
  const budget = Math.max(1, 120 - suffix.length);
  return `${title.slice(0, budget)}${suffix}`;
}

/** The primary artifact (PRD §4): one chapter-marker list, each entry a
 *  clickable jump link, in the order they occur in the video. */
export function toMarkdown(videoTitle: string, videoId: string, notes: VideoNote[], exportedAt = new Date()): string {
  const parts: string[] = [`# ${videoTitle || 'YouTube video'}`, '', `**Video:** https://www.youtube.com/watch?v=${videoId}`, `**Exported:** ${exportedAt.toISOString().slice(0, 10)}`, '', '---', ''];

  if (!notes.length) {
    parts.push('_No notes taken on this video yet._', '');
    return parts.join('\n').trimEnd() + '\n';
  }

  for (const note of notes) {
    const label = note.isLive ? `${timeLabel(note.seconds)} (live)` : `[${timeLabel(note.seconds)}](${youtubeTimestampUrl(videoId, note.seconds)})`;
    parts.push(`- **${label}** — ${note.text}`);
  }

  return parts.join('\n').trimEnd() + '\n';
}

function csvField(value: string): string {
  const needsQuoting = /[",\n\r]/.test(value);
  const escaped = value.replace(/"/g, '""');
  return needsQuoting ? `"${escaped}"` : escaped;
}

const CSV_COLUMNS = ['timestamp', 'timestamp_seconds', 'note', 'is_live', 'video_title', 'video_id', 'jump_url', 'created_at'] as const;

/** For pasting into a spreadsheet alongside other research. */
export function toCsv(videoTitle: string, videoId: string, notes: VideoNote[]): string {
  const rows = [CSV_COLUMNS.join(',')];

  for (const note of notes) {
    const row = [
      timeLabel(note.seconds),
      String(Math.floor(note.seconds)),
      note.text,
      note.isLive ? 'true' : 'false',
      videoTitle,
      videoId,
      note.isLive ? '' : youtubeTimestampUrl(videoId, note.seconds),
      new Date(note.createdAt).toISOString(),
    ].map(csvField);
    rows.push(row.join(','));
  }

  return rows.join('\r\n') + '\r\n';
}
