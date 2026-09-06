/**
 * Headless checks for the pure logic: merged-cell table layout, header
 * inference, CSV escaping, JSON export, the repeated-list confidence scoring,
 * and filenames.
 *
 * This is the most important testable core of the product (see PRD §4–5) —
 * the DOM-bound half (hover picking, the on-page preview panel) needs a real
 * browser and is covered by the manual checklist in the README.
 *
 * Run: node scripts/selftest.mjs
 */

import { build } from 'esbuild';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const entry = path.join(os.tmpdir(), `uts-selftest-${process.pid}.mjs`);
fs.writeFileSync(
  entry,
  ['table.ts', 'csv.ts', 'heuristics.ts', 'formatters.ts']
    .map(file => `export * from ${JSON.stringify(path.join(rootDir, 'src', file).replace(/\\/g, '/'))};`)
    .join('\n')
);

const bundlePath = path.join(os.tmpdir(), `uts-selftest-bundle-${process.pid}.mjs`);
await build({
  entryPoints: [entry],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: ['node20'],
  outfile: bundlePath,
  logLevel: 'silent',
});

const mod = await import(pathToFileURL(bundlePath).href);

let failures = 0;
function check(name, condition, detail) {
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${detail !== undefined ? ` — ${detail}` : ''}`);
  }
}

const cell = (text, extra = {}) => ({ text, colSpan: 1, rowSpan: 1, isHeader: false, ...extra });
const th = (text, extra = {}) => cell(text, { isHeader: true, ...extra });

/* ── CSV escaping ────────────────────────────────────────────────────── */

console.log('csv escaping');
check('plain field is untouched', mod.csvEscapeField('hello') === 'hello');
check('a comma triggers quoting', mod.csvEscapeField('a,b') === '"a,b"');
check(
  'a quote triggers quoting and is doubled',
  mod.csvEscapeField('she said "hi"') === '"she said ""hi"""',
  mod.csvEscapeField('she said "hi"')
);
check('a newline triggers quoting', mod.csvEscapeField('line1\nline2') === '"line1\nline2"');
check('a carriage return triggers quoting', mod.csvEscapeField('a\rb') === '"a\rb"');
check('comma and quote together are handled', mod.csvEscapeField('a,"b"') === '"a,""b"""');
check('an empty field is untouched', mod.csvEscapeField('') === '');

const csvTable = {
  headers: ['Name', 'Note'],
  rows: [
    ['Widget, Deluxe', 'Has "quotes" inside'],
    ['Multi\nline', 'plain'],
  ],
  headerInferred: true,
  truncated: false,
  totalRowCount: 2,
};

const csv = mod.toCsv(csvTable);
const csvLines = csv.split('\r\n');
check('toCsv uses CRLF line endings', csv.includes('\r\n'));
check('toCsv emits the header first', csvLines[0] === 'Name,Note');
check('toCsv escapes a comma in a data row', csvLines[1] === '"Widget, Deluxe","Has ""quotes"" inside"', csvLines[1]);
check('toCsv ends with a trailing CRLF', csv.endsWith('\r\n'));
check(
  'toCsv without a header omits it',
  mod.toCsv(csvTable, false).split('\r\n')[0] === '"Widget, Deluxe","Has ""quotes"" inside"'
);
check('an empty table produces an empty CSV', mod.toCsv({ ...csvTable, headers: [], rows: [] }) === '');

/* ── JSON export ─────────────────────────────────────────────────────── */

console.log('json export');
const jsonOut = JSON.parse(mod.toJson(csvTable));
check('json is an array of one object per row', jsonOut.length === 2);
check('json keys come from the headers', jsonOut[0].Name === 'Widget, Deluxe' && jsonOut[0].Note === 'Has "quotes" inside');
check(
  'a blank header falls back to a generated column name',
  JSON.parse(mod.toJson({ ...csvTable, headers: ['', 'Note'] }))[0]['Column 1'] === 'Widget, Deluxe'
);

/* ── Table layout: no spans ──────────────────────────────────────────── */

console.log('table layout — simple');
const simpleHeader = [[th('Name'), th('Price')], [cell('Widget'), cell('9.99')], [cell('Gadget'), cell('14.50')]];
const simple = mod.normalizeTable(simpleHeader);
check('infers a header row from <th> cells', simple.headerInferred === true);
check('header text comes from row 0', simple.headers.join(',') === 'Name,Price');
check('data rows exclude the header', simple.rows.length === 2);
check('cell text is preserved', simple.rows[0][0] === 'Widget');
check('total row count matches, uncapped', simple.totalRowCount === 2 && simple.truncated === false);

const noHeaderSignal = [[cell('Widget'), cell('9.99')], [cell('Gadget'), cell('14.50')]];
const noHeader = mod.normalizeTable(noHeaderSignal);
check('no <th> row falls back to generated column names', noHeader.headers.join(',') === 'Column 1,Column 2');
check('generated-header tables keep every row as data', noHeader.rows.length === 2);
check('headerInferred is false when generated', noHeader.headerInferred === false);

const forcedOn = mod.normalizeTable(noHeaderSignal, { forceHeaderRow: true });
check('forceHeaderRow: true overrides a table with no header signal', forcedOn.headers.join(',') === 'Widget,9.99');
check('forcing a header leaves one fewer data row', forcedOn.rows.length === 1);

const forcedOff = mod.normalizeTable(simpleHeader, { forceHeaderRow: false });
check('forceHeaderRow: false overrides a real <th> row', forcedOff.headerInferred === false);
check('forcing headers off keeps the th row as data', forcedOff.rows.length === 3);

check(
  'whitespace is collapsed and trimmed',
  mod.normalizeTable([[th('  Name  \n'), th('Price')], [cell('  Wid\n get  '), cell('9.99')]]).rows[0][0] ===
    'Wid get'
);

/* ── Table layout: colspan / rowspan ────────────────────────────────── */

console.log('table layout — merged cells');

// A colspan=2 header over two data columns duplicates into both.
const colspanRows = [
  [th('Specs', { colSpan: 2 })],
  [th('Width'), th('Height')],
  [cell('10'), cell('20')],
];
const colspanTable = mod.normalizeTable(colspanRows, { forceHeaderRow: false });
check(
  'a colspan cell is duplicated across every column it covers',
  colspanTable.rows[0].join(',') === 'Specs,Specs',
  colspanTable.rows[0].join(',')
);
check('columns after a colspan row stay aligned', colspanTable.rows[1].join(',') === 'Width,Height');
check('data below merged headers is aligned too', colspanTable.rows[2].join(',') === '10,20');

// A rowspan=2 cell duplicates its value down into the next row's same column.
const rowspanRows = [
  [th('Category'), th('Item')],
  [cell('Fruit', { rowSpan: 2 }), cell('Apple')],
  [cell('Banana')],
];
const rowspanTable = mod.normalizeTable(rowspanRows);
check('a rowspan cell is duplicated down into the next row', rowspanTable.rows[0].join(',') === 'Fruit,Apple');
check(
  'the following row keeps the duplicated value and does not shift columns',
  rowspanTable.rows[1].join(',') === 'Fruit,Banana',
  rowspanTable.rows[1].join(',')
);

// Combined: a rowspan cell followed by a colspan cell in the covering row.
const combinedRows = [
  [th('Region'), th('Q1'), th('Q2')],
  [cell('East', { rowSpan: 2 }), cell('100', { colSpan: 2 })],
  [cell('50'), cell('60')],
];
const combinedTable = mod.normalizeTable(combinedRows);
check('combined rowspan+colspan row lays out without breaking alignment', combinedTable.rows[0].join(',') === 'East,100,100');
check(
  'the row after a combined span keeps 3 aligned columns',
  combinedTable.rows[1].join(',') === 'East,50,60',
  combinedTable.rows[1].join(',')
);

/* ── Table layout: row cap ───────────────────────────────────────────── */

console.log('table layout — row cap');
const bigRows = [[th('N')], ...Array.from({ length: 50 }, (_, i) => [cell(String(i))])];
const capped = mod.normalizeTable(bigRows, { maxRows: 10 });
check('rows are capped at maxRows', capped.rows.length === 10);
check('truncated is reported', capped.truncated === true);
check('totalRowCount reflects the uncapped count', capped.totalRowCount === 50);
const uncapped = mod.normalizeTable(bigRows, { maxRows: 1000 });
check('a cap above the row count does not truncate', uncapped.truncated === false && uncapped.rows.length === 50);

check('an empty table does not throw', JSON.stringify(mod.normalizeTable([])) === JSON.stringify({
  headers: [],
  rows: [],
  headerInferred: false,
  truncated: false,
  totalRowCount: 0,
}));

/* ── Repeated-list heuristic ─────────────────────────────────────────── */

console.log('list heuristic');

const item = (name, price, shape = 'DIV.card>H3,SPAN') => ({
  shape,
  fields: { field_0: name, field_1: price },
});

const tooFew = mod.detectRepeatedList([item('A', '$1'), item('B', '$2')]);
check('fewer than 3 items refuses with a reason', tooFew.confident === false);
check('the refusal reason is plain language, not empty', typeof tooFew.reason === 'string' && tooFew.reason.length > 0);

const goodList = [item('Widget', '$9.99'), item('Gadget', '$14.50'), item('Gizmo', '$3.25'), item('Doohickey', '$7.00')];
const goodDetection = mod.detectRepeatedList(goodList);
check('a consistent, fully-populated list is confident', goodDetection.confident === true, goodDetection.score);
check('columns come back for a confident detection', goodDetection.columns.length === 2);
check('rows come back in the same order as items', goodDetection.rows[0][0] === 'Widget');
check('score is reported and high for a clean match', goodDetection.score >= 0.9, goodDetection.score);

const inconsistentShapes = [
  item('Widget', '$9.99', 'DIV.card>H3,SPAN'),
  item('Gadget', '$14.50', 'DIV.card>H3,SPAN'),
  item('Gizmo', '$3.25', 'ARTICLE.promo>P'),
  item('Doohickey', '$7.00', 'SECTION.ad>IMG'),
];
const inconsistentDetection = mod.detectRepeatedList(inconsistentShapes);
check('a page of structurally mismatched items refuses to export', inconsistentDetection.confident === false);
check(
  'the refusal says it does not look like a structured list',
  (inconsistentDetection.reason || '').toLowerCase().includes("doesn't look like a structured list") ||
    (inconsistentDetection.reason || '').toLowerCase().includes('too much'),
  inconsistentDetection.reason
);
check('a refused detection returns no rows to protect against a garbage export', inconsistentDetection.rows.length === 0);

const mostlyEmpty = [
  { shape: 'LI.row>SPAN,SPAN', fields: { field_0: 'A', field_1: '' } },
  { shape: 'LI.row>SPAN,SPAN', fields: { field_0: '', field_1: '' } },
  { shape: 'LI.row>SPAN,SPAN', fields: { field_0: '', field_1: '' } },
  { shape: 'LI.row>SPAN,SPAN', fields: { field_0: 'D', field_1: '' } },
];
const emptyDetection = mod.detectRepeatedList(mostlyEmpty);
check('structurally identical but mostly-empty items are not confident', emptyDetection.confident === false, emptyDetection.score);

/* ── Filenames ───────────────────────────────────────────────────────── */

console.log('filenames');
const meta = { url: 'https://example.com/reports', title: 'Quarterly Numbers', site: 'example.com' };
const filename = mod.buildFilename(meta, 'csv');
check(
  'follows the {site} - {title}.{ext} convention',
  filename === 'example.com - Quarterly Numbers.csv',
  filename
);
check('drops filesystem-hostile characters', !/[\\/:*?"<>|]/.test(mod.buildFilename({ ...meta, title: 'A/B: "Test"?' }, 'json')));

const longName = mod.buildFilename({ ...meta, title: 'x'.repeat(400) }, 'json');
check('truncates to 120 characters', longName.length <= 120, `${longName.length} chars`);
check('keeps the extension after truncation', longName.endsWith('.json'));
check('falls back to a sane stem when site and title are empty', mod.buildFilename({ url: '', title: '', site: '' }, 'csv') === 'table.csv');

/* ── Export + summary ────────────────────────────────────────────────── */

console.log('export + summary');
const exportCsv = mod.buildExport(simple, 'csv');
check('csv export has the right mime type', exportCsv.mime.startsWith('text/csv'));
check('csv export contains the header', exportCsv.content.startsWith('Name,Price'));

const exportJson = mod.buildExport(simple, 'json');
check('json export has the right mime type', exportJson.mime.startsWith('application/json'));
check('json export parses back to the right row count', JSON.parse(exportJson.content).length === 2);

check('summary reports rows and columns', mod.summarizeTable(simple) === '2 rows × 2 columns');
check('summary notes truncation', mod.summarizeTable(capped).includes('showing the first 10 of 50 rows'), mod.summarizeTable(capped));
check('summary uses singular row/column for count of 1', mod.summarizeTable({ headers: ['A'], rows: [['1']], headerInferred: false, truncated: false, totalRowCount: 1 }) === '1 row × 1 column');

fs.rmSync(entry, { force: true });
fs.rmSync(bundlePath, { force: true });

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
