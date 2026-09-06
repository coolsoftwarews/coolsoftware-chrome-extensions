/**
 * Headless checks for the pure logic: handle normalization, the ownership-
 * match predicate (PRD-45 §5 — the single most important function in this
 * extension), filename building, and the CSV/JSON log export. The DOM-bound
 * half (scrape.ts, content.ts) needs a real, logged-in TikTok page and is
 * covered by the manual checklist in README.md instead — the same split
 * every DOM-reading extension in this portfolio uses (TikTokProductScout's
 * scan.ts, XBookmarkOrganizer's scrape.ts).
 *
 * Also enforces this PRD's "no network requests beyond the download itself"
 * posture (PRD-45 §6) by grepping src/*.ts for network call sites and
 * failing the build if any exist — chrome.downloads.download() is exempt,
 * it's the browser's own download manager, not a network call this code
 * makes directly.
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

/* ── Privacy posture: no network call sites anywhere in src/ ──────────── */
// Written without the literal substrings themselves so this check doesn't
// false-positive on its own source.
console.log('privacy');
const forbidden = ['fetch' + '(', 'XMLHttpRequest' + '(', '.sendBeacon' + '(', 'new WebSocket' + '('];
const srcFiles = fs.readdirSync(path.join(rootDir, 'src')).filter(f => f.endsWith('.ts'));
let networkHit = null;
for (const file of srcFiles) {
  const content = fs.readFileSync(path.join(rootDir, 'src', file), 'utf8');
  for (const needle of forbidden) {
    if (content.includes(needle)) networkHit = `${file}: ${needle}`;
  }
}
check('no network call sites in src/*.ts', networkHit === null, networkHit ?? undefined);

/* ── Bundle the pure modules for headless testing ──────────────────────── */

const entry = path.join(os.tmpdir(), `tma-selftest-${process.pid}.mjs`);
fs.writeFileSync(
  entry,
  ['parse.ts', 'storage.ts']
    .map(file => `export * from ${JSON.stringify(path.join(rootDir, 'src', file).replace(/\\/g, '/'))};`)
    .join('\n')
);

const bundlePath = path.join(os.tmpdir(), `tma-selftest-bundle-${process.pid}.mjs`);
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

/* ── Handle normalization ────────────────────────────────────────────── */

console.log('handle normalization');
check('strips a leading @', mod.normalizeHandle('@Acme') === 'acme');
check('lower-cases', mod.normalizeHandle('ACME') === 'acme');
check('trims whitespace', mod.normalizeHandle('  acme  ') === 'acme');
check('trims whitespace left after stripping @', mod.normalizeHandle('@ acme') === 'acme');
check('null for null input', mod.normalizeHandle(null) === null);
check('null for undefined input', mod.normalizeHandle(undefined) === null);
check('null for empty string', mod.normalizeHandle('') === null);
check('null for just "@"', mod.normalizeHandle('@') === null);
check('null for whitespace only', mod.normalizeHandle('   ') === null);

/* ── The ownership-match predicate (PRD-45 §5) ──────────────────────────── */

console.log('ownership gate predicate');
check('matches identical handles', mod.handlesMatch('@acme', '@acme') === true);
check('matches case-insensitively', mod.handlesMatch('@Acme', '@acme') === true);
check('matches with/without the leading @ on either side', mod.handlesMatch('acme', '@acme') === true);
check('does not match different handles', mod.handlesMatch('@acme', '@other') === false);
check('does not match when the own handle is null (fail closed)', mod.handlesMatch(null, '@acme') === false);
check('does not match when the author handle is null (fail closed)', mod.handlesMatch('@acme', null) === false);
check('does not match when both are null (fail closed)', mod.handlesMatch(null, null) === false);
check('does not match when both are empty strings (fail closed)', mod.handlesMatch('', '') === false);
check('does not match on a substring/prefix relationship', mod.handlesMatch('@acme', '@acmestore') === false);
check(
  'a confusable-but-different handle never matches (no accidental widening of the gate)',
  mod.handlesMatch('@acme.official', '@acme') === false
);

