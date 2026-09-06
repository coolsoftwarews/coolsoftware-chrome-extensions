/**
 * Export layer: teardowns in, a file out. Pure — no DOM, no chrome.* — so
 * scripts/selftest.mjs can check every format headlessly (mirrors
 * WebHighlighter/src/formatters.ts and YouTubeTranscription's export layer;
 * see docs/extensions/README.md's "shared modules" table).
 *
 * Two formats only, per PRD §4: CSV (the comparison table) and Markdown
 * (the consultant's audit). No PDF, no HTML — narrower scope than the other
 * export-layer extensions on purpose.
 */

import { buildCompareRows, formatPriceRange, tagRecurrence } from './analysis';
import { SavedTeardown, Teardown } from './types';

const MAX_FILENAME_LENGTH = 120;

/* ── CSV ─────────────────────────────────────────────────────────────── */

function csvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/** One row per listing — the shape a seller pastes straight into a sheet. */
export function buildCsv(entries: Teardown[]): string {
  if (!entries.length) return 'No listings in the compare tray.\n';

  const rows = buildCompareRows(entries);
  const header = ['Field', ...entries.map((_, i) => `Listing ${i + 1}`)];
  const lines = [header, ...rows.map(row => [row.label, ...row.values])];

  const urlRow = ['URL', ...entries.map(e => e.url)];
  const tagsRow = ['Tags', ...entries.map(e => e.tags.tags.join('; '))];
  lines.splice(1, 0, urlRow, tagsRow);

  return lines.map(line => line.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/* ── Markdown audit ──────────────────────────────────────────────────── */

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function teardownSection(t: Teardown, index?: number): string[] {
  const heading = `## ${index !== undefined ? `${index + 1}. ` : ''}${t.shop.name ?? 'Unknown shop'} — ${t.title.text || 'Untitled listing'}`;
  const lines: string[] = [heading, ''];

  if (t.status.deactivated) lines.push('> **This listing appears to have been removed or deactivated.**', '');
  else if (t.status.soldOut) lines.push('> **Sold out** at capture time.', '');

  const frontLoaded = t.title.frontLoaded === null ? '—' : t.title.frontLoaded ? '✓' : '✗';
  lines.push(`- **Title:** ${t.title.wordCount} words · ${t.title.charCount} chars · keyword front-loaded ${frontLoaded}`);
  lines.push(`- **Tags:** ${t.tags.count} of ${t.tags.max} used${t.tags.tags.length ? ` — ${t.tags.tags.join(', ')}` : ''}`);
  lines.push(`- **Photos:** ${t.photos.count ?? '—'} · video ${t.photos.hasVideo ? '✓' : '✗'}`);

  const priceLine = [`**Price:** ${formatPriceRange(t.price)}`];
  if (t.price.isDigital) priceLine.push('digital download (no shipping)');
  else priceLine.push(`free shipping ${t.price.freeShipping ? '✓' : '✗'}`);
  lines.push(`- ${priceLine.join(' · ')}`);

  lines.push(`- **Options:** ${t.options.variationCount} variation${t.options.variationCount === 1 ? '' : 's'} · personalization ${t.options.hasPersonalization ? '✓' : '✗'}`);

  const salesBits = [t.sales.purchases !== null ? `${t.sales.purchases.toLocaleString()} purchases` : null,
    t.sales.rating !== null ? `★${t.sales.rating.toFixed(1)}${t.sales.reviewCount !== null ? ` (${t.sales.reviewCount.toLocaleString()} reviews)` : ''}` : null]
    .filter(Boolean);
  lines.push(`- **Sales:** ${salesBits.length ? salesBits.join(' · ') : '—'}`);

  const shopBits = [t.shop.establishedYear ? `est. ${t.shop.establishedYear}` : null,
    t.shop.totalSales !== null ? `${t.shop.totalSales.toLocaleString()} sales` : null,
    t.shop.location].filter(Boolean);
  lines.push(`- **Shop:** ${shopBits.length ? shopBits.join(' · ') : '—'}`);

  lines.push('', `_Captured ${isoDate(t.capturedAt)} · [Source](${t.url})_`);

  if (t.unavailable.length) {
    lines.push('', `_Could not be read from this page: ${t.unavailable.join(', ')}._`);
  }

  return lines;
}

/** The consultant's deliverable (PRD §4). One or more teardowns, a comparison
 *  table when there's more than one, and the tag-recurrence finding once the
 *  sample floor is met (PRD §10). */
export function buildMarkdownAudit(entries: Teardown[], opts: { notes?: Record<string, string> } = {}): string {
  if (!entries.length) return '# Etsy Listing Audit\n\n_No listings captured yet._\n';

  const parts: string[] = [
    `# Etsy Listing Audit`,
    '',
    `${entries.length} listing${entries.length === 1 ? '' : 's'} · generated ${isoDate(Date.now())}`,
    '',
  ];

  entries.forEach((entry, i) => {
    parts.push(...teardownSection(entry, entries.length > 1 ? i : undefined));
    const note = opts.notes?.[entry.listingId];
    if (note?.trim()) parts.push('', `**Note:** ${note.trim()}`);
    parts.push('');
  });

  if (entries.length > 1) {
    parts.push('## Comparison', '');
    const rows = buildCompareRows(entries);
    const header = ['Field', ...entries.map((_, i) => `Listing ${i + 1}`)];
    parts.push(`| ${header.join(' | ')} |`);
    parts.push(`| ${header.map(() => '---').join(' | ')} |`);
    for (const row of rows) {
      const values = row.values.map(v => v.replace(/\|/g, '\\|'));
      parts.push(`| ${row.differs ? `**${row.label}**` : row.label} | ${values.join(' | ')} |`);
    }
    parts.push('');
  }

  const recurrence = tagRecurrence(entries.map(e => ({ listingId: e.listingId, tags: e.tags.tags })));
  if (recurrence === null) {
    if (entries.length > 1) {
      parts.push('## Tag recurrence', '', `_Compare at least 4 listings to see which tags recur — only ${entries.length} here._`, '');
    }
  } else if (recurrence.length) {
    parts.push('## Tag recurrence', '');
    for (const row of recurrence) {
      parts.push(`- **${row.tag}** — ${row.count} of ${row.total} compared listings`);
    }
    parts.push('');
  }

  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

/* ── Saved teardown diff ──────────────────────────────────────────────
 * "revisit shows what changed" (PRD §4) — price, sales and tags between the
 * two most recent snapshots of the same listing. */

export interface SavedDiff {
  priceChanged: boolean;
  priceFrom: string;
  priceTo: string;
  salesChanged: boolean;
  purchasesFrom: number | null;
  purchasesTo: number | null;
  reviewsFrom: number | null;
  reviewsTo: number | null;
  tagsAdded: string[];
  tagsRemoved: string[];
}

export function diffSnapshots(saved: SavedTeardown): SavedDiff | null {
  if (saved.snapshots.length < 2) return null;
  const [previous, latest] = saved.snapshots.slice(-2);

  const priceFrom = formatPriceRange(previous.price);
  const priceTo = formatPriceRange(latest.price);

  const prevTags = new Set(previous.tags.tags.map(t => t.toLowerCase()));
  const nextTags = new Set(latest.tags.tags.map(t => t.toLowerCase()));
  const tagsAdded = [...nextTags].filter(t => !prevTags.has(t));
  const tagsRemoved = [...prevTags].filter(t => !nextTags.has(t));

  return {
    priceChanged: priceFrom !== priceTo,
    priceFrom,
    priceTo,
    salesChanged: previous.sales.purchases !== latest.sales.purchases || previous.sales.reviewCount !== latest.sales.reviewCount,
    purchasesFrom: previous.sales.purchases,
    purchasesTo: latest.sales.purchases,
    reviewsFrom: previous.sales.reviewCount,
    reviewsTo: latest.sales.reviewCount,
    tagsAdded,
    tagsRemoved,
  };
}

/* ── Filenames ───────────────────────────────────────────────────────── */

export function buildFilename(base: string, ext: string): string {
  const stripControlChars = (value: string): string =>
    Array.from(value)
      .filter(ch => {
        const code = ch.codePointAt(0) ?? 0;
        return code >= 32 && code !== 127;
      })
      .join('');

  const clean = stripControlChars(base)
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\.+$/, '')
    .replace(/\s+/g, ' ')
    .trim();

  const suffix = `.${ext}`;
  const budget = MAX_FILENAME_LENGTH - suffix.length;
  const stem = (clean || 'etsy-listing').slice(0, budget).trimEnd().replace(/[-\s]+$/, '');
  return stem + suffix;
}
