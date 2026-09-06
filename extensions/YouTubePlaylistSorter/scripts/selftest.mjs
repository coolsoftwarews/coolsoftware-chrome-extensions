/**
 * Headless checks for the pure logic: duration/view/date parsing, sorting,
 * the greedy time-budget packer, and the CSV/Markdown/filename exporters.
 * The DOM-bound half (src/content/scan.ts, selectors.ts) needs a live
 * YouTube page and is covered by the manual checklist in the README instead.
 *
 * Also enforces this portfolio's zero-network-code rule for a product whose
 * entire positioning is "no API, no sign-in": grep src/*.ts (recursively)
 * for fetch/XHR/WebSocket/sendBeacon and fail the build if any exist.
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

let failures = 0;
function check(name, condition, detail) {
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${detail !== undefined ? ` — ${detail}` : ''}`);
  }
}

/* ── No network code, anywhere ────────────────────────────────────────
 * (Careful: don't type the literal substrings-with-parens in this file's own
 * comments, or the grep below false-positives on itself — a real incident
 * documented in this portfolio's own build notes.)
 */
console.log('network-free');
const NETWORK_PATTERNS = [/fetch\s*\(/, /XMLHttpRequest\s*\(/, /\.sendBeacon\s*\(/, /new\s+WebSocket\s*\(/];
function walkSrc(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkSrc(full, out);
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
}
const srcFiles = [];
walkSrc(path.join(rootDir, 'src'), srcFiles);
const offenders = [];
for (const file of srcFiles) {
  const text = fs.readFileSync(file, 'utf8');
  for (const pattern of NETWORK_PATTERNS) {
    if (pattern.test(text)) offenders.push(`${path.relative(rootDir, file)} matches ${pattern}`);
  }
}
check('no fetch/XHR/WebSocket/sendBeacon anywhere in src/', offenders.length === 0, offenders.join('; '));

/* ── Bundle the pure modules ──────────────────────────────────────────── */

const entry = path.join(os.tmpdir(), `pls-selftest-${process.pid}.mjs`);
fs.writeFileSync(
  entry,
  ['parse.ts', 'sort.ts', 'pack.ts', 'exporters.ts']
    .map((file) => `export * from ${JSON.stringify(path.join(rootDir, 'src', file).replace(/\\/g, '/'))};`)
    .join('\n')
);

const bundlePath = path.join(os.tmpdir(), `pls-selftest-bundle-${process.pid}.mjs`);
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

/* ── Duration parsing ─────────────────────────────────────────────────── */

console.log('duration parsing');
check('M:SS', mod.parseDuration('9:41') === 581);
check('H:MM:SS', mod.parseDuration('1:02:03') === 3723);
check('single-digit minutes', mod.parseDuration('0:05') === 5);
check('LIVE badge is not a duration', mod.parseDuration('LIVE') === null);
check('PREMIERE badge is not a duration', mod.parseDuration('PREMIERE') === null);
check('empty/null input', mod.parseDuration('') === null && mod.parseDuration(null) === null);
check('formatDuration round-trips under an hour', mod.formatDuration(581) === '9:41');
check('formatDuration round-trips over an hour', mod.formatDuration(3723) === '1:02:03');
check('formatDuration pads seconds', mod.formatDuration(65) === '1:05');

/* ── View count parsing ───────────────────────────────────────────────── */

console.log('view count parsing');
check('compact thousands', mod.parseViewCount('1.2K views') === 1200);
check('grouped thousands', mod.parseViewCount('3,401 views') === 3401);
check('millions', mod.parseViewCount('2.5M views') === 2500000);
check('no views', mod.parseViewCount('No views') === 0);
check('not a view count at all', mod.parseViewCount('9:41') === null);
check('null input', mod.parseViewCount(null) === null);

/* ── Relative date parsing ───────────────────────────────────────────────*/

console.log('relative date parsing');
check('recognizes a relative date', mod.looksLikeRelativeDate('3 years ago') === true);
check('recognizes a streamed-relative date', mod.looksLikeRelativeDate('Streamed 2 weeks ago') === true);
check('a view count is not a relative date', mod.looksLikeRelativeDate('1.2K views') === false);
const oneDay = 24 * 60 * 60 * 1000;
check('1 day ago', mod.relativeDateToMs('1 day ago') === oneDay);
check('2 years ago is roughly 2 * 365 days', mod.relativeDateToMs('2 years ago') === 2 * 365 * oneDay);
check('unparseable date text', mod.relativeDateToMs('yesterday') === null);

/* ── Video id parsing ─────────────────────────────────────────────────── */

console.log('video id parsing');
check('watch url', mod.parseVideoId('/watch?v=dQw4w9WgXcQ&list=PL123') === 'dQw4w9WgXcQ');
check('no id present', mod.parseVideoId('/watch?list=PL123') === null);

/* ── Sorting ──────────────────────────────────────────────────────────── */

console.log('sorting');

function row(overrides) {
  return {
    id: 'id',
    position: 1,
    title: '',
    durationText: null,
    durationSeconds: null,
    viewsText: null,
    viewsCount: null,
    dateText: null,
    unavailable: false,
    ...overrides,
  };
}

const rows = [
  row({ id: 'a', position: 1, title: 'Charlie', durationSeconds: 300, dateText: '1 year ago' }),
  row({ id: 'b', position: 2, title: 'alpha', durationSeconds: 100, dateText: '3 years ago' }),
  row({ id: 'c', position: 3, title: 'Bravo', durationSeconds: 200, dateText: '2 days ago' }),
  // No duration and no date — must survive every sort, parked at the end.
  row({ id: 'd', position: 4, title: 'Delta', unavailable: true }),
];

check(
  'custom sort is YouTube\'s own position order',
  mod.sortRows(rows, 'custom').map((r) => r.id).join('') === 'abcd'
);
check(
  'duration sort is ascending, unsortable rows parked at the end',
  mod.sortRows(rows, 'duration').map((r) => r.id).join('') === 'bcad'
);
check(
  'title sort is case-insensitive A-Z',
  mod.sortRows(rows, 'title').map((r) => r.id).join('') === 'bcad'
);
// c=2 days ago (newest), a=1 year ago, b=3 years ago (oldest), d=no date (parked last)
check(
  'date sort is newest first, unsortable rows parked at the end',
  mod.sortRows(rows, 'date').map((r) => r.id).join('') === 'cabd',
  mod.sortRows(rows, 'date').map((r) => r.id).join('')
);
check('sorting never drops a row', mod.sortRows(rows, 'duration').length === rows.length);
check('sortRows does not mutate its input', rows.map((r) => r.id).join('') === 'abcd');

/* ── Greedy pack-to-fit ───────────────────────────────────────────────── */

console.log('greedy pack to fit N minutes');

const packRows = [
  row({ id: 'short', position: 1, durationSeconds: 120 }), // 2 min
  row({ id: 'medium', position: 2, durationSeconds: 300 }), // 5 min
  row({ id: 'long', position: 3, durationSeconds: 600 }), // 10 min
  row({ id: 'too-long', position: 4, durationSeconds: 3600 }), // 60 min, never fits an 8-min budget
  row({ id: 'unknown', position: 5, durationSeconds: null }), // no readable duration
  row({ id: 'unavailable', position: 6, durationSeconds: 90, unavailable: true }),
];

const packed = mod.greedyPackToFit(packRows, 8); // 480s budget
check('budget converts minutes to seconds', packed.budgetSeconds === 480);
check(
  'includes as many short videos as fit',
  packed.included.map((r) => r.id).join(',') === 'short,medium'
);
check('total duration matches the included set', packed.totalSeconds === 420);
check('total never exceeds the budget', packed.totalSeconds <= packed.budgetSeconds);
check(
  'over-budget candidates are excluded, not silently dropped',
  packed.excludedOverBudget.map((r) => r.id).sort().join(',') === 'long,too-long'
);
check(
  'rows with no readable duration, or marked unavailable, are never guessed into the set',
  packed.excludedUnusable.map((r) => r.id).sort().join(',') === 'unavailable,unknown'
);
check(
  'unavailable rows are excluded from packing even with a duration',
  !packed.included.some((r) => r.id === 'unavailable')
);
check(
  'every input row is accounted for exactly once',
  packed.included.length + packed.excludedOverBudget.length + packed.excludedUnusable.length === packRows.length
);

const zeroBudget = mod.greedyPackToFit(packRows, 0);
check('a zero-minute budget includes nothing', zeroBudget.included.length === 0);

/* ── Exporters ────────────────────────────────────────────────────────── */

console.log('exporters');

const exportRows = [
  row({
    id: 'e1',
    position: 1,
    title: 'Track, "one"',
    durationText: '3:00',
    durationSeconds: 180,
    viewsText: '1.2K views',
    dateText: '1 year ago',
  }),
  row({ id: 'e2', position: 2, title: '[Private video]', unavailable: true }),
];

const csv = mod.toCsv(exportRows);
check('csv has a header row', csv.startsWith('position,title,duration,views,uploaded,unavailable'));
check('csv quotes a field containing a comma and a quote', csv.includes('"Track, ""one"""'));
check('csv marks the unavailable row', csv.includes(',yes'));

const md = mod.toMarkdown(exportRows, 'My Mix');
check('markdown opens with the playlist title as an H1', md.startsWith('# My Mix\n'));
check('markdown renders a table row per video', md.includes('| 1 |'));
check('markdown italicizes an unavailable row title', md.includes('_[Private video]_'));
check(
  'markdown reports total duration only over rows that have one',
  md.includes('Total duration (1 of 2 rows):') && md.includes('3:00'),
  md,
);

const filename = mod.buildFilename('My Great Mix', 'duration', 'csv');
check('filename follows the {title} - {suffix}.{ext} convention', filename === 'My Great Mix - duration.csv', filename);
check('filename strips filesystem-hostile characters', !/[\\/:*?"<>|]/.test(mod.buildFilename('a/b:c*d', 'x', 'csv')));

const longName = mod.buildFilename('x'.repeat(400), 'duration', 'md');
check('truncates to 120 characters', longName.length <= 120, `${longName.length} chars`);
check('keeps the extension after truncation', longName.endsWith('.md'));

fs.rmSync(entry, { force: true });
fs.rmSync(bundlePath, { force: true });

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
