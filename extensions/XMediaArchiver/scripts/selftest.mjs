/**
 * Headless checks for the pure logic in parse.ts: handle normalization,
 * filename building, CSV/JSON export, and — the load-bearing part of this
 * whole product — the ownership-match predicate and the repost/quote
 * authorship-resolution helper, both exercised with plain structured
 * fixtures rather than a live X session.
 *
 * scrape.ts and content.ts are DOM-bound and cannot be checked headlessly;
 * they are covered by the manual checklist in README.md, the same split
 * every DOM-reading extension in this portfolio uses.
 *
 * Also enforces this PRD's "no network requests beyond the download itself"
 * posture (PRD §6) by grepping src/*.ts for network call sites and failing
 * the build if any exist — chrome.downloads.download is not a fetch/XHR/
 * WebSocket/sendBeacon call, so it does not trip this check.
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

/* ── Privacy posture: no network call sites anywhere in src/ ──────────── */
// Written without the literal substrings themselves so this check doesn't
// false-positive on its own source.
console.log('privacy');
{
  const forbidden = ['fetch' + '(', 'XMLHttpRequest' + '(', '.sendBeacon' + '(', 'new WebSocket' + '('];
  const offenders = [];
  for (const file of fs.readdirSync(srcDir)) {
    if (!file.endsWith('.ts')) continue;
    const contents = fs.readFileSync(path.join(srcDir, file), 'utf8');
    for (const pattern of forbidden) {
      if (contents.includes(pattern)) offenders.push(`${file}: ${pattern}`);
    }
  }
  check('no network-call patterns in src/*.ts', offenders.length === 0, offenders.join(', '));
}

/* ── Bundle the pure module for headless import ─────────────────────────── */

const entry = path.join(os.tmpdir(), `xma-selftest-${process.pid}.mjs`);
fs.writeFileSync(entry, `export * from ${JSON.stringify(path.join(srcDir, 'parse.ts').replace(/\\/g, '/'))};`);

const bundlePath = path.join(os.tmpdir(), `xma-selftest-bundle-${process.pid}.mjs`);
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

/* ── Handle / URL parsing ─────────────────────────────────────────────── */

console.log('parse');
check('normalizeHandle strips a leading @ and lowercases', mod.normalizeHandle('@Jack') === 'jack');
check('normalizeHandle trims whitespace', mod.normalizeHandle('  ada  ') === 'ada');
check('normalizeHandle handles null', mod.normalizeHandle(null) === '');
check('normalizeHandle handles undefined', mod.normalizeHandle(undefined) === '');
check('parseStatusId extracts a numeric id', mod.parseStatusId('https://x.com/jack/status/1234567890') === '1234567890');
check('parseStatusId returns null with no status id', mod.parseStatusId('https://x.com/jack') === null);
check('canonicalStatusUrl builds a lowercase-handle url', mod.canonicalStatusUrl('Jack', '99') === 'https://x.com/jack/status/99');
check('canonicalStatusUrl falls back to /i/status without a handle', mod.canonicalStatusUrl('', '99') === 'https://x.com/i/status/99');
check('isXUrl accepts x.com', mod.isXUrl('https://x.com/jack/status/1'));
check('isXUrl accepts twitter.com subdomains', mod.isXUrl('https://mobile.twitter.com/jack'));
check('isXUrl rejects other sites', !mod.isXUrl('https://example.com'));
check('isXUrl rejects http', !mod.isXUrl('http://x.com'));

/* ── The ownership gate: isOwnPost (PRD §5) ───────────────────────────── */

console.log('isOwnPost — the ownership-match predicate');
check('matching handles, case-insensitive, own the post', mod.isOwnPost('Jack', 'JACK').owned === true);
check('a match reports reason "match"', mod.isOwnPost('jack', 'jack').reason === 'match');
check('a different author never owns the post', mod.isOwnPost('jack', 'ada').owned === false);
check('a mismatch reports reason "mismatch"', mod.isOwnPost('jack', 'ada').reason === 'mismatch');
check('an empty viewer handle fails closed, not open', mod.isOwnPost('', 'jack').owned === false);
check('an empty viewer handle reports reason "no-viewer-handle"', mod.isOwnPost('', 'jack').reason === 'no-viewer-handle');
check('a null viewer handle fails closed', mod.isOwnPost(null, 'jack').owned === false);
check('an empty author handle fails closed, not open', mod.isOwnPost('jack', '').owned === false);
check('an empty author handle reports reason "no-author-handle"', mod.isOwnPost('jack', '').reason === 'no-author-handle');
check('both handles empty fails closed (no accidental "" === "" match)', mod.isOwnPost('', '').owned === false);
check('a leading-@ author handle still matches a plain viewer handle', mod.isOwnPost('jack', '@Jack').owned === true);

/* ── Repost/quote authorship resolution (PRD §4/§5) ───────────────────── */

