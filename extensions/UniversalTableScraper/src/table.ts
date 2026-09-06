/**
 * Turns raw `<table>` rows (as read off the DOM, cell by cell, with their
 * colSpan/rowSpan) into a plain rows-and-columns grid.
 *
 * Deliberately pure — no DOM, no chrome.* — so scripts/selftest.mjs can check
 * merged-cell handling and header inference headlessly. The DOM half
 * (walking `<tr>`/`<td>`/`<th>` into RawRow[]) lives in content.ts.
 *
 * Merged cells: PRD §4 calls for "sensible duplication rather than breaking
 * column alignment" — a colspan/rowspan cell's text is copied into every grid
 * cell it visually covers. A duplicated value is a far smaller problem for
 * someone opening the CSV than a column that's shifted by one for every row
 * beneath a merged header.
 */

import { NormalizedTable, NormalizeOptions, RawRow } from './types';

const DEFAULT_MAX_ROWS = 5000;

function trimCell(value: string): string {
  // "Basic whitespace trimming" per PRD §4 — collapse runs of whitespace
  // (including the newlines DOM text often carries) without touching content.
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * Lays raw rows out into a rectangular grid, duplicating merged-cell values
 * into every cell they cover. This is the standard HTML table layout
 * algorithm: a per-column "how many more rows does this value cover" tracker,
 * walked row by row.
 */
function layoutGrid(rawRows: RawRow[]): { grid: string[][]; isHeaderRow: boolean[] } {
  const grid: string[][] = [];
  const isHeaderRow: boolean[] = [];
  // tracker[col] = { value, remaining } — a rowspan still covering this column
  // for `remaining` more rows after the one that is about to be laid out.
  const tracker = new Map<number, { value: string; remaining: number }>();

  const maxTrackedCol = (): number => {
    let max = -1;
    for (const key of tracker.keys()) if (key > max) max = key;
    return max;
  };

  for (const row of rawRows) {
    const gridRow: string[] = [];
    let col = 0;
    let cellIndex = 0;
    let rowAllHeader = row.length > 0;
    let placedAny = false;

    while (cellIndex < row.length || col <= maxTrackedCol()) {
      const entry = tracker.get(col);
      if (entry && entry.remaining > 0) {
        gridRow[col] = entry.value;
        placedAny = true;
        entry.remaining -= 1;
        if (entry.remaining <= 0) tracker.delete(col);
        col++;
        continue;
      }

      if (cellIndex < row.length) {
        const cell = row[cellIndex++];
        const value = trimCell(cell.text);
        const colSpan = Math.max(1, cell.colSpan || 1);
        const rowSpan = Math.max(1, cell.rowSpan || 1);
        for (let c = 0; c < colSpan; c++) {
          gridRow[col + c] = value;
          if (rowSpan > 1) tracker.set(col + c, { value, remaining: rowSpan - 1 });
        }
        col += colSpan;
        placedAny = true;
        if (!cell.isHeader) rowAllHeader = false;
        continue;
      }

      break;
    }

    if (placedAny) {
      grid.push(gridRow);
      isHeaderRow.push(rowAllHeader);
    }
  }

  // Pad every row to the widest row so CSV/JSON output is rectangular.
  const width = grid.reduce((max, row) => Math.max(max, row.length), 0);
  for (const row of grid) {
    for (let i = 0; i < width; i++) if (row[i] === undefined) row[i] = '';
  }

  return { grid, isHeaderRow };
}

/**
 * Normalizes raw table rows into headers + data rows, applying the merged-cell
 * layout, header inference (or an explicit override), and a row cap.
 */
export function normalizeTable(rawRows: RawRow[], options: NormalizeOptions = {}): NormalizedTable {
  const { grid, isHeaderRow } = layoutGrid(rawRows);
  const maxRows = options.maxRows ?? DEFAULT_MAX_ROWS;

  if (!grid.length) {
    return { headers: [], rows: [], headerInferred: false, truncated: false, totalRowCount: 0 };
  }

  // Infer a header row from real signal (every cell in row 0 was a <th>,
  // typically because it came from <thead>) unless the caller overrides it —
  // the preview UI's "first row is headers" toggle drives that override.
  const inferredHeader = isHeaderRow[0] === true;
  const useHeaderRow = options.forceHeaderRow ?? inferredHeader;

  let headers: string[];
  let dataRows: string[][];
  let headerInferred: boolean;

  if (useHeaderRow) {
    headers = grid[0];
    dataRows = grid.slice(1);
    headerInferred = true;
  } else {
    const width = grid[0].length;
    headers = Array.from({ length: width }, (_, i) => `Column ${i + 1}`);
    dataRows = grid;
    headerInferred = false;
  }

  const totalRowCount = dataRows.length;
  const truncated = totalRowCount > maxRows;
  if (truncated) dataRows = dataRows.slice(0, maxRows);

  return { headers, rows: dataRows, headerInferred, truncated, totalRowCount };
}

export { DEFAULT_MAX_ROWS };
