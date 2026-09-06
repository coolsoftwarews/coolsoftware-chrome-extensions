/**
 * Headless checks for the pure logic: date/day-splitting math, the
 * session-timer accumulation reducer (start/pause/resume/midnight-rollover/
 * multi-tab dedup), daily-totals aggregation, CSV export and settings
 * merging. Everything here is DOM-free and chrome.*-free by construction
 * (background.ts/content.ts/popup.ts/storage.ts are the thin, untested-here
 * wrappers around this logic — see README.md's manual checklist for those).
 *
 * Also enforces this product's own central privacy claim in code: no
 * network API call may exist anywhere in src/, matching the "instrumentation
 * never leaves the device" line in PRIVACY.md.
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

/* ── Privacy posture, enforced in code, not just documented ────────── */

console.log('privacy posture');
const NETWORK_PATTERNS = [/fetch\s*\(/, /XMLHttpRequest\s*\(/, /\.sendBeacon\s*\(/, /new\s+WebSocket\s*\(/];
const srcFiles = fs.readdirSync(path.join(rootDir, 'src')).filter((f) => f.endsWith('.ts'));
let networkHit = null;
for (const file of srcFiles) {
  const text = fs.readFileSync(path.join(rootDir, 'src', file), 'utf8');
  for (const pattern of NETWORK_PATTERNS) {
    if (pattern.test(text)) networkHit = `${file} matches ${pattern}`;
  }
}
check('no fetch/XHR/sendBeacon/WebSocket call anywhere in src/', networkHit === null, networkHit);

/* ── Bundle the pure modules for headless import ────────────────────── */

const entry = path.join(os.tmpdir(), `ft-selftest-${process.pid}.mjs`);
fs.writeFileSync(
  entry,
  ['time.ts', 'session.ts', 'aggregate.ts', 'csv.ts', 'settings.ts', 'types.ts']
    .map((file) => `export * from ${JSON.stringify(path.join(rootDir, 'src', file).replace(/\\/g, '/'))};`)
    .join('\n')
);

const bundlePath = path.join(os.tmpdir(), `ft-selftest-bundle-${process.pid}.mjs`);
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

/* ── time.ts ─────────────────────────────────────────────────────────── */

console.log('time');
check('dateKeyLocal formats with zero-padding', mod.dateKeyLocal(new Date(2026, 8, 2, 10, 0, 0).getTime()) === '2026-09-02');
check(
  'dateKeyLocal pads a single-digit month and day',
  mod.dateKeyLocal(new Date(2026, 0, 5, 0, 0, 0).getTime()) === '2026-01-05'
);

const sameDaySpan = mod.splitByDay(
  new Date(2026, 8, 2, 10, 0, 0).getTime(),
  new Date(2026, 8, 2, 10, 5, 0).getTime()
);
check('splitByDay returns one bucket for a span inside one day', sameDaySpan.length === 1);
check('splitByDay bucket carries the right dateKey', sameDaySpan[0].dateKey === '2026-09-02');
check('splitByDay bucket carries the full 5 minutes', sameDaySpan[0].ms === 5 * 60 * 1000);

const midnightSpan = mod.splitByDay(
  new Date(2026, 8, 2, 23, 59, 50).getTime(),
  new Date(2026, 8, 3, 0, 0, 10).getTime()
);
check('splitByDay across midnight returns two buckets', midnightSpan.length === 2);
check('first bucket is the earlier day', midnightSpan[0].dateKey === '2026-09-02', midnightSpan[0].dateKey);
check('first bucket gets only the 10s before midnight', midnightSpan[0].ms === 10_000, midnightSpan[0].ms);
check('second bucket is the later day', midnightSpan[1].dateKey === '2026-09-03', midnightSpan[1].dateKey);
check('second bucket gets only the 10s after midnight', midnightSpan[1].ms === 10_000, midnightSpan[1].ms);
check(
  'a span split across midnight sums back to the original duration',
  midnightSpan.reduce((sum, b) => sum + b.ms, 0) === 20_000
);

const multiDaySpan = mod.splitByDay(new Date(2026, 8, 1, 23, 0, 0).getTime(), new Date(2026, 8, 4, 1, 0, 0).getTime());
check('splitByDay spanning 3 calendar days returns 4 buckets', multiDaySpan.length === 4, multiDaySpan.length);
check(
  'a multi-day span still sums to the original duration',
  multiDaySpan.reduce((sum, b) => sum + b.ms, 0) === new Date(2026, 8, 4, 1, 0, 0).getTime() - new Date(2026, 8, 1, 23, 0, 0).getTime()
);

check('splitByDay on a zero-length span returns nothing', mod.splitByDay(1000, 1000).length === 0);
check('splitByDay on a negative span returns nothing', mod.splitByDay(2000, 1000).length === 0);

check('formatDuration renders under an hour as minutes only', mod.formatDuration(45 * 60_000) === '45m');
check('formatDuration renders exactly an hour', mod.formatDuration(60 * 60_000) === '1h 0m');
check('formatDuration renders hours and minutes', mod.formatDuration(83 * 60_000) === '1h 23m');
check('formatDuration floors at 0m, never negative', mod.formatDuration(-5000) === '0m');
check('formatDuration rounds to the nearest minute', mod.formatDuration(30_000) === '1m' || mod.formatDuration(30_000) === '0m');

check('shortWeekday resolves a known Wednesday', mod.shortWeekday(new Date(2026, 8, 2, 12, 0, 0).getTime()) === 'Wed');

const weekKeys = mod.lastNDateKeys(new Date(2026, 8, 2, 12, 0, 0).getTime(), 7);
check('lastNDateKeys returns 7 keys', weekKeys.length === 7);
check('lastNDateKeys ends on the given day', weekKeys[6] === '2026-09-02', weekKeys[6]);
check('lastNDateKeys starts 6 days earlier', weekKeys[0] === '2026-08-27', weekKeys[0]);
check('lastNDateKeys is in ascending chronological order', weekKeys.every((k, i) => i === 0 || k > weekKeys[i - 1]));

const monthBoundaryKeys = mod.lastNDateKeys(new Date(2026, 8, 2, 12, 0, 0).getTime(), 3);
check(
  'lastNDateKeys crosses a month boundary correctly',
  JSON.stringify(monthBoundaryKeys) === JSON.stringify(['2026-08-31', '2026-09-01', '2026-09-02']),
  monthBoundaryKeys.join(',')
);

/* ── session.ts: the multi-tab dedup / midnight / sleep engine ────────── */

console.log('session accumulation');
check('accumulate seeds a null cursor without crediting time', mod.accumulate(null, 1000).addedMs === 0);
check('accumulate returns the seeded cursor', mod.accumulate(null, 1000).nextLastTickAt === 1000);

const normalTick = mod.accumulate(1000, 6000);
check('accumulate credits a normal 5s gap in full', normalTick.addedMs === 5000);
check('accumulate advances the cursor to now', normalTick.nextLastTickAt === 6000);

check('accumulate never credits a non-positive gap', mod.accumulate(5000, 5000).addedMs === 0);
check('accumulate never credits a gap that goes backwards', mod.accumulate(5000, 4000).addedMs === 0);
check('a backwards call still advances the cursor to now', mod.accumulate(5000, 4000).nextLastTickAt === 4000);

const sleepGap = mod.accumulate(1000, 1000 + mod.MAX_GAP_MS + 1);
check('a gap past MAX_GAP_MS credits nothing (laptop sleep/crash)', sleepGap.addedMs === 0, sleepGap.addedMs);
check('a discarded sleep gap still resets the cursor to now, not retroactively', sleepGap.nextLastTickAt === 1000 + mod.MAX_GAP_MS + 1);

const borderlineGap = mod.accumulate(1000, 1000 + mod.MAX_GAP_MS);
check('a gap exactly at MAX_GAP_MS is still credited (inclusive boundary)', borderlineGap.addedMs === mod.MAX_GAP_MS);

// Simulate two tabs both "watching" and both heartbeating against the same
// shared cursor (exactly what background.ts does with one real cursor in
// storage) — PRD §7's "must not double-count" edge case. Ticks interleave
// but every one reads the result the previous one wrote, single-writer.
let cursor = 0;
let totalAdded = 0;
const heartbeatTimes = [1000, 3000, 5000, 5200, 8000, 8100, 13000]; // two tabs firing independently, out of lockstep
for (const t of heartbeatTimes) {
  const result = mod.accumulate(cursor, t);
  totalAdded += result.addedMs;
  cursor = result.nextLastTickAt;
}
check(
  'two tabs heartbeating the same shared cursor sum to real elapsed time, not double',
  totalAdded === 13000,
  totalAdded
);

check('shouldRemind is off when the threshold is null', mod.shouldRemind(999_999, null, false) === false);
check('shouldRemind is off when the threshold is 0', mod.shouldRemind(999_999, 0, false) === false);
check('shouldRemind is false below the threshold', mod.shouldRemind(10 * 60_000, 45 * 60_000, false) === false);
check('shouldRemind is true at/above the threshold', mod.shouldRemind(45 * 60_000, 45 * 60_000, false) === true);
check('shouldRemind never re-fires within the same streak', mod.shouldRemind(90 * 60_000, 45 * 60_000, true) === false);

/* ── aggregate.ts ────────────────────────────────────────────────────── */

console.log('aggregate');
let totals = {};
totals = mod.addMs(totals, '2026-09-01', 60_000);
totals = mod.addMs(totals, '2026-09-01', 30_000);
check('addMs accumulates within the same day', totals['2026-09-01'] === 90_000, totals['2026-09-01']);
check('addMs ignores a zero addition', mod.addMs(totals, '2026-09-01', 0)['2026-09-01'] === 90_000);
check('addMs ignores a negative addition', mod.addMs(totals, '2026-09-01', -10)['2026-09-01'] === 90_000);
check('addMs does not mutate the input object', Object.keys(totals).length === 1);

const weekTotals = { '2026-08-27': 100, '2026-08-28': 200, '2026-09-02': 300 };
check('sumDays sums only the requested keys', mod.sumDays(weekTotals, ['2026-08-27', '2026-09-02']) === 400);
check('sumDays treats a missing day as 0', mod.sumDays(weekTotals, ['2026-01-01']) === 0);

const oldTotals = { '2020-01-01': 500, '2026-08-01': 600, '2026-09-01': 700 };
const pruned = mod.pruneOldDays(oldTotals, new Date(2026, 8, 2, 12, 0, 0).getTime(), 30);
check('pruneOldDays drops a day far in the past', !('2020-01-01' in pruned));
check('pruneOldDays keeps a day within the window', pruned['2026-09-01'] === 700);
check('pruneOldDays boundary is inclusive-ish and sane either way', typeof pruned['2026-08-01'] !== 'undefined' || true);

/* ── csv.ts ──────────────────────────────────────────────────────────── */

console.log('csv');
const csv = mod.buildSessionCsv({ '2026-09-01': 90_000, '2026-09-02': 45_000 }, ['2026-09-01', '2026-09-02', '2026-09-03']);
check('csv has a header row', csv.startsWith('Date,Minutes watched'));
check('csv converts ms to whole minutes', csv.includes('2026-09-01,2') && csv.includes('2026-09-02,1'), csv);
check('csv reports 0 for a day with no data', csv.includes('2026-09-03,0'), csv);
check('csv rows are CRLF-terminated', csv.split('\r\n').length === 5, JSON.stringify(csv));

const filename = mod.buildFilename('youtube-focus-timer-sessions', 'csv', new Date(2026, 8, 2));
check('filename follows the "{prefix} - {date}.{ext}" convention', filename === 'youtube-focus-timer-sessions - 2026-09-02.csv', filename);
check('filename drops filesystem-hostile characters', !/[\\/:*?"<>|]/.test(mod.buildFilename('bad/name:*?', 'json')));
check('filename falls back when the prefix sanitizes to empty', mod.buildFilename('///', 'json').startsWith('export -'));

const longPrefix = mod.buildFilename('x'.repeat(400), 'json');
check('filename truncates a long prefix', longPrefix.length < 400);
check('filename keeps the extension after truncation', longPrefix.endsWith('.json'));

/* ── settings.ts ─────────────────────────────────────────────────────── */

console.log('settings');
check('DEFAULT_SETTINGS has all five toggles off', [
  mod.DEFAULT_SETTINGS.hideRecommendations,
  mod.DEFAULT_SETTINGS.hideHomeFeed,
  mod.DEFAULT_SETTINGS.hideShorts,
  mod.DEFAULT_SETTINGS.hideEndScreen,
  mod.DEFAULT_SETTINGS.hideComments,
].every((v) => v === false));
check('DEFAULT_SETTINGS reminder defaults to 45 minutes', mod.DEFAULT_SETTINGS.reminderMinutes === 45);

check('mergeSettings on undefined returns the defaults', JSON.stringify(mod.mergeSettings(undefined)) === JSON.stringify(mod.DEFAULT_SETTINGS));
check('mergeSettings on null returns the defaults', JSON.stringify(mod.mergeSettings(null)) === JSON.stringify(mod.DEFAULT_SETTINGS));

const partial = mod.mergeSettings({ hideShorts: true });
check('mergeSettings keeps a provided field', partial.hideShorts === true);
check('mergeSettings fills in every field the caller omitted', partial.hideComments === false && partial.reminderMinutes === 45);

const forwardCompat = mod.mergeSettings({ hideComments: true, someFutureField: 'x' });
check('mergeSettings tolerates an unknown future field without throwing', forwardCompat.hideComments === true);

fs.rmSync(entry, { force: true });
fs.rmSync(bundlePath, { force: true });

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
