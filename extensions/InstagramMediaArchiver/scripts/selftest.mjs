/**
 * Headless checks for the pure logic: handle normalization, the
 * ownership-match predicate (PRD §5) given two plain handle strings, the
 * filename convention, post-id extraction, and the CSV/JSON export
 * formatters. The DOM-bound half (scrape.ts, content.ts) needs a real
 * browser and Instagram's live markup, and is covered by the manual
 * checklist in README.md — the same split every Instagram/X extension in
 * this portfolio uses for its scrape.ts.
 *
 * Also enforces two build-time postures statically, by reading
 * scripts/build.mjs's source rather than running a full build:
 *   - PRD §6's exact permission set (activeTab, downloads, storage; host
 *     access to instagram.com only; no "tabs", no "<all_urls>")
 *   - the Web Store's short_name/description length limits
 * and PRD §6's "no network requests" posture, by grepping src/*.ts for
 * network call sites.
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

/* ── Manifest posture: read straight from scripts/build.mjs ───────────── */

console.log('manifest');
const buildSrc = fs.readFileSync(path.join(rootDir, 'scripts', 'build.mjs'), 'utf8');

const shortNameMatch = buildSrc.match(/short_name:\s*'([^']*)'/);
check('short_name is present', !!shortNameMatch);
check(
  'short_name is <=12 chars',
  !!shortNameMatch && shortNameMatch[1].length <= 12,
  shortNameMatch ? `"${shortNameMatch[1]}" (${shortNameMatch[1].length} chars)` : undefined
);

const descMatch = buildSrc.match(/description:\s*\n?\s*["']((?:[^"'\\]|\\.)*)["']/);
check('description is present', !!descMatch);
check(
  'description is <=132 chars',
  !!descMatch && descMatch[1].length <= 132,
  descMatch ? `${descMatch[1].length} chars` : undefined
);

const permissionsMatch = buildSrc.match(/[^_]permissions:\s*\[([^\]]*)\]/);
const permissions = permissionsMatch
  ? permissionsMatch[1]
      .split(',')
      .map(s => s.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean)
  : [];
check(
  'permissions are exactly activeTab, downloads, storage',
  JSON.stringify([...permissions].sort()) === JSON.stringify(['activeTab', 'downloads', 'storage'].sort()),
  JSON.stringify(permissions)
);
check('permissions do not include "tabs"', !permissions.includes('tabs'));

const hostMatch = buildSrc.match(/HOST_PATTERNS\s*=\s*\[([^\]]*)\]/);
const hostPermissions = hostMatch
  ? hostMatch[1]
      .split(',')
      .map(s => s.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean)
  : [];
check(
  'host_permissions are exactly *://*.instagram.com/*',
  JSON.stringify(hostPermissions) === JSON.stringify(['*://*.instagram.com/*']),
  JSON.stringify(hostPermissions)
);
check('host_permissions do not include <all_urls>', !hostPermissions.some(p => p.includes('<all_urls>')));

/* ── Bundle the pure modules for headless testing ───────────────────── */

const entry = path.join(os.tmpdir(), `ima-selftest-${process.pid}.mjs`);
fs.writeFileSync(
  entry,
  ['parse.ts', 'formatters.ts']
    .map(file => `export * from ${JSON.stringify(path.join(rootDir, 'src', file).replace(/\\/g, '/'))};`)
    .join('\n')
);

const bundlePath = path.join(os.tmpdir(), `ima-selftest-bundle-${process.pid}.mjs`);
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

/* ── Handle normalization ──────────────────────────────────────────────── */

console.log('normalizeHandle');
check('lowercases', mod.normalizeHandle('JaneDoe') === 'janedoe');
check('strips a leading @', mod.normalizeHandle('@jane.doe') === 'jane.doe');
check('trims whitespace', mod.normalizeHandle('  jane  ') === 'jane');
check('empty string normalizes to empty', mod.normalizeHandle('') === '');
check('null normalizes to empty', mod.normalizeHandle(null) === '');
check('undefined normalizes to empty', mod.normalizeHandle(undefined) === '');
check('a handle with a space is invalid -> empty', mod.normalizeHandle('jane doe') === '');
check('a handle with a slash is invalid -> empty', mod.normalizeHandle('jane/doe') === '');
check('periods and underscores are allowed', mod.normalizeHandle('jane._doe_99') === 'jane._doe_99');