console.log('resolveMediaAuthor — repost/quote authorship resolution');

const mainAuthor = { author: 'Jack', handle: 'jack' };
const quotedAuthor = { author: 'Ada', handle: 'ada' };

check(
  'media sourced from the main post resolves to the main author',
  mod.resolveMediaAuthor(mainAuthor, quotedAuthor, 'main').handle === 'jack'
);
check(
  'media sourced from a quoted post resolves to the quoted author, not the outer post',
  mod.resolveMediaAuthor(mainAuthor, quotedAuthor, 'quoted').handle === 'ada'
);
check(
  'a "quoted" source with no quoted author present falls back to the main author (no quote-tweet on this post)',
  mod.resolveMediaAuthor(mainAuthor, null, 'quoted').handle === 'jack'
);

console.log('evaluateMediaOwnership — the full gate over structured post data');

function tweet(mainAuthorHandle, media, quotedAuthorHandle = null) {
  return {
    mainAuthor: { author: mainAuthorHandle, handle: mainAuthorHandle },
    quotedAuthor: quotedAuthorHandle ? { author: quotedAuthorHandle, handle: quotedAuthorHandle } : null,
    media,
  };
}

{
  // A plain post the viewer authored — media should be owned.
  const ownPost = tweet('jack', [{ url: 'https://pbs.twimg.com/a.jpg', kind: 'image', source: 'main' }]);
  const result = mod.evaluateMediaOwnership(ownPost, 'jack');
  check('the viewer\'s own post: media is owned', result[0].ownership.owned === true);
  check('the viewer\'s own post: resolved author handle is the post author', result[0].authorHandle === 'jack');
}

{
  // A plain post authored by someone else — never owned, regardless of media count.
  const othersPost = tweet('ada', [{ url: 'https://pbs.twimg.com/a.jpg', kind: 'image', source: 'main' }]);
  const result = mod.evaluateMediaOwnership(othersPost, 'jack');
  check('a post authored by someone else: media is never owned', result[0].ownership.owned === false);
}

{
  // The repost case (PRD §4/§5's non-negotiable rule): scrape.ts reads the
  // article's own byline as mainAuthor, which for a repost is *always* the
  // original author — the reposting account's handle never appears
  // anywhere in this structured input. So even though "jack" is the one
  // who reposted this into his own timeline, the original author is "ada",
  // and the media must never be treated as jack's own.
  const repostedByJackOfAdasPost = tweet('ada', [{ url: 'https://video.twimg.com/a.mp4', kind: 'video', source: 'main' }]);
  const result = mod.evaluateMediaOwnership(repostedByJackOfAdasPost, 'jack');
  check(
    'a repost of someone else\'s post is never owned by the account that reposted it',
    result[0].ownership.owned === false
  );
  check('the resolved author on a repost is the original author, not the reposter', result[0].authorHandle === 'ada');
}

{
  // Quote-tweet split ownership: the viewer quote-tweeted someone else's
  // media with their own added image. The quoting post's own media must be
  // owned; the quoted post's media must not be — same post, two different
  // answers, decided per media item.
  const quoteTweet = tweet(
    'jack',
    [
      { url: 'https://pbs.twimg.com/mine.jpg', kind: 'image', source: 'main' },
      { url: 'https://pbs.twimg.com/theirs.jpg', kind: 'image', source: 'quoted' },
    ],
    'ada'
  );
  const result = mod.evaluateMediaOwnership(quoteTweet, 'jack');
  check('quote-tweet: the quoting post\'s own media is owned', result[0].ownership.owned === true);
  check('quote-tweet: the quoted post\'s media is not owned, even on the viewer\'s own quote-tweet', result[1].ownership.owned === false);
  check('quote-tweet: the quoted media resolves to the quoted author', result[1].authorHandle === 'ada');
}

{
  // Fail-closed: no confirmed viewer handle at all (nav didn't render / logged
  // out) must mean nothing is ever owned, even on the user's unmistakably
  // own-looking post.
  const ownLookingPost = tweet('jack', [{ url: 'https://pbs.twimg.com/a.jpg', kind: 'image', source: 'main' }]);
  const result = mod.evaluateMediaOwnership(ownLookingPost, '');
  check('no confirmed viewer handle: nothing is ever owned', result[0].ownership.owned === false);
  check('no confirmed viewer handle: reason is "no-viewer-handle"', result[0].ownership.reason === 'no-viewer-handle');
}

/* ── Video source selection (PRD §7) ──────────────────────────────────── */

