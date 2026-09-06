/**
 * Export layer: CSV and Markdown over a list of library items (PRD §4). Pure
 * — no DOM, no chrome.* — so scripts/selftest.mjs covers every format
 * headlessly. Same RFC 4180 quoting and filename convention as
 * WebHighlighter/LinkedInLeadFinder.
 */

import { LibraryItem } from './types';

const MAX_FILENAME_LENGTH = 120;

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

const KIND_LABEL: Record<LibraryItem['kind'], string> = {
  draft: 'Draft',
  template: 'Template',
  published: 'Published',
};

/* ── CSV ─────────────────────────────────────────────────────────────── */

/** RFC 4180: quote whenever the field contains a comma, quote or newline; double up internal quotes. */
export function csvCell(value: string | number | boolean | null | undefined): string {
  const text = value === null || value === undefined ? '' : String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

const CSV_COLUMNS = ['Type', 'Text', 'Tags', 'Post URL', 'Published', 'Created', 'Updated'] as const;

export function toCsv(items: LibraryItem[]): string {
  const rows = [CSV_COLUMNS.join(',')];

  for (const item of items) {
    rows.push(
      [
        csvCell(KIND_LABEL[item.kind]),
        csvCell(item.text),
        csvCell(item.tags.join('; ')),
        csvCell(item.postUrl ?? ''),
        csvCell(item.publishedAtLabel ?? ''),
        csvCell(isoDate(item.createdAt)),
        csvCell(isoDate(item.updatedAt)),
      ].join(',')
    );
  }

  return rows.join('\r\n') + '\r\n';
}

/* ── Markdown ────────────────────────────────────────────────────────── */

export function toMarkdown(items: LibraryItem[]): string {
  if (!items.length) return '# LinkedIn Post Draft Bank\n\nNothing saved yet.\n';

  const parts: string[] = [
    '# LinkedIn Post Draft Bank',
    '',
    `Exported ${isoDate(Date.now())} · ${items.length} item${items.length === 1 ? '' : 's'}`,
    '',
  ];

  for (const item of items) {
    parts.push(`## ${KIND_LABEL[item.kind]}${item.tags.length ? ` — ${item.tags.join(', ')}` : ''}`);
    if (item.kind === 'published' && item.publishedAtLabel) parts.push(`Published ${item.publishedAtLabel}`);
    if (item.postUrl) parts.push(item.postUrl);
    parts.push('');
    for (const line of item.text.split('\n')) parts.push(`> ${line}`);
    parts.push('');
  }

  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

/* ── Filenames ───────────────────────────────────────────────────────── */

function sanitizeStem(value: string): string {
  return Array.from(value)
    .filter(ch => {
      const code = ch.codePointAt(0) ?? 0;
      return code >= 32 && code !== 127;
    })
    .join('')
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildFilename(prefix: string, ext: string, when = new Date()): string {
  const date = when.toISOString().slice(0, 10);
  let stem = sanitizeStem(`${prefix} ${date}`);
  const suffix = `.${ext}`;
  const budget = MAX_FILENAME_LENGTH - suffix.length;
  if (stem.length > budget) stem = stem.slice(0, budget).trimEnd();
  return stem + suffix;
}
