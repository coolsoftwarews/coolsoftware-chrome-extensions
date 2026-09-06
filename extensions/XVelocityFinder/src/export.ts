/**
 * CSV and Markdown export of the filtered set (PRD §4: "author, text, metrics,
 * velocity, ratio, age, link"). Pure — no DOM, no chrome.* — so selftest.mjs
 * can check the exact bytes. Downloads, never uploads: this only ever
 * produces a string that content.ts turns into a data: URL for
 * chrome.downloads.
 */

import { ageLabel } from './velocity';
import { Post } from './types';

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const CSV_HEADER = ['author', 'text', 'likes', 'reposts', 'replies', 'velocity_per_hour', 'outlier_ratio', 'age', 'link'];

export function toCsv(posts: Post[]): string {
  const rows = posts.map(post => [
    `@${post.authorHandle}`,
    post.textPreview.replace(/\s+/g, ' ').trim(),
    post.likes?.value ?? '',
    post.reposts?.value ?? '',
    post.replies?.value ?? '',
    post.velocityPerHour !== null ? Math.round(post.velocityPerHour * 10) / 10 : '',
    post.outlierRatio !== null ? Math.round(post.outlierRatio * 10) / 10 : '',
    post.ageMs !== null ? ageLabel(post.ageMs) : '',
    post.url,
  ]);
  const lines = [CSV_HEADER, ...rows].map(row => row.map(csvCell).join(','));
  return lines.join('\r\n') + '\r\n';
}

export function toMarkdown(posts: Post[]): string {
  const lines: string[] = [
    '# X Velocity Finder export',
    '',
    `_${posts.length} post${posts.length === 1 ? '' : 's'} · velocity = (likes + reposts + replies) ÷ hours since posting_`,
    '',
    '| Author | Velocity | Ratio | Age | Text | Link |',
    '| :-- | --: | --: | --: | :-- | :-- |',
  ];

  for (const post of posts) {
    const text = post.textPreview.replace(/\s+/g, ' ').trim().replace(/\|/g, '\\|');
    const velocity = post.velocityPerHour !== null ? `${Math.round(post.velocityPerHour * 10) / 10}/h` : '—';
    const ratio = post.outlierRatio !== null ? `${(Math.round(post.outlierRatio * 10) / 10).toFixed(1)}×` : '—';
    const age = post.ageMs !== null ? ageLabel(post.ageMs) : '—';
    lines.push(`| @${post.authorHandle} | ${velocity} | ${ratio} | ${age} | ${text} | [link](${post.url}) |`);
  }

  return lines.join('\n') + '\n';
}

/** `x-velocity-{scope}-{yyyy-mm-dd}.{ext}` */
export function buildFilename(scope: 'timeline' | 'search', ext: 'csv' | 'md', now = new Date()): string {
  const date = now.toISOString().slice(0, 10);
  return `x-velocity-${scope}-${date}.${ext}`;
}

/**
 * Encodes export text as a data: URL — content scripts cannot use
 * chrome.downloads directly, so this is what background.ts hands to it.
 * `btoa` only accepts Latin1, so UTF-8 bytes are escaped through it first;
 * that round-trips any post text, emoji included. Node 18+ (used by
 * scripts/selftest.mjs) provides the same globals, so this needs no
 * platform branch.
 */
export function toDataUrl(text: string, mime: string): string {
  const base64 = btoa(unescape(encodeURIComponent(text)));
  return `data:${mime};charset=utf-8;base64,${base64}`;
}
