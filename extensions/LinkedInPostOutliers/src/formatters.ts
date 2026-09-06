/**
 * CSV and Markdown export of the visible set (PRD §4): author, profile URL,
 * post URL, post type, date, reactions, comments, reposts, engagement,
 * ratio, repost flag. Pure — no DOM, no chrome.* — exercised directly by
 * scripts/selftest.mjs.
 */

import { PageMode, ScoredPost } from './types';

const CSV_COLUMNS = [
  'author',
  'authorProfileUrl',
  'postUrl',
  'postType',
  'date',
  'reactions',
  'comments',
  'reposts',
  'engagement',
  'ratio',
  'isRepost',
] as const;
const MAX_FILENAME_LENGTH = 120;

function isoDate(ms: number | null): string {
  return ms === null ? '' : new Date(ms).toISOString().slice(0, 10);
}

function numOrBlank(value: number | null): string {
  return value === null ? '' : String(value);
}

function ratioText(post: ScoredPost): string {
  return post.ratio === null ? '' : `${post.ratio.toFixed(2)}x`;
}

function rowValues(post: ScoredPost): string[] {
  return [
    post.authorName,
    post.authorId,
    post.url,
    post.postType,
    isoDate(post.postedAt),
    numOrBlank(post.reactions),
    numOrBlank(post.comments),
    numOrBlank(post.reposts),
    numOrBlank(post.engagement),
    ratioText(post),
    post.isRepost ? 'yes' : 'no',
  ];
}

/* ── CSV ─────────────────────────────────────────────────────────────── */

function csvCell(value: string): string {
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

export function toMarkdown(title: string, mode: PageMode, posts: ScoredPost[]): string {
  const parts: string[] = [`# ${title} — post outliers`, ''];

  const modeLabel =
    mode === 'profile'
      ? 'Each post scored against this author’s own recent median (reactions + comments).'
      : 'Each post scored against its own author’s recent median where enough of their posts are visible or cached; others show as pending.';
  parts.push(modeLabel, '', `${posts.length} post${posts.length === 1 ? '' : 's'} in this export`, '');

  parts.push('| Author | Post URL | Type | Date | Reactions | Comments | Reposts | Engagement | Ratio | Repost |');
  parts.push('| :-- | :-- | :-- | :-- | --: | --: | --: | --: | --: | :-- |');
  for (const post of posts) {
    const [author, , url, type, date, reactions, comments, reposts, engagement, ratio, isRepost] = rowValues(post);
    parts.push(
      `| ${escapePipe(author)} | ${escapePipe(url)} | ${type} | ${date} | ${reactions} | ${comments} | ${reposts} | ${engagement} | ${escapePipe(ratio)} | ${isRepost} |`
    );
  }

  return parts.join('\n').trimEnd() + '\n';
}

/* ── Filenames ───────────────────────────────────────────────────────── */

/** `{slug}-outliers-{yyyy-mm-dd}.{ext}`, sanitized and capped at 120 characters. */
export function buildFilename(slug: string, ext: string, now = new Date()): string {
  const clean = slug.replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 60) || 'linkedin';
  const stamp = now.toISOString().slice(0, 10);
  const name = `${clean}-outliers-${stamp}.${ext}`;
  return name.length > MAX_FILENAME_LENGTH ? name.slice(0, MAX_FILENAME_LENGTH) : name;
}
