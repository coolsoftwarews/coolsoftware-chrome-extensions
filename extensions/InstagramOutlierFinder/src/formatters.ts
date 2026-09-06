/**
 * CSV and Markdown export of the visible set (PRD §4): URL, type, date,
 * views, likes, comments, ratio. Pure — no DOM, no chrome.* — exercised
 * directly by scripts/selftest.mjs.
 */

import { formatCompact } from './outlier';
import { ProfileStats, ScoredPost } from './types';

const CSV_COLUMNS = ['url', 'type', 'date', 'views', 'likes', 'comments', 'ratio'] as const;
const MAX_FILENAME_LENGTH = 120;

function isoDate(ms: number | null): string {
  return ms === null ? '' : new Date(ms).toISOString().slice(0, 10);
}

function ratioText(post: ScoredPost): string {
  if (post.ratio === null) return '';
  const label = post.metricSource === 'likes' ? ' likes' : '';
  return `${post.ratio.toFixed(2)}x${label}`;
}

function rowValues(post: ScoredPost): string[] {
  return [
    post.url,
    post.kind,
    isoDate(post.takenAt),
    post.views === null ? '' : String(post.views),
    post.likes === null ? '' : String(post.likes),
    post.comments === null ? '' : String(post.comments),
    ratioText(post),
  ];
}

/* ── CSV ─────────────────────────────────────────────────────────────── */

function csvCell(value: string): string {
  // Quote whenever a comma, quote or newline could otherwise corrupt a column.
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function toCsv(posts: ScoredPost[]): string {
  const lines = [CSV_COLUMNS.join(',')];
  for (const post of posts) lines.push(rowValues(post).map(csvCell).join(','));
  return lines.join('\r\n') + '\r\n';
}

/* ── Markdown ────────────────────────────────────────────────────────── */

function escapePipe(value: string): string {
  return value.replace(/\|/g, '\\|');
}

export function toMarkdown(handle: string, posts: ScoredPost[], stats: ProfileStats): string {
  const parts: string[] = [`# @${handle} — content outliers`, ''];

  const medianLine =
    stats.viewsMedian !== null
      ? `Recent median: ${formatCompact(stats.viewsMedian)} views (${stats.viewsSampleSize} loaded posts)`
      : stats.likesMedian !== null
        ? `Recent median: ${formatCompact(stats.likesMedian)} likes (${stats.likesSampleSize} loaded posts)`
        : 'Recent median: not enough data yet';
  parts.push(medianLine);

  if (!stats.reliable) {
    parts.push('_Keep scrolling for a reliable median — fewer than 12 posts loaded so far._');
  }
  if (stats.dateRangeStart !== null && stats.dateRangeEnd !== null) {
    parts.push(`Date range covered: ${isoDate(stats.dateRangeStart)} – ${isoDate(stats.dateRangeEnd)}`);
  }
  parts.push('', `${posts.length} post${posts.length === 1 ? '' : 's'} in this export`, '');

  parts.push('| URL | Type | Date | Views | Likes | Comments | Ratio |');
  parts.push('| :-- | :-- | :-- | --: | --: | --: | --: |');
  for (const post of posts) {
    const [url, type, date, views, likes, comments, ratio] = rowValues(post);
    parts.push(
      `| ${escapePipe(url)} | ${type} | ${date} | ${views} | ${likes} | ${comments} | ${escapePipe(ratio)} |`
    );
  }

  return parts.join('\n').trimEnd() + '\n';
}

/* ── Filenames ───────────────────────────────────────────────────────── */

/** `{handle}-outliers-{yyyy-mm-dd}.{ext}`, sanitized and capped at 120 characters. */
export function buildFilename(handle: string, ext: string, now = new Date()): string {
  const clean = handle.replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 60) || 'profile';
  const stamp = now.toISOString().slice(0, 10);
  const name = `${clean}-outliers-${stamp}.${ext}`;
  return name.length > MAX_FILENAME_LENGTH ? name.slice(0, MAX_FILENAME_LENGTH) : name;
}
