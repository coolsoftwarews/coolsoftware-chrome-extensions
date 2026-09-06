/**
 * The export layer: CSV and Markdown, per PRD §4 ("Export: CSV/Markdown" —
 * no PDF in this product's scope). Deliberately pure — no DOM, no chrome.* —
 * so scripts/selftest.mjs can check both formats headlessly.
 */

import { Opportunity } from './types';

function csvCell(value: string | number | null): string {
  const text = value === null ? '' : String(value);
  // Quote whenever the cell could be mistaken for a delimiter or a new row.
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

const CSV_COLUMNS = [
  'Status',
  'Subreddit',
  'Title',
  'Matched rules',
  'Matched on',
  'Score',
  'Comments',
  'Posted',
  'Permalink',
  'Note',
  'Snippet',
  'Captured at',
] as const;

function ruleNames(item: Opportunity): string {
  return [...new Set(item.matches.map(m => m.ruleName))].join('; ');
}

function matchedOn(item: Opportunity): string {
  return item.matches.map(m => `"${m.matchPhrase}" + "${m.topicWord}"`).join('; ');
}

export function toCsv(items: Opportunity[]): string {
  const rows = [CSV_COLUMNS.join(',')];
  for (const item of items) {
    rows.push(
      [
        item.status,
        `r/${item.subreddit}`,
        item.title,
        ruleNames(item),
        matchedOn(item),
        item.score ?? '',
        item.numComments ?? '',
        item.postedAtLabel ?? '',
        item.permalink,
        item.note,
        item.snippet,
        new Date(item.capturedAt).toISOString(),
      ]
        .map(csvCell)
        .join(',')
    );
  }
  // \r\n is the CSV spec's line ending and what spreadsheet apps expect.
  return rows.join('\r\n') + '\r\n';
}

const STATUS_LABEL: Record<Opportunity['status'], string> = {
  new: 'New',
  replied: 'Replied',
  dismissed: 'Dismissed',
};

export function toMarkdown(items: Opportunity[]): string {
  const parts: string[] = ['# Reddit opportunities', ''];

  if (!items.length) {
    parts.push('_No matched threads yet._', '');
    return parts.join('\n');
  }

  parts.push(`${items.length} matched thread${items.length === 1 ? '' : 's'}, most recently captured first.`, '');

  for (const item of items) {
    parts.push(`## r/${item.subreddit} — ${item.title || 'Untitled post'}`);
    parts.push('');
    parts.push(`- **Status:** ${STATUS_LABEL[item.status]}`);
    parts.push(`- **Matched:** ${matchedOn(item) || '—'}`);
    if (item.score !== null) parts.push(`- **Score:** ${item.score}`);
    if (item.numComments !== null) parts.push(`- **Comments:** ${item.numComments}`);
    if (item.postedAtLabel) parts.push(`- **Posted:** ${item.postedAtLabel}`);
    parts.push(`- **Link:** <${item.permalink}>`);
    parts.push(`- **Captured:** ${new Date(item.capturedAt).toISOString().slice(0, 10)}`);
    parts.push('');
    if (item.snippet.trim()) {
      parts.push(
        item.snippet
          .trim()
          .split('\n')
          .map(line => `> ${line}`)
          .join('\n')
      );
      parts.push('');
    }
    if (item.note.trim()) {
      parts.push(`**Note:** ${item.note.trim()}`);
      parts.push('');
    }
  }

  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

/** `reddit-opportunities-{scope}-{date}.{ext}` */
export function buildFilename(ext: 'csv' | 'md', scope: string, date = new Date()): string {
  const stamp = date.toISOString().slice(0, 10);
  const cleanScope = scope
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const suffix = cleanScope ? `-${cleanScope}` : '';
  return `reddit-opportunities${suffix}-${stamp}.${ext}`;
}
