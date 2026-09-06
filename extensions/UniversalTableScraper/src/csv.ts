/**
 * RFC 4180 CSV serialization. Pure string logic — no DOM, no chrome.* — so
 * scripts/selftest.mjs can exercise every escaping edge case headlessly.
 */

import { NormalizedTable } from './types';

/** Quotes a field iff it contains a comma, a quote, or a line break; doubles any embedded quotes. */
export function csvEscapeField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function csvRow(cells: string[]): string {
  return cells.map(csvEscapeField).join(',');
}

/** RFC 4180 uses CRLF line endings; we follow that rather than the platform default. */
export function toCsv(table: NormalizedTable, includeHeader = true): string {
  const lines: string[] = [];
  if (includeHeader && table.headers.length) lines.push(csvRow(table.headers));
  for (const row of table.rows) lines.push(csvRow(row));
  if (!lines.length) return '';
  return lines.join('\r\n') + '\r\n';
}

/** Array-of-objects JSON, keyed by header name — the shape most tools expect to import. */
export function toJson(table: NormalizedTable): string {
  const records = table.rows.map(row => {
    const record: Record<string, string> = {};
    table.headers.forEach((header, i) => {
      const key = header && header.trim() ? header : `Column ${i + 1}`;
      record[key] = row[i] ?? '';
    });
    return record;
  });
  return JSON.stringify(records, null, 2);
}
