/**
 * The two export formats the PRD asks for (§4): CSV (theme, count, star band,
 * example review) for a spreadsheet, and Markdown for a readable teardown to
 * paste into a product brief. Pure — no DOM, no chrome.* — fully tested.
 */

import { AnalysisResult, HistorySnapshot, Review, ThemeCluster } from './types';

export interface TeardownInput {
  asin: string;
  productTitle: string;
  productUrl: string;
  domain: string;
  totalReviews: number;
  negativeCount: number;
  positiveCount: number;
  hasMorePages: boolean;
  note: string;
  /** One result per language bucket already filtered to what's worth showing. */
  results: AnalysisResult[];
  reviewsById: Map<string, Review>;
  previousSnapshot: HistorySnapshot | null;
  generatedAt: string; // ISO date
}

function csvField(value: string): string {
  const needsQuoting = /[",\n]/.test(value);
  const escaped = value.replace(/"/g, '""');
  return needsQuoting ? `"${escaped}"` : escaped;
}

function exampleReviewText(theme: ThemeCluster, reviewsById: Map<string, Review>): string {
  const first = theme.reviewIds.map(id => reviewsById.get(id)).find(Boolean);
  if (!first) return '';
  return first.text.replace(/\s+/g, ' ').trim().slice(0, 200);
}

/** theme, count, star band, example review — one row per theme. */
export function toCsv(results: AnalysisResult[], reviewsById: Map<string, Review>): string {
  const rows = [['theme', 'count', 'star band', 'example review']];

  for (const result of results) {
    if (result.insufficient) continue;
    const band = result.band === 'negative' ? '1-2★' : '4-5★';
    for (const theme of result.themes) {
      rows.push([theme.label, String(theme.count), band, exampleReviewText(theme, reviewsById)]);
    }
  }

  return rows.map(row => row.map(csvField).join(',')).join('\r\n') + '\r\n';
}

function deltaLine(theme: ThemeCluster, previous: HistorySnapshot | null): string {
  if (!previous) return '';
  const key = [...theme.terms].sort().join('|');
  const before = previous.themeCounts[key];
  if (before === undefined || before === theme.count) return '';
  const direction = theme.count > before ? 'up' : 'down';
  return ` (${direction} from ${before} to ${theme.count})`;
}

/** theme key used to match a cluster across two runs, even if its label order shifts. */
export function themeKey(theme: ThemeCluster): string {
  return [...theme.terms].sort().join('|');
}

function themeLines(themes: ThemeCluster[], previous: HistorySnapshot | null, reviewsById: Map<string, Review>): string[] {
  if (!themes.length) return ['_Nothing recurred often enough to call a theme._', ''];
  const lines: string[] = [];
  for (const theme of themes) {
    lines.push(`- **${theme.label}** — ${theme.count} mention${theme.count === 1 ? '' : 's'}${deltaLine(theme, previous)}`);
    const example = exampleReviewText(theme, reviewsById);
    if (example) lines.push(`  > ${example}${example.length >= 200 ? '…' : ''}`);
  }
  lines.push('');
  return lines;
}

const LANGUAGE_LABELS: Record<string, string> = {
  latin: 'English / Latin-script reviews',
  cyrillic: 'Cyrillic-script reviews',
  cjk: 'CJK reviews',
  arabic: 'Arabic-script reviews',
  hangul: 'Hangul reviews',
  greek: 'Greek-script reviews',
  hebrew: 'Hebrew-script reviews',
  other: 'Other-script reviews',
};

export function toMarkdown(input: TeardownInput): string {
  const parts: string[] = [];

  parts.push(`# Review teardown — ${input.productTitle || input.asin}`, '');
  parts.push(`- ASIN: ${input.asin}`);
  if (input.productUrl) parts.push(`- Source: ${input.productUrl}`);
  parts.push(`- Generated: ${input.generatedAt}`);
  parts.push(
    `- ${input.totalReviews} review${input.totalReviews === 1 ? '' : 's'} read` +
      (input.hasMorePages ? ' — scroll or open more pages on the listing to include more' : ''),
  );
  parts.push(`- ${input.negativeCount} negative (1–2★) · ${input.positiveCount} positive (4–5★)`, '');

  if (input.note.trim()) {
    parts.push('## Note', '', input.note.trim(), '');
  }

  const byLanguage = new Map<string, AnalysisResult[]>();
  for (const result of input.results) {
    const list = byLanguage.get(result.language) ?? [];
    list.push(result);
    byLanguage.set(result.language, list);
  }

  if (!byLanguage.size) {
    parts.push('_Not enough reviews on this listing yet to cluster themes. Scroll or open more pages._', '');
  }

  for (const [language, results] of byLanguage) {
    if (byLanguage.size > 1) parts.push(`## ${LANGUAGE_LABELS[language] ?? language}`, '');

    const negative = results.find(r => r.band === 'negative');
    const praise = results.find(r => r.band === 'praise');

    parts.push('### Recurring themes in negative reviews', '');
    if (negative?.insufficient) {
      parts.push(`_Not enough negative reviews (${negative.reviewsInBand}) to cluster yet._`, '');
    } else if (negative) {
      parts.push(...themeLines(negative.themes, input.previousSnapshot, input.reviewsById));
    }

    parts.push('### Recurring praise', '');
    if (praise?.insufficient) {
      parts.push(`_Not enough positive reviews (${praise.reviewsInBand}) to cluster yet._`, '');
    } else if (praise) {
      parts.push(...themeLines(praise.themes, input.previousSnapshot, input.reviewsById));
    }
  }

  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}
