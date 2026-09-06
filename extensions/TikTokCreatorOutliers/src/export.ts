/**
 * CSV and Markdown export of the filtered set — PRD §4: "this is what gets
 * pasted into a scripting doc, so it's the export that matters." Includes the
 * hook column. Pure, DOM-free.
 */

import { formatRatio } from './outlier';
import { OutlierVideo } from './types';

const MAX_FILENAME_LENGTH = 120;

function csvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function isoDate(ms: number | null): string {
  if (ms === null) return '';
  return new Date(ms).toISOString().slice(0, 10);
}

export function toCsv(videos: OutlierVideo[]): string {
  const header = ['Rank', 'Ratio', 'Views', 'Posted', 'Duration (s)', 'Pinned', 'Hook', 'URL'];
  const rows = videos.map((video, index) => [
    String(index + 1),
    formatRatio(video),
    video.views !== null ? String(video.views) : '',
    isoDate(video.postedAt),
    video.durationSeconds !== null ? String(video.durationSeconds) : '',
    video.pinned ? 'yes' : '',
    video.captionFirstLine ?? '',
    video.href,
  ]);
  return [header, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export function toMarkdown(profileId: string, median: number | null, sampleSize: number, videos: OutlierVideo[]): string {
  const parts: string[] = [];
  parts.push(`# TikTok outliers — ${profileId}`, '');
  parts.push(
    median !== null
      ? `Median: ${median.toLocaleString('en-US')} views (of ${sampleSize} loaded)`
      : `Median: not enough data (of ${sampleSize} loaded)`,
    ''
  );

  if (!videos.length) {
    parts.push('_No videos match the current filters._', '');
    return parts.join('\n');
  }

  parts.push('| Rank | Ratio | Views | Posted | Hook |', '| --: | --: | --: | :-- | :-- |');
  videos.forEach((video, index) => {
    const hook = (video.captionFirstLine ?? '').replace(/\|/g, '\\|');
    parts.push(
      `| ${index + 1} | ${formatRatio(video)} | ${video.views !== null ? video.views.toLocaleString('en-US') : '—'} | ${isoDate(video.postedAt) || '—'} | ${hook || '—'} [↗](${video.href}) |`
    );
  });
  parts.push('');

  return parts.join('\n');
}

/** `{profileId} - tiktok-outliers - {date}.{ext}`, sanitized and capped. */
export function buildFilename(profileId: string, ext: string, date = new Date()): string {
  const clean = (value: string): string =>
    value
      .replace(/[\\/:*?"<>|]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

  const suffix = `.${ext}`;
  const stamp = date.toISOString().slice(0, 10);
  let stem = clean(`${profileId} - tiktok-outliers - ${stamp}`);
  const budget = MAX_FILENAME_LENGTH - suffix.length;
  if (stem.length > budget) stem = stem.slice(0, budget).trimEnd();

  return stem + suffix;
}
