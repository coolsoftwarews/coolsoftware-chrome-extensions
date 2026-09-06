/**
 * The export layer: a NormalizedTable in, a CSV or JSON file out. Pure — no
 * DOM, no chrome.* — so scripts/selftest.mjs can check every format and the
 * filename convention headlessly.
 */

import { toCsv, toJson } from './csv';
import { ExportFormat, NormalizedTable, PageMeta } from './types';

const MAX_FILENAME_LENGTH = 120;

export function buildExport(table: NormalizedTable, format: ExportFormat): { content: string; mime: string } {
  if (format === 'csv') {
    return { content: toCsv(table), mime: 'text/csv;charset=utf-8' };
  }
  return { content: toJson(table), mime: 'application/json;charset=utf-8' };
}

/** `{site} - {page title}.{ext}`, sanitized and capped at 120 characters — same convention as WebHighlighter. */
export function buildFilename(meta: PageMeta, format: ExportFormat): string {
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

  const suffix = `.${format}`;
  const site = clean(meta.site);
  const title = clean(meta.title);

  let stem = [site, title].filter(Boolean).join(' - ') || 'table';
  const budget = MAX_FILENAME_LENGTH - suffix.length;
  if (stem.length > budget) stem = stem.slice(0, budget).trimEnd().replace(/[-\s]+$/, '');

  return stem + suffix;
}

/** A short human summary for the preview panel — never a raw error string. */
export function summarizeTable(table: NormalizedTable): string {
  const rowCount = table.rows.length;
  const colCount = table.headers.length;
  const rowWord = rowCount === 1 ? 'row' : 'rows';
  const colWord = colCount === 1 ? 'column' : 'columns';
  const base = `${rowCount} ${rowWord} × ${colCount} ${colWord}`;
  if (!table.truncated) return base;
  return `${base} — showing the first ${rowCount} of ${table.totalRowCount} rows`;
}
