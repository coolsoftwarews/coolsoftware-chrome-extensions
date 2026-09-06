/**
 * Export layer: the currently visible/filtered comment set → Markdown or CSV
 * (PRD §4). Pure — no DOM, no chrome.* — so scripts/selftest.mjs can check
 * every format headlessly.
 */

import { Comment, VideoMeta } from './types';

const MAX_FILENAME_LENGTH = 120;

function badge(comment: Comment): string {
  const marks: string[] = [];
  if (comment.pinned) marks.push('📌 pinned');
  if (comment.hearted) marks.push('❤️ creator heart');
  return marks.length ? ` (${marks.join(', ')})` : '';
}

function statsLine(comment: Comment): string {
  const parts: string[] = [];
  parts.push(comment.likeCount === null ? 'likes n/a' : `${comment.likeCount} likes`);
  parts.push(comment.replyCount === null ? 'replies n/a' : `${comment.replyCount} replies`);
  if (comment.publishedText) parts.push(comment.publishedText);
  return parts.join(' · ');
}

export interface ExportInput {
  meta: VideoMeta;
  comments: Comment[];
  /** The search query in effect, if any — recorded so an exported file is self-explanatory. */
  query?: string;
}

function sourceUrl(meta: VideoMeta): string | null {
  return meta.videoId ? `https://www.youtube.com/watch?v=${meta.videoId}` : null;
}

/* ── Markdown ────────────────────────────────────────────────────────── */

export function toMarkdown(input: ExportInput): string {
  const { meta, comments, query } = input;
  const parts: string[] = [];

  parts.push(`# Comments — ${meta.title || 'Untitled video'}`, '');
  const url = sourceUrl(meta);
  if (url) parts.push(`Source: ${url}`);
  if (meta.channel) parts.push(`Channel: ${meta.channel}`);
  if (query) parts.push(`Filtered by: "${query}"`);
  parts.push(`Comments in this export: ${comments.length}`, '');

  if (!comments.length) {
    parts.push('_No comments to export — try loading more, or clearing your search._', '');
  }

  for (const comment of comments) {
    const author = comment.author || 'Unknown';
    parts.push(`- **${author}**${badge(comment)} — ${statsLine(comment)}`);
    const body = comment.text
      .split('\n')
      .map(line => `  ${line}`)
      .join('\n');
    parts.push(body || '  _(empty comment)_', '');
  }

  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

/* ── CSV ─────────────────────────────────────────────────────────────── */

function csvCell(value: string): string {
  // RFC 4180: quote whenever the field contains a comma, quote or newline;
  // escape embedded quotes by doubling them.
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

const CSV_HEADER = ['author', 'text', 'likeCount', 'replyCount', 'published', 'pinned', 'heartedByCreator'];

export function toCsv(input: ExportInput): string {
  const rows = [CSV_HEADER.join(',')];
  for (const comment of input.comments) {
    rows.push(
      [
        csvCell(comment.author ?? ''),
        csvCell(comment.text),
        comment.likeCount === null ? '' : String(comment.likeCount),
        comment.replyCount === null ? '' : String(comment.replyCount),
        csvCell(comment.publishedText ?? ''),
        comment.pinned ? 'true' : 'false',
        comment.hearted ? 'true' : 'false',
      ].join(',')
    );
  }
  return rows.join('\r\n') + '\r\n';
}

/* ── Filenames ───────────────────────────────────────────────────────── */

/** `{channel} - {title} comments.{ext}`, sanitized and capped at 120 characters. */
export function buildFilename(meta: VideoMeta, ext: string): string {
  const stripControlChars = (value: string): string =>
    Array.from(value)
      .filter(ch => {
        const code = ch.codePointAt(0) ?? 0;
        return code >= 32 && code !== 127;
      })
      .join('');

  const clean = (value: string): string =>
    stripControlChars(value)
      .replace(/[\\/:*?"<>|]/g, '')
      .replace(/\.+$/, '')
      .replace(/\s+/g, ' ')
      .trim();

  const suffix = `.${ext}`;
  const channel = clean(meta.channel ?? '');
  const title = clean(meta.title ?? '');

  let stem = [channel, title].filter(Boolean).join(' - ') || 'youtube-comments';
  stem = `${stem} comments`;

  const budget = MAX_FILENAME_LENGTH - suffix.length;
  if (stem.length > budget) stem = stem.slice(0, budget).trimEnd().replace(/[-\s]+$/, '');

  return stem + suffix;
}
