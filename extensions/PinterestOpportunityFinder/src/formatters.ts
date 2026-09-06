/**
 * Export layer: pins-with-metrics and the keyword table, as CSV and
 * Markdown (PRD §4 — "the keyword table is the artifact people will
 * actually use"). Pure — no DOM, no chrome.* — so scripts/selftest.mjs can
 * check every format headlessly.
 */

import { formatRatio, formatSaveCount } from './outlier';
import { DomainStat, FormatStats, KeywordStat, OutlierBaseline, PinBadge, PinCard } from './types';

const MAX_FILENAME_LENGTH = 120;

function csvCell(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvRow(cells: Array<string | number>): string {
  return cells.map(csvCell).join(',');
}

function badgeLabel(badge: PinBadge | undefined): { kind: string; value: string } {
  if (!badge) return { kind: 'unknown', value: '' };
  switch (badge.kind) {
    case 'ratio':
      return { kind: 'ratio', value: formatRatio(badge.ratio ?? 0) };
    case 'rank':
      return { kind: 'rank', value: `#${(badge.rank ?? 0) + 1}` };
    case 'promoted':
      return { kind: 'promoted', value: 'Promoted' };
    case 'idea-pin':
      return { kind: 'idea-pin', value: 'Idea pin' };
    default:
      return { kind: 'unknown', value: '' };
  }
}

/* ── Pins CSV ────────────────────────────────────────────────────────── */

export function toPinsCsv(pins: PinCard[], badges: Record<string, PinBadge>): string {
  const header = [
    'rank',
    'title',
    'domain',
    'badge_kind',
    'badge_value',
    'save_count',
    'promoted',
    'idea_pin',
    'pin_url',
  ];
  const rows = [...pins]
    .sort((a, b) => a.rank - b.rank)
    .map(pin => {
      const badge = badgeLabel(badges[pin.id]);
      return csvRow([
        pin.rank + 1,
        pin.title,
        pin.domain ?? '',
        badge.kind,
        badge.value,
        pin.saveCount ?? '',
        pin.isPromoted ? 'yes' : 'no',
        pin.isIdeaPin ? 'yes' : 'no',
        pin.pinUrl,
      ]);
    });
  return [csvRow(header), ...rows].join('\r\n') + '\r\n';
}

/* ── Keyword CSV ─────────────────────────────────────────────────────── */

export function toKeywordsCsv(keywords: KeywordStat[]): string {
  const header = ['phrase', 'outlier_count', 'outlier_sample_size', 'rest_count', 'rest_sample_size', 'ratio'];
  const rows = keywords.map(k =>
    csvRow([k.phrase, k.outlierCount, k.outlierSampleSize, k.restCount, k.restSampleSize, k.ratio.toFixed(2)])
  );
  return [csvRow(header), ...rows].join('\r\n') + '\r\n';
}

/* ── Full Markdown report ───────────────────────────────────────────── */

export interface ReportInput {
  query: string | null;
  url: string;
  generatedAt: string;
  baseline: OutlierBaseline;
  pins: PinCard[];
  badges: Record<string, PinBadge>;
  keywords: KeywordStat[];
  domains: DomainStat[];
  formats: FormatStats;
}

export function toMarkdownReport(input: ReportInput): string {
  const { query, url, generatedAt, baseline, pins, badges, keywords, domains, formats } = input;
  const parts: string[] = [];

  parts.push(`# Pinterest Opportunity Finder — ${query ? `"${query}"` : 'search results'}`, '');
  parts.push(`- Source: ${url}`, `- Generated: ${generatedAt}`, `- Pins analysed: ${pins.length}`);
  parts.push(
    baseline.trustworthy
      ? `- Median saves: ${formatSaveCount(baseline.median ?? 0)} (sample size ${baseline.sampleSize})`
      : `- Save counts unreliable for this search (${Math.round(baseline.usableFraction * 100)}% of pins exposed a number) — badges fall back to result rank, never a save count.`
  );
  parts.push('');

  parts.push('## Pins', '');
  parts.push('| Rank | Title | Domain | Badge | Save count |', '| --- | --- | --- | --- | --- |');
  for (const pin of [...pins].sort((a, b) => a.rank - b.rank)) {
    const badge = badgeLabel(badges[pin.id]);
    const title = pin.title.replace(/\|/g, '\\|').slice(0, 120) || '(untitled)';
    parts.push(
      `| ${pin.rank + 1} | ${title} | ${pin.domain ?? ''} | ${badge.value} | ${pin.saveCount != null ? formatSaveCount(pin.saveCount) : ''} |`
    );
  }
  parts.push('');

  parts.push('## Keyword table', '', 'Counts among outlier pins vs. the rest of the loaded results. Not advice — read the sample size.', '');
  if (!keywords.length) {
    parts.push('_Not enough outlier pins were found to build a keyword table for this search._', '');
  } else {
    parts.push('| Phrase | Outlier count | Outlier sample | Rest count | Rest sample | Over-representation |');
    parts.push('| --- | --- | --- | --- | --- | --- |');
    for (const k of keywords.slice(0, 100)) {
      parts.push(
        `| ${k.phrase} | ${k.outlierCount} | ${k.outlierSampleSize} | ${k.restCount} | ${k.restSampleSize} | ${formatRatio(k.ratio)} |`
      );
    }
    parts.push('');
  }

  parts.push('## Domains among outliers', '');
  if (!domains.length) {
    parts.push('_No outbound domains were readable on the outlier pins._', '');
  } else {
    parts.push('| Domain | Outlier pins | Sample size |', '| --- | --- | --- |');
    for (const d of domains.slice(0, 50)) {
      parts.push(`| ${d.domain} | ${d.outlierCount} | ${d.outlierSampleSize} |`);
    }
    parts.push('');
  }

  parts.push('## Formats among outliers', '', `Sample size: ${formats.sampleSize}`, '');
  parts.push('**Image shape**', '');
  for (const band of formats.aspectBands) {
    parts.push(`- ${band.label}: ${band.count} (${Math.round(band.fraction * 100)}%)`);
  }
  parts.push('', '**Text overlay**', '');
  for (const band of formats.textOverlay) {
    parts.push(`- ${band.label}: ${band.count} (${Math.round(band.fraction * 100)}%)`);
  }
  parts.push('');

  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

/* ── Filenames ───────────────────────────────────────────────────────── */

export function buildFilename(query: string | null, kind: 'pins' | 'keywords' | 'report', ext: string): string {
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
  const q = clean(query ?? 'pinterest search');
  let stem = `pinterest opportunity finder - ${q} - ${kind}`;
  const budget = MAX_FILENAME_LENGTH - suffix.length;
  if (stem.length > budget) stem = stem.slice(0, budget).trimEnd().replace(/[-\s]+$/, '');
  return stem + suffix;
}
