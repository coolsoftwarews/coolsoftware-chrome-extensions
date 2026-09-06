/**
 * The export layer: quotes + themes in, three documents out. Deliberately
 * pure — no DOM, no chrome.* — so scripts/selftest.mjs can check every
 * format headlessly, same split as WebHighlighter's formatters.ts.
 */

import { buildBackup } from './backup';
import { Quote, Theme, UNCATEGORIZED_THEME } from './types';

export interface ThemeGroup {
  theme: Theme;
  quotes: Quote[];
}

/** Quotes grouped by theme, in theme order, with a trailing Uncategorized
 * bucket for anything whose theme is empty or was since deleted. Empty
 * groups are dropped — an empty theme is noise in an export. */
export function groupByTheme(quotes: Quote[], themes: Theme[]): ThemeGroup[] {
  const knownIds = new Set(themes.map(t => t.id));
  const buckets = new Map<string, Quote[]>();
  for (const quote of quotes) {
    const key = knownIds.has(quote.themeId) ? quote.themeId : '';
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(quote);
  }

  const ordered: ThemeGroup[] = [];
  for (const theme of themes) {
    const list = buckets.get(theme.id);
    if (list?.length) ordered.push({ theme, quotes: [...list].sort((a, b) => a.createdAt - b.createdAt) });
  }
  const uncategorized = buckets.get('');
  if (uncategorized?.length) {
    ordered.push({ theme: UNCATEGORIZED_THEME, quotes: [...uncategorized].sort((a, b) => a.createdAt - b.createdAt) });
  }
  return ordered;
}

export interface ThemeStat {
  id: string;
  name: string;
  count: number;
}

export function statsByTheme(quotes: Quote[], themes: Theme[]): ThemeStat[] {
  return groupByTheme(quotes, themes).map(g => ({ id: g.theme.id, name: g.theme.name, count: g.quotes.length }));
}

export interface SubredditStat {
  subreddit: string;
  count: number;
}

/** "19 pain quotes, 12 from r/freelance" is itself a finding (PRD §4). */
export function statsBySubreddit(quotes: Quote[]): SubredditStat[] {
  const counts = new Map<string, number>();
  for (const q of quotes) {
    const key = q.subreddit || 'Unknown subreddit';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([subreddit, count]) => ({ subreddit, count }))
    .sort((a, b) => b.count - a.count || a.subreddit.localeCompare(b.subreddit));
}

function citation(quote: Quote): string {
  const who = quote.author ? `u/${quote.author}` : 'anonymous';
  const where = quote.subreddit || 'unknown subreddit';
  const title = quote.threadTitle || 'thread';
  return quote.permalink ? `${who} in ${where} — [${title}](${quote.permalink})` : `${who} in ${where} — ${title}`;
}

/** The primary artifact (PRD §4): grouped by theme, each quote with its
 * citation link — this is what gets pasted into a messaging doc. */
export function toMarkdown(quotes: Quote[], themes: Theme[]): string {
  const groups = groupByTheme(quotes, themes);
  const parts: string[] = ['# Reddit Voice-of-Customer', ''];

  if (!groups.length) {
    parts.push('_No quotes saved yet._', '');
    return parts.join('\n').trimEnd() + '\n';
  }

  for (const group of groups) {
    parts.push(`## ${group.theme.name} (${group.quotes.length})`, '');
    for (const quote of group.quotes) {
      const block = quote.quote
        .trim()
        .split('\n')
        .map(line => `> ${line}`)
        .join('\n');
      parts.push(block, '');
      parts.push(`— ${citation(quote)}`);
      if (quote.note.trim()) parts.push('', `Note: ${quote.note.trim()}`);
      parts.push('');
    }
  }

  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

function csvField(value: string): string {
  const needsQuoting = /[",\n\r]/.test(value);
  const escaped = value.replace(/"/g, '""');
  return needsQuoting ? `"${escaped}"` : escaped;
}

const CSV_COLUMNS = [
  'theme',
  'quote',
  'note',
  'author',
  'subreddit',
  'thread_title',
  'permalink',
  'thread_url',
  'score',
  'posted_at',
  'saved_at',
] as const;

/** For the spreadsheet workflow this product replaces (PRD §4). */
export function toCsv(quotes: Quote[], themes: Theme[]): string {
  const nameById = new Map(themes.map(t => [t.id, t.name]));
  const rows = [CSV_COLUMNS.join(',')];

  for (const q of [...quotes].sort((a, b) => a.createdAt - b.createdAt)) {
    const row = [
      nameById.get(q.themeId) ?? UNCATEGORIZED_THEME.name,
      q.quote,
      q.note,
      q.author,
      q.subreddit,
      q.threadTitle,
      q.permalink,
      q.threadUrl,
      q.score === null ? '' : String(q.score),
      q.postedAt,
      new Date(q.createdAt).toISOString(),
    ].map(csvField);
    rows.push(row.join(','));
  }

  return rows.join('\r\n') + '\r\n';
}

/** Full backup, re-importable — the same shape storage.ts writes for "export
 * all data" (PRD §4/§6 are the same button). */
export function toJson(quotes: Quote[], themes: Theme[], exportedAt = new Date().toISOString()): string {
  return JSON.stringify(buildBackup(quotes, themes, exportedAt), null, 2);
}

export type ExportKind = 'md' | 'csv' | 'json';

export function buildFilename(kind: ExportKind, date = new Date()): string {
  const stamp = date.toISOString().slice(0, 10);
  return `reddit-voice-of-customer-${stamp}.${kind}`;
}
