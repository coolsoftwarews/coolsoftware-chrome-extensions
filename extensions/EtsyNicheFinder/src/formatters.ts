/**
 * The export layer: listings + stats + tags in, CSV or Markdown out.
 * Deliberately pure — no DOM, no chrome.* — so scripts/selftest.mjs can check
 * every format headlessly, same discipline as WebHighlighter's formatters.ts.
 *
 * PRD-20 §4: "Export: CSV/Markdown of listings, the summary, and the tag
 * table." Both formats carry all three sections in one file — a download, not
 * three downloads, per the "downloads not uploads / keep it simple" brief.
 */

import { Filters, Listing, NicheStats, TagTable } from './types';

const MAX_FILENAME_LENGTH = 120;

export interface ExportBundle {
  stats: NicheStats;
  listings: Listing[];
  tags: TagTable;
  filters: Filters;
}

function money(currency: string, value: number | null): string {
  if (value === null) return '—';
  return `${currency}${Number.isInteger(value) ? value : value.toFixed(2)}`;
}

function countLabel(kind: NicheStats['medianCountKind']): string {
  return kind === 'sales' ? 'sales' : kind === 'reviews' ? 'reviews' : 'sales/reviews';
}

function summaryLines(stats: NicheStats): string[] {
  const lines: string[] = [];
  lines.push(
    `Niche read: ${stats.organicListings} listings · ${stats.distinctShops} shops · ` +
      `median ${stats.medianCount ?? '—'} ${countLabel(stats.medianCountKind)} · ` +
      `median price ${money(stats.currency, stats.medianPrice)}`
  );
  lines.push(
    `Concentration: top ${stats.topShops.length} shop${stats.topShops.length === 1 ? '' : 's'} hold ` +
      `${stats.top3Pct === null ? '—' : Math.round(stats.top3Pct)}% of page one`
  );
  lines.push(
    `Price band: ${money(stats.currency, stats.priceBandLow)}–${money(stats.currency, stats.priceBandHigh)} (middle 50%)`
  );
  lines.push(
    `Sample: ${stats.sampleListings} listings from ${stats.samplePages} page${stats.samplePages === 1 ? '' : 's'} ` +
      `(${stats.adListings} ad${stats.adListings === 1 ? '' : 's'} excluded from the stats above)`
  );
  if (stats.mixedCountKinds) {
    lines.push('Note: this page mixes sales counts and review counts — the median above uses whichever is more common and ignores the other.');
  }
  if (stats.currencyMixed) {
    lines.push('Note: multiple currencies appeared on this page — the price stats use the most common one only.');
  }
  if (stats.variablePriceListings) {
    lines.push(`Note: ${stats.variablePriceListings} listing(s) show a variable/personalized price — the low end was used.`);
  }
  if (stats.digitalListings) {
    lines.push(`Note: ${stats.digitalListings} of ${stats.organicListings} listings are digital downloads — a different price norm than physical goods.`);
  }
  return lines;
}

/* ── Markdown ────────────────────────────────────────────────────────── */

export function toMarkdownReport(bundle: ExportBundle): string {
  const { stats, listings, tags } = bundle;
  const parts: string[] = [];

  parts.push(`# Etsy niche read — "${stats.query}"`, '');
  parts.push(`Generated ${new Date(stats.generatedAt).toISOString().slice(0, 10)}.`, '');

  parts.push('## Summary', '');
  for (const line of summaryLines(stats)) parts.push(`- ${line}`);
  parts.push('');

  parts.push('## Listings', '');
  parts.push(`| # | Title | Price | ${countLabel(stats.medianCountKind)} | Shop | Ad | Type |`);
  parts.push('| --- | --- | --- | --- | --- | --- | --- |');
  listings.forEach((l, i) => {
    const kind = l.countKind ? (l.countKind === 'sales' ? 'sales' : 'reviews') : '—';
    parts.push(
      `| ${i + 1} | ${escapeCell(l.title)} | ${money(l.currency || stats.currency, l.price)}${l.priceIsRange ? '+' : ''} | ` +
        `${l.count ?? '—'} ${l.count !== null ? kind : ''} | ${escapeCell(l.shopName)} | ${l.isAd ? 'yes' : ''} | ` +
        `${l.isDigital ? 'digital' : 'physical'} |`
    );
  });
  parts.push('');

  parts.push(`## Tag table (from ${tags.sampleSize} title${tags.sampleSize === 1 ? '' : 's'})`, '');
  if (tags.tags.length) {
    parts.push('| Tag | Count |', '| --- | --- |');
    for (const t of tags.tags) parts.push(`| ${escapeCell(t.tag)} | ${t.count} |`);
  } else {
    parts.push('_No tags — this is a real read, not a search-volume estimate; see README._');
  }
  parts.push('');

  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ').trim();
}

/* ── CSV ─────────────────────────────────────────────────────────────── */

function csvCell(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvRow(values: Array<string | number>): string {
  return values.map(csvCell).join(',');
}

export function toCsvReport(bundle: ExportBundle): string {
  const { stats, listings, tags } = bundle;
  const rows: string[] = [];

  rows.push(csvRow(['Etsy niche read', stats.query]));
  rows.push(csvRow(['Generated', new Date(stats.generatedAt).toISOString()]));
  for (const line of summaryLines(stats)) rows.push(csvRow(['Summary', line]));
  rows.push('');

  rows.push(csvRow(['Listings']));
  rows.push(csvRow(['#', 'Title', 'Price', 'Currency', 'Count', 'Count type', 'Shop', 'Ad', 'Type']));
  listings.forEach((l, i) => {
    rows.push(
      csvRow([
        i + 1,
        l.title,
        l.price ?? '',
        l.currency || stats.currency,
        l.count ?? '',
        l.countKind ?? '',
        l.shopName,
        l.isAd ? 'yes' : 'no',
        l.isDigital ? 'digital' : 'physical',
      ])
    );
  });
  rows.push('');

  rows.push(csvRow(['Tags', `from ${tags.sampleSize} titles`]));
  rows.push(csvRow(['Tag', 'Count']));
  for (const t of tags.tags) rows.push(csvRow([t.tag, t.count]));

  return rows.join('\r\n') + '\r\n';
}

/* ── Filenames ───────────────────────────────────────────────────────── */

/** `etsy-niche - {query}.{ext}`, sanitized and capped at 120 characters. */
export function buildFilename(query: string, ext: string): string {
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
  const label = clean(query) || 'niche';
  let stem = `etsy-niche - ${label}`;
  const budget = MAX_FILENAME_LENGTH - suffix.length;
  if (stem.length > budget) stem = stem.slice(0, budget).trimEnd().replace(/[-\s]+$/, '');

  return stem + suffix;
}