/* ── The ownership gate: handlesMatch ─────────────────────────────────── */
// This is PRD §5's entire premise — fail closed, never "unknown, so allow".

console.log('handlesMatch (the ownership gate)');
check('identical handles match', mod.handlesMatch('jane', 'jane') === true);
check('matches case-insensitively', mod.handlesMatch('Jane', 'jane') === true);
check('matches through a leading @ on either side', mod.handlesMatch('@jane', 'jane') === true);
check('matches through a leading @ on both sides', mod.handlesMatch('@Jane', '@JANE') === true);
check('different handles do not match', mod.handlesMatch('jane', 'bob') === false);
check('a substring is not a match', mod.handlesMatch('jane', 'janedoe') === false);

check('null logged-in handle fails closed (no button)', mod.handlesMatch(null, 'jane') === false);
check('null author handle fails closed (no button)', mod.handlesMatch('jane', null) === false);
check('both null fails closed', mod.handlesMatch(null, null) === false);
check('undefined on either side fails closed', mod.handlesMatch(undefined, 'jane') === false);
check('empty-string logged-in handle fails closed', mod.handlesMatch('', 'jane') === false);
check('empty-string author handle fails closed', mod.handlesMatch('jane', '') === false);
check('both empty-string fails closed', mod.handlesMatch('', '') === false);
check('malformed logged-in handle (spaces) fails closed even if the text matches', mod.handlesMatch('jane doe', 'jane doe') === false);

/* ── isProfilePath ─────────────────────────────────────────────────────── */

console.log('isProfilePath');
check('a normal handle is a profile path', mod.isProfilePath('gabriel') === true);
check('"p" (post route) is reserved, not a profile', mod.isProfilePath('p') === false);
check('"reel" is reserved, not a profile', mod.isProfilePath('reel') === false);
check('"explore" is reserved, not a profile', mod.isProfilePath('explore') === false);
check('reserved check is case-insensitive', mod.isProfilePath('Explore') === false);
check('a handle with invalid characters is not a profile path', mod.isProfilePath('jane doe') === false);

/* ── postIdFromUrl ─────────────────────────────────────────────────────── */

console.log('postIdFromUrl');
check(
  'extracts a post shortcode',
  mod.postIdFromUrl('https://www.instagram.com/p/Cxyz123/') === 'Cxyz123'
);
check(
  'extracts a reel shortcode',
  mod.postIdFromUrl('https://www.instagram.com/reel/Cabc999/') === 'Cabc999'
);
check(
  'extracts a shortcode even with query params',
  mod.postIdFromUrl('https://www.instagram.com/p/Cxyz123/?img_index=2') === 'Cxyz123'
);
check('a profile URL has no post id', mod.postIdFromUrl('https://www.instagram.com/gabriel/') === '');
check('empty input returns empty', mod.postIdFromUrl('') === '');
check('null input returns empty', mod.postIdFromUrl(null) === '');

/* ── buildFilename ─────────────────────────────────────────────────────── */