console.log('chooseHighestBitrateVideoSource');
check(
  'picks the highest-resolution source among several',
  mod.chooseHighestBitrateVideoSource([
    { url: 'https://video.twimg.com/320x180/a.mp4', width: 320, height: 180 },
    { url: 'https://video.twimg.com/1280x720/a.mp4', width: 1280, height: 720 },
    { url: 'https://video.twimg.com/640x360/a.mp4', width: 640, height: 360 },
  ]).url === 'https://video.twimg.com/1280x720/a.mp4'
);
check(
  'a blob: source loses to a real dimensioned source (blob URLs never carry real dimension data, so they always score 0)',
  mod.chooseHighestBitrateVideoSource([
    { url: 'blob:https://x.com/abcd-1234', width: null, height: null },
    { url: 'https://video.twimg.com/480x270/a.mp4', width: 480, height: 270 },
  ]).url === 'https://video.twimg.com/480x270/a.mp4'
);
check(
  'a blob: MSE stream is still returned when it is the only source available (confirmed live: it downloads fine via a direct same-document <a download>)',
  mod.chooseHighestBitrateVideoSource([{ url: 'blob:https://x.com/abcd-1234', width: null, height: null }])?.url ===
    'blob:https://x.com/abcd-1234'
);
check('an empty candidate list returns null', mod.chooseHighestBitrateVideoSource([]) === null);
check(
  'a single candidate with unknown dimensions is still chosen',
  mod.chooseHighestBitrateVideoSource([{ url: 'https://video.twimg.com/a.mp4', width: null, height: null }]).url ===
    'https://video.twimg.com/a.mp4'
);

/* ── Filenames (PRD §4: "x-<handle>-<post-id>-<n>.<ext>") ─────────────── */

console.log('filenames');
check('follows the documented convention', mod.buildMediaFilename('Jack', '12345', 1, 'jpg') === 'x-jack-12345-1.jpg');
check('normalizes the handle', mod.buildMediaFilename('@Jack', '12345', 2, 'mp4') === 'x-jack-12345-2.mp4');
check('falls back to "unknown" for an empty handle', mod.buildMediaFilename('', '12345', 1, 'jpg') === 'x-unknown-12345-1.jpg');
check('falls back to "0" for an empty post id', mod.buildMediaFilename('jack', '', 1, 'jpg') === 'x-jack-0-1.jpg');
check('index is floored to at least 1', mod.buildMediaFilename('jack', '1', 0, 'jpg') === 'x-jack-1-1.jpg');
check('strips filesystem-hostile characters from the handle', !/[\\/:*?"<>|]/.test(mod.buildMediaFilename('ja/ck', '1', 1, 'jpg')));

console.log('extensionFromUrl');
check('reads an explicit format query param', mod.extensionFromUrl('https://pbs.twimg.com/media/abc?format=png&name=orig', 'image') === 'png');
check('falls back to the path extension when no format param', mod.extensionFromUrl('https://video.twimg.com/a/b/vid.mp4?tag=12', 'video') === 'mp4');
check('falls back to a kind-appropriate default for an unrecognized URL', mod.extensionFromUrl('https://example.com/media', 'image') === 'jpg');
check('video default is mp4', mod.extensionFromUrl('not a url at all', 'video') === 'mp4');

/* ── Log export (PRD §4: "Export CSV/JSON, clear-all") ────────────────── */

console.log('log export');

const entries = [
  { handle: 'jack', mediaType: 'image', filename: 'x-jack-1-1.jpg', postUrl: 'https://x.com/jack/status/1', savedAt: Date.UTC(2026, 0, 4) },
  { handle: 'jack', mediaType: 'video', filename: 'x-jack-2-1.mp4', postUrl: 'https://x.com/jack/status/2', savedAt: Date.UTC(2026, 0, 5) },
];

const csv = mod.buildLogCsv(entries);
const csvRows = csv.trim().split('\r\n');
check('csv has a header row plus one row per entry', csvRows.length === 1 + entries.length);
check('csv header matches the documented columns', csvRows[0].startsWith('Handle,Media type,Filename,Post URL,Saved date'));
check('csv includes each filename', csv.includes('x-jack-1-1.jpg') && csv.includes('x-jack-2-1.mp4'));

const csvWithComma = mod.buildLogCsv([{ ...entries[0], handle: 'a, b' }]);
check('csv quotes a field containing a comma', csvWithComma.includes('"a, b"'));

const json = mod.buildLogJson(entries);
const parsed = JSON.parse(json);
check('json export round-trips the entries', Array.isArray(parsed.entries) && parsed.entries.length === entries.length);
check('json export is tagged with a format/version', parsed.format === 'x-media-archiver' && parsed.version === 1);

check('csv export filename follows the dated convention', /^x-media-archiver-log-\d{4}-\d{2}-\d{2}\.csv$/.test(mod.buildExportFilename('csv')));
check('json export filename uses the .json extension', mod.buildExportFilename('json').endsWith('.json'));

const emptyCsv = mod.buildLogCsv([]);
check('an empty log still exports a valid header-only CSV', emptyCsv.trim() === 'Handle,Media type,Filename,Post URL,Saved date');

fs.rmSync(entry, { force: true });
fs.rmSync(bundlePath, { force: true });

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
