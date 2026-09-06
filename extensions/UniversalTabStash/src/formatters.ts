/**
 * Export layer: a stash (or every stash) in, a Markdown reading list or CSV
 * out. Deliberately pure — no DOM, no chrome.* — so scripts/selftest.mjs can
 * check every format headlessly.
 */

import { Stash } from './types';

const MAX_FILENAME_LENGTH = 120;

function formatDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/* ── Markdown ────────────────────────────────────────────────────────── */

function stashToMarkdownSection(stash: Stash): string[] {
  const lines: string[] = [`## ${stash.name}`, ''];
  lines.push(`_${stash.tabs.length} tab${stash.tabs.length === 1 ? '' : 's'} · stashed ${formatDate(stash.createdAt)}_`);
  lines.push('');
  if (stash.notes.trim()) {
    lines.push(stash.notes.trim(), '');
  }
  if (!stash.tabs.length) {
    lines.push('_No tabs in this stash._', '');
  }
  for (const tab of stash.tabs) {
    const pinned = tab.pinned ? ' *(pinned)*' : '';
    lines.push(`- [${tab.title || tab.url}](${tab.url})${pinned}`);
  }
  lines.push('');
  return lines;
}

/** Markdown reading list for a single stash. */
export function toMarkdown(stash: Stash): string {
  return stashToMarkdownSection(stash).join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

/** Markdown reading list covering every stash, one section each. */
export function toMarkdownAll(stashes: Stash[]): string {
  const parts: string[] = ['# Tab Stash — Reading List', ''];
  if (!stashes.length) {
    parts.push('_No stashes yet._', '');
  }
  for (const stash of stashes) {
    parts.push(...stashToMarkdownSection(stash));
  }
  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

/* ── CSV ─────────────────────────────────────────────────────────────── */

function csvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

const CSV_HEADER = ['stash', 'title', 'url', 'pinned', 'stash_created', 'notes'];

function stashToCsvRows(stash: Stash): string[] {
  return stash.tabs.map(tab =>
    [
      stash.name,
      tab.title,
      tab.url,
      tab.pinned ? 'true' : 'false',
      formatDate(stash.createdAt),
      stash.notes,
    ]
      .map(csvCell)
      .join(',')
  );
}

/** CSV for a single stash. */
export function toCsv(stash: Stash): string {
  return [CSV_HEADER.join(','), ...stashToCsvRows(stash)].join('\r\n') + '\r\n';
}

/** CSV covering every stash, one row per stashed tab. */
export function toCsvAll(stashes: Stash[]): string {
  const rows = stashes.flatMap(stashToCsvRows);
  return [CSV_HEADER.join(','), ...rows].join('\r\n') + '\r\n';
}

/* ── Filenames ───────────────────────────────────────────────────────── */

/** `{stash name}.{ext}`, sanitized and capped at 120 characters — same
 *  convention as the rest of the portfolio (see WebHighlighter's formatters). */
export function buildFilename(name: string, ext: string): string {
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
  let stem = clean(name) || 'tab-stash';
  const budget = MAX_FILENAME_LENGTH - suffix.length;
  if (stem.length > budget) stem = stem.slice(0, budget).trimEnd().replace(/[-\s]+$/, '');

  return stem + suffix;
}