/* ── URL / id parsing ────────────────────────────────────────────────── */

console.log('url parsing');
check(
  'extracts a handle from a watch url',
  mod.extractHandle('https://www.tiktok.com/@acme/video/7123456789012345678?lang=en') === '@acme'
);
check('extracts a handle from a bare profile url', mod.extractHandle('https://www.tiktok.com/@acme') === '@acme');
check('handle extraction is null without one', mod.extractHandle('https://www.tiktok.com/foryou') === null);
check('handle extraction is null for null/undefined', mod.extractHandle(null) === null && mod.extractHandle(undefined) === null);
check(
  'extracts a video id from a watch url',
  mod.extractVideoId('https://www.tiktok.com/@acme/video/7123456789012345678?lang=en') === '7123456789012345678'
);
check('video id is null without one', mod.extractVideoId('https://www.tiktok.com/@acme') === null);

check('a plain https url is a usable media source', mod.isUsableMediaUrl('https://v16.tiktokcdn.com/abc') === true);
check('a blob url is a usable media source', mod.isUsableMediaUrl('blob:https://www.tiktok.com/abc-123') === true);
check('an empty string is not usable', mod.isUsableMediaUrl('') === false);
check('null is not usable', mod.isUsableMediaUrl(null) === false);
check('undefined is not usable', mod.isUsableMediaUrl(undefined) === false);
check('a data: placeholder is not usable', mod.isUsableMediaUrl('data:image/gif;base64,R0lGOD') === false);

/* ── Filename convention (PRD-45 §4) ────────────────────────────────────── */

console.log('filename building');
check('follows the tiktok-<handle>-<post-id>.mp4 convention', mod.buildFilename('@acme', '123') === 'tiktok-acme-123.mp4');
check('normalizes the handle (case, leading @)', mod.buildFilename('@Acme', '123') === 'tiktok-acme-123.mp4');
check('falls back to "unknown" for an unreadable handle', mod.buildFilename(null, '123') === 'tiktok-unknown-123.mp4');
check(
  'strips filesystem-unsafe characters defensively',
  mod.buildFilename('@ac/me', '1?2') === 'tiktok-acme-12.mp4'
);

/* ── CSV / JSON export ───────────────────────────────────────────────── */

console.log('export');

function logEntry(overrides = {}) {
  return {
    id: '123',
    postUrl: 'https://www.tiktok.com/@acme/video/123',
    handle: 'acme',
    postId: '123',
    filename: 'tiktok-acme-123.mp4',
    savedAt: Date.parse('2026-09-01T00:00:00.000Z'),
    ...overrides,
  };
}

const entries = [logEntry(), logEntry({ id: '456', postId: '456', filename: 'tiktok-acme-456.mp4' })];

const csv = mod.toCsv(entries);
const csvLines = csv.trim().split('\r\n');
check('csv has a header plus one row per entry', csvLines.length === 1 + entries.length);
check('csv header matches the documented columns', csvLines[0] === mod.CSV_HEADER.join(','));
check('csv row carries the filename', csvLines[1].includes('tiktok-acme-123.mp4'));
check('a comma in a field is quoted', mod.toCsv([logEntry({ postUrl: 'https://x.test/a,b' })]).includes('"https://x.test/a,b"'));
check('an empty log exports a header-only csv', mod.toCsv([]).trim().split('\r\n').length === 1);

const json = mod.toJson(entries);
const parsed = JSON.parse(json);
check('json backup carries the format tag', parsed.format === 'tiktok-media-archiver');
check('json backup carries every entry', parsed.entries.length === 2);
check('json backup round-trips a filename', parsed.entries[0].filename === 'tiktok-acme-123.mp4');

check('csv export filename follows the dated convention', /^tiktok-media-archiver-log-\d{4}-\d{2}-\d{2}\.csv$/.test(mod.buildExportFilename('csv')));
check('json export filename uses the .json extension', mod.buildExportFilename('json').endsWith('.json'));

fs.rmSync(entry, { force: true });
fs.rmSync(bundlePath, { force: true });

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
