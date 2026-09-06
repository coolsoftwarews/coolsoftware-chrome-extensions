/**
 * CSV / Markdown writers for the two things PRD §4 says must export: the
 * current result set, and the watchlist's snapshot history. Pure — no DOM,
 * no chrome.* — so scripts/selftest.mjs can check every format headlessly.
 */

import { CategoryStats, ListingSnapshot, ProductWatch, SearchSnapshot, SearchWatch } from './types';

const MAX_FILENAME_LENGTH = 120;

function csvCell(value: string | number | boolean | null): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function csvRow(cells: Array<string | number | boolean | null>): string {
  return cells.map(csvCell).join(',');
}

/* ── Result set ──────────────────────────────────────────────────────── */

const RESULTS_HEADER = [
  'position',
  'asin',
  'title',
  'brand',
  'price',
  'currency',
  'rating',
  'reviews',
  'prime',
  'sponsored',
  'url',
];

export function buildResultsCsv(snapshot: SearchSnapshot): string {
  const rows = [csvRow(RESULTS_HEADER)];
  for (const listing of snapshot.listings) {
    rows.push(
      csvRow([
        listing.position + 1,
        listing.asin,
        listing.title,
        listing.brand,
        listing.price,
        listing.currency,
        listing.rating,
        listing.reviewCount,
        listing.prime === null ? '' : listing.prime,
        listing.sponsored,
        listing.url,
      ])
    );
  }
  return rows.join('\r\n') + '\r\n';
}

function fmtNum(value: number | null, digits = 0): string {
  return value === null ? '—' : value.toFixed(digits).replace(/\.0+$/, '');
}

export function buildResultsMarkdown(snapshot: SearchSnapshot, stats: CategoryStats): string {
  const lines: string[] = [];
  lines.push(`# Amazon Product Opportunity — ${snapshot.query || '(no query)'}`, '');
  lines.push(`- Marketplace: ${snapshot.marketplace}`);
  lines.push(`- Captured: ${snapshot.capturedAt}`);
  lines.push(`- Page: ${snapshot.page}`);
  lines.push(`- URL: ${snapshot.url}`, '');

  lines.push(
    `**Category read:** ${stats.totalListings} results · median ${fmtNum(stats.medianReviews)} reviews · ` +
      `median rating ${fmtNum(stats.medianRating, 1)} · ${stats.distinctBrands} distinct brands ` +
      `(${stats.sponsoredExcluded} sponsored excluded)`
  );
  lines.push(
    `**Moat:** ${stats.moat} · **Rating ceiling:** ${stats.ratingCeiling.label} ` +
      `(${stats.ratingCeiling.underThreshold} of ${stats.ratingCeiling.sample} top results under ${stats.ratingCeiling.threshold}) · ` +
      `**Concentration:** ${stats.concentration.label}` +
      (stats.concentration.topBrand
        ? ` (top brand: ${stats.concentration.topBrand}, ${Math.round((stats.concentration.topBrandShare ?? 0) * 100)}% of listings)`
        : '')
  );
  lines.push('');

  lines.push('| # | ASIN | Title | Brand | Price | Rating | Reviews | Prime | Sponsored |');
  lines.push('| --: | :-- | :-- | :-- | --: | --: | --: | :-- | :-- |');
  for (const listing of snapshot.listings) {
    lines.push(
      `| ${listing.position + 1} | ${listing.asin} | ${mdEscape(listing.title)} | ${mdEscape(listing.brand ?? '—')} | ` +
        `${listing.priceRaw ?? '—'} | ${fmtNum(listing.rating, 1)} | ${listing.reviewCount ?? '—'} | ` +
        `${listing.prime === null ? '—' : listing.prime ? 'yes' : 'no'} | ${listing.sponsored ? 'yes' : 'no'} |`
    );
  }
  lines.push('');
  return lines.join('\n');
}

function mdEscape(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ').trim();
}

/* ── Watchlist ───────────────────────────────────────────────────────── */

export function buildWatchlistCsv(searchWatches: SearchWatch[], productWatches: ProductWatch[]): string {
  const rows = [csvRow(['type', 'key', 'label', 'captured', 'value_1', 'value_2', 'value_3', 'value_4'])];

  for (const watch of searchWatches) {
    for (const snap of watch.snapshots) {
      rows.push(
        csvRow([
          'search',
          watch.key,
          watch.query,
          snap.capturedAt,
          snap.resultCount,
          snap.medianReviews,
          snap.medianRating,
          snap.distinctBrands,
        ])
      );
    }
  }

  for (const watch of productWatches) {
    for (const snap of watch.snapshots) {
      rows.push(
        csvRow(['product', watch.asin, watch.title, snap.capturedAt, snap.price, snap.rating, snap.reviewCount, snap.prime])
      );
    }
  }

  return rows.join('\r\n') + '\r\n';
}

export function buildWatchlistMarkdown(searchWatches: SearchWatch[], productWatches: ProductWatch[]): string {
  const lines: string[] = ['# Amazon Product Opportunity — Watchlist', ''];

  if (searchWatches.length) {
    lines.push('## Watched searches', '');
    for (const watch of searchWatches) {
      lines.push(`### ${watch.query} — ${watch.marketplace}`, '');
      lines.push('| Captured | Results | Median reviews | Median rating | Brands |');
      lines.push('| :-- | --: | --: | --: | --: |');
      for (const snap of watch.snapshots) {
        lines.push(
          `| ${snap.capturedAt} | ${snap.resultCount} | ${fmtNum(snap.medianReviews)} | ${fmtNum(snap.medianRating, 1)} | ${snap.distinctBrands} |`
        );
      }
      lines.push('');
    }
  }

  if (productWatches.length) {
    lines.push('## Watched products', '');
    for (const watch of productWatches) {
      lines.push(`### ${mdEscape(watch.title)} (${watch.asin})`, '');
      lines.push('| Captured | Price | Rating | Reviews | Prime |');
      lines.push('| :-- | --: | --: | --: | :-- |');
      for (const snap of watch.snapshots) {
        lines.push(
          `| ${snap.capturedAt} | ${snap.price ?? '—'} | ${fmtNum(snap.rating, 1)} | ${snap.reviewCount ?? '—'} | ` +
            `${snap.prime === null ? '—' : snap.prime ? 'yes' : 'no'} |`
        );
      }
      lines.push('');
    }
  }

  if (!searchWatches.length && !productWatches.length) {
    lines.push('_Nothing watched yet._', '');
  }

  return lines.join('\n');
}

/* ── Filenames ───────────────────────────────────────────────────────── */

function stripControlChars(value: string): string {
  return Array.from(value)
    .filter(ch => {
      const code = ch.codePointAt(0) ?? 0;
      return code >= 32 && code !== 127;
    })
    .join('');
}

function cleanFilenamePart(value: string): string {
  return stripControlChars(value)
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\.+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildFilename(parts: Array<string | null | undefined>, ext: string): string {
  const suffix = `.${ext}`;
  let stem = parts.map(p => cleanFilenamePart(p ?? '')).filter(Boolean).join(' - ') || 'amazon-opportunity';
  const budget = MAX_FILENAME_LENGTH - suffix.length;
  if (stem.length > budget) stem = stem.slice(0, budget).trimEnd().replace(/[-\s]+$/, '');
  return stem + suffix;
}
