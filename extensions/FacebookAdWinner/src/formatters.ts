/**
 * Export layer: CSV and Markdown for the current filtered/sorted results, and
 * for the swipe file (PRD §4: "Export: CSV and Markdown of either the
 * filtered results or the swipe file"). Pure — no DOM, no chrome.* — so
 * scripts/selftest.mjs can check every format headlessly.
 */

import { Collection, ComputedAd, SavedAd } from './types';

function csvCell(value: string | number): string {
  const str = String(value);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function csvRow(cells: Array<string | number>): string {
  return cells.map(csvCell).join(',');
}

/* ── Filtered results (on-page ads, not yet saved) ──────────────────── */

const RESULT_HEADERS = [
  'advertiser',
  'body_text',
  'landing_domain',
  'start_date',
  'days_running',
  'status',
  'variant_count',
  'format',
  'library_url',
];

export function resultsToCsv(ads: ComputedAd[]): string {
  const rows = [csvRow(RESULT_HEADERS)];
  for (const ad of ads) {
    rows.push(
      csvRow([
        ad.advertiser,
        ad.bodyText,
        ad.landingDomain,
        ad.startDate ?? '',
        ad.daysRunning,
        ad.status,
        ad.variantCount,
        ad.format,
        ad.libraryUrl,
      ])
    );
  }
  return rows.join('\r\n') + '\r\n';
}

export function resultsToMarkdown(ads: ComputedAd[], region?: string): string {
  const parts: string[] = ['# Meta Ad Winner — results', ''];
  if (region) parts.push(`_${region}_`, '');
  parts.push(`${ads.length} ad${ads.length === 1 ? '' : 's'}`, '');

  if (!ads.length) {
    parts.push('_No ads matched the current filters._', '');
    return parts.join('\n');
  }

  for (const ad of ads) {
    parts.push(`## ${ad.advertiser || 'Unknown advertiser'}`, '');
    parts.push(
      `🏆 ${ad.daysRunning} day${ad.daysRunning === 1 ? '' : 's'} running · ${ad.variantCount} variant${
        ad.variantCount === 1 ? '' : 's'
      } · ${ad.status === 'active' ? 'still active' : 'stopped'}${ad.format !== 'unknown' ? ` · ${ad.format}` : ''}`,
      ''
    );
    if (ad.bodyText) parts.push(`> ${ad.bodyText.replace(/\n/g, '\n> ')}`, '');
    parts.push(`- Landing domain: ${ad.landingDomain || 'unknown'}`);
    parts.push(`- Started: ${ad.startDate ?? 'unknown'}`);
    parts.push(`- [Ad Library link](${ad.libraryUrl})`, '');
  }

  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

/* ── Swipe file ──────────────────────────────────────────────────────── */

const SWIPE_HEADERS = [
  'advertiser',
  'ad_text',
  'landing_domain',
  'start_date',
  'days_running',
  'variant_count',
  'format',
  'status',
  'collection',
  'note',
  'library_url',
  'saved_at',
];

function collectionName(collections: Collection[], id: string | null): string {
  if (!id) return '';
  return collections.find(c => c.id === id)?.name ?? '';
}

export function swipeFileToCsv(items: SavedAd[], collections: Collection[]): string {
  const rows = [csvRow(SWIPE_HEADERS)];
  for (const item of items) {
    rows.push(
      csvRow([
        item.advertiser,
        item.adText,
        item.landingDomain,
        item.startDate ?? '',
        item.daysRunning,
        item.variantCount,
        item.format,
        item.status,
        collectionName(collections, item.collectionId),
        item.note,
        item.libraryUrl,
        new Date(item.savedAt).toISOString(),
      ])
    );
  }
  return rows.join('\r\n') + '\r\n';
}

export function swipeFileToMarkdown(items: SavedAd[], collections: Collection[]): string {
  const parts: string[] = ['# Meta Ad Winner — swipe file', '', `${items.length} saved ad${items.length === 1 ? '' : 's'}`, ''];

  if (!items.length) {
    parts.push('_Nothing saved yet._', '');
    return parts.join('\n');
  }

  const byCollection = new Map<string, SavedAd[]>();
  for (const item of items) {
    const key = item.collectionId ?? '';
    const list = byCollection.get(key) ?? [];
    list.push(item);
    byCollection.set(key, list);
  }

  const orderedKeys = [...byCollection.keys()].sort((a, b) => {
    if (a === '' || b === '') return a === b ? 0 : a === '' ? 1 : -1; // uncategorized last
    return collectionName(collections, a).localeCompare(collectionName(collections, b));
  });

  for (const key of orderedKeys) {
    const heading = key ? collectionName(collections, key) || 'Untitled collection' : 'Uncategorized';
    parts.push(`## ${heading}`, '');
    for (const item of byCollection.get(key)!) {
      parts.push(`### ${item.advertiser || 'Unknown advertiser'}`, '');
      parts.push(
        `🏆 ${item.daysRunning} day${item.daysRunning === 1 ? '' : 's'} running · ${item.variantCount} variant${
          item.variantCount === 1 ? '' : 's'
        } · ${item.status === 'active' ? 'still active' : 'stopped'}`,
        ''
      );
      if (item.adText) parts.push(`> ${item.adText.replace(/\n/g, '\n> ')}`, '');
      parts.push(`- Landing domain: ${item.landingDomain || 'unknown'}`);
      parts.push(`- Started: ${item.startDate ?? 'unknown'}`);
      if (item.note.trim()) parts.push(`- Note: ${item.note.trim()}`);
      parts.push(`- [Ad Library link](${item.libraryUrl})`, '');
    }
  }

  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

/* ── Filenames ───────────────────────────────────────────────────────── */

/** `{prefix}-{YYYY-MM-DD}.{ext}` — no page title to work with here, unlike the highlighter. */
export function buildFilename(prefix: string, ext: string, now: Date = new Date()): string {
  const stamp = now.toISOString().slice(0, 10);
  const clean = prefix.replace(/[\\/:*?"<>|]/g, '').trim() || 'export';
  return `${clean}-${stamp}.${ext}`;
}
