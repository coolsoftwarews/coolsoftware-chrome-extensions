/**
 * The export layer (README "Shared modules": Export layer). One row of
 * computed product stats in, a CSV or Markdown file out. Pure — no DOM, no
 * chrome.* — so scripts/selftest.mjs can check the exact bytes.
 *
 * PRD §4: "Export: CSV (product, creators, videos, views, ratios, dates,
 * links) and Markdown summary." One row per product, because that is the
 * unit sellers actually act on — a video-level export would bury the signal
 * (repetition across creators) inside a spreadsheet the size of the board.
 */

import { buildVideoUrl } from './parse';
import { ProductStats } from './types';

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function isoDate(ms: number | null): string {
  return ms === null ? '' : new Date(ms).toISOString().slice(0, 10);
}

function totalViews(stats: ProductStats): number {
  return stats.visibleVideos.reduce((sum, v) => sum + (v.views ?? 0), 0);
}

export const CSV_HEADER = [
  'product',
  'group_type',
  'distinct_creators',
  'videos',
  'total_views',
  'median_outlier_ratio',
  'first_seen',
  'last_seen',
  'source_links',
];

export function toCsv(rows: ProductStats[]): string {
  const lines = [CSV_HEADER.join(',')];

  for (const stats of rows) {
    const links = stats.visibleVideos.map(v => v.url || buildVideoUrl(v.creatorHandle, v.id)).join(' | ');
    lines.push(
      [
        csvCell(stats.product.name),
        csvCell(stats.product.groupType),
        String(stats.distinctCreators),
        String(stats.visibleVideos.length),
        String(totalViews(stats)),
        stats.medianRatio === null ? '' : stats.medianRatio.toFixed(2),
        isoDate(stats.firstSeen),
        isoDate(stats.lastSeen),
        csvCell(links),
      ].join(',')
    );
  }

  return lines.join('\n') + '\n';
}

export function toMarkdownSummary(rows: ProductStats[], generatedAt: number = Date.now()): string {
  const parts: string[] = [
    '# TikTok Product Scout — board summary',
    '',
    `Generated ${new Date(generatedAt).toISOString().slice(0, 10)} · ${rows.length} product${rows.length === 1 ? '' : 's'}`,
    '',
  ];

  if (!rows.length) {
    parts.push('_No products match the current filters._', '');
    return parts.join('\n');
  }

  for (const stats of rows) {
    parts.push(`## ${stats.product.name}`, '');
    parts.push(
      `**${stats.distinctCreators} distinct creator${stats.distinctCreators === 1 ? '' : 's'}** · ` +
        `${stats.visibleVideos.length} video${stats.visibleVideos.length === 1 ? '' : 's'} · ` +
        `median ratio ${stats.medianRatio === null ? 'pending' : `${stats.medianRatio.toFixed(1)}×`} · ` +
        `${isoDate(stats.firstSeen)} → ${isoDate(stats.lastSeen)}`
    );
    if (stats.pendingBaselines) {
      parts.push('', `_${stats.pendingBaselines} video(s) awaiting a creator baseline — visit their profile to resolve._`);
    }
    parts.push('', 'Source videos:');
    for (const video of stats.visibleVideos) {
      const url = video.url || buildVideoUrl(video.creatorHandle, video.id);
      const views = video.views === null ? 'views unknown' : `${video.views.toLocaleString('en-US')} views`;
      parts.push(`- [${video.creatorHandle}](${url}) — ${views}`);
    }
    parts.push('');
  }

  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

/** `tiktok-product-scout-{yyyy-mm-dd}.{ext}` — no per-product filenames, since the export is always the whole board. */
export function buildFilename(ext: string, now: number = Date.now()): string {
  return `tiktok-product-scout-${new Date(now).toISOString().slice(0, 10)}.${ext}`;
}
