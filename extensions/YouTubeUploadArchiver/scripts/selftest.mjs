/**
 * Headless checks for the pure logic: channel-key normalizing and the
 * ownership-match predicate, video-id/URL parsing, displayed-count parsing,
 * metadata-snapshot assembly (archive + "update in place, don't duplicate"
 * re-archive semantics), search, filenames, and the CSV/Markdown export
 * formatters. The DOM-bound half (scrape.ts, content.ts) needs a real
 * browser and a live YouTube/Studio page, and is covered by the manual
 * checklist in README.md instead — same split every DOM-reading extension in
 * this portfolio uses.
 *
 * Also enforces the one hard line in PRD-47 (§2/§4): this extension must
 * never construct, request or even name a URL from YouTube's signed
 * video-streaming CDN. That domain is deliberately never spelled out in this
 * file either — split across two string literals below — so this check
 * can't false-positive on itself, mirroring how XBookmarkOrganizer's own
 * selftest avoids writing out the network-call substrings it greps for.
 * Also greps for the general network-call surface (fetch/XHR/WebSocket/
 * sendBeacon) as a second guardrail, since this extension has no server to
 * talk to at all beyond the one sanctioned chrome.downloads.download() call.
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
const srcDir = path.join(rootDir, 'src');

let failures = 0;
function check(name, condition, detail) {
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${detail !== undefined ? ` — ${detail}` : ''}`);
  }
}

/* ── The one hard line: never touch the video stream ───────────────────── */

console.log('stream guardrail');

// Built without ever writing the literal domain in this file.
const STREAM_DOMAIN = 'google' + 'video.com';
const NETWORK_PATTERNS = ['fetch' + '(', 'XMLHttpRequest' + '(', '.sendBeacon' + '(', 'new WebSocket' + '('];

const srcFiles = fs
  .readdirSync(srcDir, { withFileTypes: true })
  .filter(entry => entry.isFile() && entry.name.endsWith('.ts'))
  .map(entry => entry.name);

let streamHit = null;
let networkHit = null;
for (const file of srcFiles) {
  const content = fs.readFileSync(path.join(srcDir, file), 'utf8');
  if (content.includes(STREAM_DOMAIN)) streamHit = file;
  for (const needle of NETWORK_PATTERNS) {
    if (content.includes(needle)) networkHit = `${file}: ${needle}`;
  }
}
check('no reference anywhere in src/*.ts to the video-streaming CDN domain', streamHit === null, streamHit ?? undefined);
check('no fetch/XHR/WebSocket/sendBeacon call anywhere in src/*.ts', networkHit === null, networkHit ?? undefined);

// The one legitimate network-touching call in the whole extension is
// chrome.downloads.download(), and it must exist (that's how the thumbnail
// image gets saved) — its absence would mean the Archive feature silently
// stopped working, which is just as much a regression as the guardrails
// above catching something it shouldn't.
const backgroundSrc = fs.readFileSync(path.join(srcDir, 'background.ts'), 'utf8');
check('the thumbnail download call exists in background.ts', backgroundSrc.includes('chrome.downloads.download('));

/* ── Bundle the pure modules for headless testing ──────────────────────── */

const entry = path.join(os.tmpdir(), `yua-selftest-${process.pid}.mjs`);
fs.writeFileSync(
  entry,
  ['parse.ts']
    .map(file => `export * from ${JSON.stringify(path.join(srcDir, file).replace(/\\/g, '/'))};`)
    .join('\n')
);

const bundlePath = path.join(os.tmpdir(), `yua-selftest-bundle-${process.pid}.mjs`);
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

/* ── Channel identity / the ownership gate ──────────────────────────────── */

console.log('ownership gate');
check('normalizes a handle to lowercase', mod.normalizeChannelKey('@MyChannel') === '@mychannel');
check('leaves a channel id case as-is', mod.normalizeChannelKey('UCabc123XYZ') === 'UCabc123XYZ');
check('trims whitespace', mod.normalizeChannelKey('  @creator  ') === '@creator');
check('empty/undefined normalizes to empty string', mod.normalizeChannelKey(undefined) === '' && mod.normalizeChannelKey('') === '');