console.log('buildFilename (instagram-<handle>-<post-id>-<n>.<ext>)');
check(
  'builds the documented convention: instagram-<handle>-<post-id>-<n>.<ext>',
  mod.buildFilename('Jane', 'Cxyz123', 1, 'https://cdn.example.com/photo.jpg?x=1', 'image') === 'instagram-jane-Cxyz123-1.jpg',
  mod.buildFilename('Jane', 'Cxyz123', 1, 'https://cdn.example.com/photo.jpg?x=1', 'image')
);
check(
  'handle is normalized (lowercased) in the filename',
  mod.buildFilename('Jane', 'Cxyz123', 1, 'https://cdn.example.com/photo.jpg', 'image').startsWith('instagram-jane-')
);
check(
  'extension is read from the media URL',
  mod.buildFilename('jane', 'abc', 2, 'https://cdn.example.com/video.mp4', 'video').endsWith('-2.mp4')
);
check(
  'a URL with no discernible extension falls back by media kind (image -> jpg)',
  mod.buildFilename('jane', 'abc', 1, 'https://cdn.example.com/blob', 'image').endsWith('.jpg')
);
check(
  'a URL with no discernible extension falls back by media kind (video -> mp4)',
  mod.buildFilename('jane', 'abc', 1, 'https://cdn.example.com/blob', 'video').endsWith('.mp4')
);
check(
  'an unreadable handle falls back to "unknown" rather than throwing',
  mod.buildFilename('', 'abc', 1, 'https://cdn.example.com/a.jpg', 'image').startsWith('instagram-unknown-')
);
check(
  'a post id with unsafe characters is sanitized',
  !/[^a-zA-Z0-9._-]/.test(mod.buildFilename('jane', 'abc/../123', 1, 'https://cdn.example.com/a.jpg', 'image'))
);
check('slide index appears before the extension', /-\d+\.[a-z0-9]+$/.test(mod.buildFilename('jane', 'abc', 3, 'https://x/a.jpg', 'image')));

/* ── logEntryId ────────────────────────────────────────────────────────── */

console.log('logEntryId');
check('combines post id and index', mod.logEntryId('abc123', 2) === 'abc123-2');
check('re-saving the same slide produces the same id (update, not duplicate)', mod.logEntryId('abc123', 2) === mod.logEntryId('abc123', 2));

/* ── Export formats ────────────────────────────────────────────────────── */

console.log('exports');

const entries = [
  {
    id: 'abc123-1',
    postUrl: 'https://www.instagram.com/p/abc123/',
    postId: 'abc123',
    handle: 'jane',
    mediaKind: 'image',
    filename: 'instagram-jane-abc123-1.jpg',
    savedAt: Date.parse('2026-01-02T03:04:05.000Z'),
  },
  {
    id: 'def456-1',
    postUrl: 'https://www.instagram.com/reel/def456/',
    postId: 'def456',
    handle: 'jane',
    mediaKind: 'video',
    filename: 'instagram-jane-def456-1.mp4',
    savedAt: Date.parse('2026-01-03T00:00:00.000Z'),
  },
];

const csv = mod.toCsv(entries);
const csvRows = csv.trim().split('\r\n');
check('csv has a header row plus one row per entry', csvRows.length === 1 + entries.length);
check('csv header names the documented columns', csvRows[0].startsWith('Saved at,Handle,Post URL'));
check('csv includes the filename', csv.includes('instagram-jane-abc123-1.jpg'));
check('csv includes the media type', csv.includes('image') && csv.includes('video'));

const commaEntry = [
  { ...entries[0], handle: 'jane, doe', filename: 'a"b,c.jpg' },
];
const csvQuoted = mod.toCsv(commaEntry);
check('csv quotes a field containing a comma', csvQuoted.includes('"jane, doe"'));
check('csv escapes an embedded quote', csvQuoted.includes('"a""b,c.jpg"'));

const backup = mod.toBackup(entries);
check('backup carries the documented format tag', backup.format === 'instagram-media-archiver');
check('backup carries all entries', backup.entries.length === entries.length);

const json = mod.toJson(entries);
const parsed = JSON.parse(json);
check('json round-trips the format tag', parsed.format === 'instagram-media-archiver');
check('json round-trips every entry', parsed.entries.length === entries.length);

check('csv export filename follows the dated convention', /^instagram-media-archiver-log-\d{4}-\d{2}-\d{2}\.csv$/.test(mod.buildExportFilename('csv')));
check('json export filename uses the .json extension', mod.buildExportFilename('json').endsWith('.json'));

fs.rmSync(entry, { force: true });
fs.rmSync(bundlePath, { force: true });

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
