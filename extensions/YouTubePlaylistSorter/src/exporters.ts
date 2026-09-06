/**
 * CSV / Markdown export of whatever the panel currently has on screen — the
 * sorted/filtered row list, exactly as displayed. Pure, no DOM, no chrome.*.
 */

import { formatDuration } from './parse';
import { PlaylistRow } from './types';

/** RFC 4180 field quoting. */
function csvField(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function toCsv(rows: PlaylistRow[]): string {
  const header = ['position', 'title', 'duration', 'views', 'uploaded', 'unavailable'];
  const lines = [header.join(',')];

  for (const row of rows) {
    lines.push(
      [
        String(row.position),
        row.title,
        row.durationText ?? '',
        row.viewsText ?? '',
        row.dateText ?? '',
        row.unavailable ? 'yes' : '',
      ]
        .map(csvField)
        .join(','),
    );
  }

  return lines.join('\r\n') + '\r\n';
}

export function toMarkdown(rows: PlaylistRow[], playlistTitle: string): string {
  const lines: string[] = [`# ${playlistTitle || 'Playlist'}`, ''];
  lines.push('| # | Title | Duration | Views | Uploaded |');
  lines.push('| :-- | :-- | :-- | :-- | :-- |');

  for (const row of rows) {
    const title = row.unavailable ? `_${row.title || 'Unavailable video'}_` : row.title.replace(/\|/g, '\\|');
    lines.push(
      `| ${row.position} | ${title} | ${row.durationText ?? '—'} | ${row.viewsText ?? '—'} | ${row.dateText ?? '—'} |`,
    );
  }

  const withDuration = rows.filter((r) => r.durationSeconds !== null);
  if (withDuration.length) {
    const total = withDuration.reduce((sum, r) => sum + (r.durationSeconds as number), 0);
    lines.push('', `**Total duration (${withDuration.length} of ${rows.length} rows):** ${formatDuration(total)}`);
  }

  return lines.join('\n') + '\n';
}

const MAX_FILENAME_LENGTH = 120;

/** `{playlist title} - {suffix}.{ext}`, sanitized and capped at 120 characters. */
export function buildFilename(playlistTitle: string, suffix: string, ext: string): string {
  const stripControlChars = (value: string): string =>
    Array.from(value)
      .filter((ch) => {
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

  const suffixExt = `.${ext}`;
  const title = clean(playlistTitle) || 'playlist';
  const tail = clean(suffix);

  let stem = [title, tail].filter(Boolean).join(' - ');
  const budget = MAX_FILENAME_LENGTH - suffixExt.length;
  if (stem.length > budget) stem = stem.slice(0, budget).trimEnd().replace(/[-\s]+$/, '');

  return stem + suffixExt;
}