check('matches when the viewed channel id is in the owned list', mod.isOwnChannelMatch(['UCabc123', '@myhandle'], 'UCabc123'));
check('matches a handle case-insensitively', mod.isOwnChannelMatch(['@MyHandle'], '@myhandle'));
check('does not match a channel not in the owned list', !mod.isOwnChannelMatch(['UCabc123'], 'UCzzz999'));
check('fails closed on an empty owned-channels list (nothing confirmed)', !mod.isOwnChannelMatch([], 'UCabc123'));
check('fails closed on a null viewed channel (nothing to compare against)', !mod.isOwnChannelMatch(['UCabc123'], null));
check('fails closed on an undefined viewed channel', !mod.isOwnChannelMatch(['UCabc123'], undefined));
check('fails closed on an empty-string viewed channel', !mod.isOwnChannelMatch(['UCabc123'], ''));

/* ── Video ids and URLs ──────────────────────────────────────────────────── */

console.log('video ids / urls');
check('extracts a watch id', mod.parseVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ') === 'dQw4w9WgXcQ');
check('extracts a watch id with extra params', mod.parseVideoId('/watch?v=dQw4w9WgXcQ&list=PL1') === 'dQw4w9WgXcQ');
check('extracts a shorts id', mod.parseVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ') === 'dQw4w9WgXcQ');
check('extracts a live id', mod.parseVideoId('https://www.youtube.com/live/dQw4w9WgXcQ') === 'dQw4w9WgXcQ');
check('extracts a studio video id', mod.parseVideoId('https://studio.youtube.com/video/dQw4w9WgXcQ/edit') === 'dQw4w9WgXcQ');
check('returns null with nothing to extract', mod.parseVideoId('https://www.youtube.com/@somechannel') === null);
check('returns null for an empty/undefined href', mod.parseVideoId('') === null && mod.parseVideoId(undefined) === null);

check('builds the canonical watch url', mod.canonicalWatchUrl('abc123') === 'https://www.youtube.com/watch?v=abc123');
check('builds the studio edit url', mod.studioEditUrl('abc123') === 'https://studio.youtube.com/video/abc123/edit');
check('the studio url never points at a download deep link that does not exist', !mod.studioEditUrl('abc123').includes('download'));

/* ── Displayed counts ────────────────────────────────────────────────────── */

console.log('displayed counts');
check('parses plain counts', mod.parseDisplayedCount('1,204') === 1204);
check('parses K suffix', mod.parseDisplayedCount('1.2K views') === 1200);
check('parses M suffix', mod.parseDisplayedCount('3.4M') === 3400000);
check('returns null for nothing usable (never 0)', mod.parseDisplayedCount('') === null);
check('returns null for undefined', mod.parseDisplayedCount(undefined) === null);
check('returns null for text with no digits', mod.parseDisplayedCount('Likes hidden') === null);

/* ── Metadata-snapshot assembly + "update in place" ─────────────────────── */

console.log('record assembly');

function scraped(overrides = {}) {
  return {
    videoId: 'abc123',
    url: 'https://www.youtube.com/watch?v=abc123',
    title: 'My Upload',
    description: 'Original description',
    publishDateText: 'Sep 1, 2026',
    views: 100,
    likes: 10,
    thumbnailUrl: 'https://i.ytimg.com/vi/abc123/hqdefault.jpg',
    ...overrides,
  };
}

const firstArchive = mod.buildRecord(scraped(), null, 'UCabc123', 1000);
check('a fresh archive stamps archivedAt to now', firstArchive.archivedAt === 1000);
check('a fresh archive stamps updatedAt to now', firstArchive.updatedAt === 1000);
check('a fresh archive starts with no saved thumbnail timestamp', firstArchive.thumbnailSavedAt === null);
check('carries the channel key it was confirmed under', firstArchive.channelKey === 'UCabc123');
check('carries the studio url derived from the video id', firstArchive.studioUrl === 'https://studio.youtube.com/video/abc123/edit');

const savedThumb = mod.markThumbnailSaved(firstArchive, 1500);
check('markThumbnailSaved stamps the save time', savedThumb.thumbnailSavedAt === 1500);
check('markThumbnailSaved does not touch archivedAt', savedThumb.archivedAt === 1000);

// Re-archiving the same video (title/description edited since) must update
// in place, not duplicate (PRD §7).
const reArchived = mod.buildRecord(
  scraped({ title: 'My Upload (renamed)', description: 'Edited description', views: 500 }),
  savedThumb,
  'UCabc123',
  2000
);
check('re-archiving keeps the original archivedAt', reArchived.archivedAt === 1000);
check('re-archiving updates updatedAt to the new time', reArchived.updatedAt === 2000);
check('re-archiving refreshes the captured title', reArchived.title === 'My Upload (renamed)');
check('re-archiving refreshes the captured description', reArchived.description === 'Edited description');
check('re-archiving refreshes captured stats', reArchived.views === 500);
check('re-archiving keeps the already-saved thumbnail timestamp', reArchived.thumbnailSavedAt === 1500);

// PRD §7: a thumbnail not yet generated must not block the metadata entry.
const noThumbYet = mod.buildRecord(scraped({ thumbnailUrl: '' }), null, 'UCabc123', 1000);
check('an archive with no thumbnail url yet still builds a full record', noThumbYet.title === 'My Upload' && noThumbYet.thumbnailUrl === '');

/* ── Search ──────────────────────────────────────────────────────────────── */

console.log('search');
check('matchesRecordSearch finds text in the title', mod.matchesRecordSearch(firstArchive, 'my upload'));
check('matchesRecordSearch finds text in the description', mod.matchesRecordSearch(firstArchive, 'original'));
check('matchesRecordSearch finds the video id', mod.matchesRecordSearch(firstArchive, 'abc123'));
check('matchesRecordSearch rejects unrelated queries', !mod.matchesRecordSearch(firstArchive, 'nonexistent'));
check('an empty query matches everything', mod.matchesRecordSearch(firstArchive, ''));

/* ── Filenames ───────────────────────────────────────────────────────────── */

console.log('filenames');
const fixedDate = new Date('2026-09-06T12:00:00.000Z');
check('csv filename follows the dated convention', mod.buildExportFilename('csv', fixedDate) === 'youtube-upload-archiver-2026-09-06.csv');
check('json filename uses the .json extension', mod.buildExportFilename('json', fixedDate).endsWith('.json'));

check('thumbnail filename is namespaced under the extension folder', mod.buildThumbnailFilename('abc123', 'My Upload').startsWith('youtube-upload-archiver/'));
check('thumbnail filename includes the video id', mod.buildThumbnailFilename('abc123', 'My Upload').includes('abc123'));
// Check only the part built from the title, not the whole path — the
// leading "youtube-upload-archiver/" folder separator is intentional (PRD
// intent: namespace archived thumbnails under their own subfolder), not a
// path-hostile character that leaked in from the video's title.
const sanitized = mod.buildThumbnailFilename('abc123', 'Q&A: "live" / special <chars>');
const sanitizedBase = sanitized.replace(/^youtube-upload-archiver\//, '');
check('thumbnail filename strips path-hostile characters from the title', !/["/\\:*?<>|]/.test(sanitizedBase), sanitized);
check('thumbnail filename falls back to the video id alone for an empty title', mod.buildThumbnailFilename('abc123', '') === 'youtube-upload-archiver/abc123.jpg');

/* ── Export formats ──────────────────────────────────────────────────────── */

console.log('exports');

const records = [
  firstArchive,
  mod.buildRecord(
    scraped({ videoId: 'zzz999', url: 'https://www.youtube.com/watch?v=zzz999', title: 'Second video, with a "quote" and, a comma', description: '' }),
    null,
    'UCabc123',
    1000
  ),
];

const csv = mod.toCsv(records);
const csvRows = csv.trim().split('\r\n');
check('csv has a header row plus one row per record', csvRows.length === 1 + records.length);
check('csv header matches the documented columns', csvRows[0].startsWith('Video ID,Title,Description'));
check('csv quotes a field containing a comma and a quote', csv.includes('"Second video, with a ""quote"" and, a comma"'));
check('csv leaves views/likes blank when null', mod.toCsv([mod.buildRecord(scraped({ views: null, likes: null }), null, 'UCabc123', 1000)]).includes(',,https://'));

const md = mod.toMarkdown(records);
check('markdown includes each title as a heading', md.includes('## My Upload') && md.includes('## Second video'));
check('markdown includes a watch link', md.includes('[Watch on YouTube](https://www.youtube.com/watch?v=abc123)'));
check('markdown includes a studio link', md.includes('[Open in YouTube Studio](https://studio.youtube.com/video/abc123/edit)'));
check('markdown reports an absent stat as "not shown", never 0', mod.toMarkdown([mod.buildRecord(scraped({ likes: null }), null, 'UCabc123', 1000)]).includes('Likes: not shown'));

const emptyMd = mod.toMarkdown([]);
check('an empty archive exports without throwing', emptyMd.includes('No videos archived yet'));

fs.rmSync(entry, { force: true });
fs.rmSync(bundlePath, { force: true });

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
