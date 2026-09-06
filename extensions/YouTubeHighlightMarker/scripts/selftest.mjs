/**
 * Headless checks for the pure logic: mark validation (in/out ordering, short
 * clips, clamping), export formatting (Markdown, CSV, filenames) and the
 * backup merge used by import. Everything DOM-dependent (content.ts,
 * panel.ts, the actual canvas grab) needs a live tab and is covered by the
 * manual checklist in the README instead.
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

const entry = path.join(os.tmpdir(), `yhm-selftest-${process.pid}.mjs`);
fs.writeFileSync(
  entry,
  [
    `export * from ${JSON.stringify(path.join(rootDir, 'src', 'marks.ts').replace(/\\/g, '/'))};`,
    `export * from ${JSON.stringify(path.join(rootDir, 'src', 'export.ts').replace(/\\/g, '/'))};`,
    `export * from ${JSON.stringify(path.join(rootDir, 'src', 'time.ts').replace(/\\/g, '/'))};`,
    `export * from ${JSON.stringify(path.join(rootDir, 'src', 'url.ts').replace(/\\/g, '/'))};`,
    `export { mergeImport } from ${JSON.stringify(path.join(rootDir, 'src', 'storage.ts').replace(/\\/g, '/'))};`,
  ].join('\n')
);

const bundlePath = path.join(os.tmpdir(), `yhm-selftest-bundle-${process.pid}.mjs`);
await build({
  entryPoints: [entry],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: ['node20'],
  outfile: bundlePath,
  logLevel: 'silent',
  // storage.ts references the chrome global at module scope only inside
  // functions that are never called from this bundle, so no shim is needed —
  // but keep external so esbuild doesn't try to resolve a "chrome" package.
  external: [],
});

const mod = await import(pathToFileURL(bundlePath).href);

let failures = 0;
function check(name, condition, detail) {
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/* ── Timestamps & clamping ───────────────────────────────────────────── */

console.log('time');
check('mm:ss under an hour', mod.formatTimestamp(75) === '01:15', mod.formatTimestamp(75));
check('hh:mm:ss over an hour', mod.formatTimestamp(3725) === '01:02:05', mod.formatTimestamp(3725));
check('forced hours', mod.formatTimestamp(75, true) === '00:01:15', mod.formatTimestamp(75, true));
check('clamps below zero', mod.clampSeconds(-5) === 0);
check('clamps to known duration', mod.clampSeconds(999, 100) === 100);
check('clamp near the very end is left alone', mod.clampSeconds(99.9, 100) === 99.9);
check('clamp with unknown duration passes through', mod.clampSeconds(4000) === 4000);
check('a non-finite time becomes zero', mod.clampSeconds(NaN) === 0);

/* ── URL parsing ─────────────────────────────────────────────────────── */

console.log('\nurl');
check(
  'watch URL',
  mod.extractVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=5s') === 'dQw4w9WgXcQ'
);
check('shorts URL', mod.extractVideoId('https://www.youtube.com/shorts/abc123XYZ_-') === 'abc123XYZ_-');
check('youtu.be short link', mod.extractVideoId('https://youtu.be/dQw4w9WgXcQ?t=5') === 'dQw4w9WgXcQ');
check('non-youtube URL', mod.extractVideoId('https://example.com/watch?v=abc') === null);
check('is-youtube accepts a watch URL', mod.isYouTubeUrl('https://www.youtube.com/watch?v=x'));
check('is-youtube rejects an unrelated site', !mod.isYouTubeUrl('https://example.com/'));
check('is-youtube rejects undefined', !mod.isYouTubeUrl(undefined));

/* ── Mark validation: applyPress ─────────────────────────────────────── */

console.log('\napplyPress — pending state');
{
  const first = mod.applyPress(null, 'in', 10, 'thumb-in');
  check('first press starts pending, no pair yet', first.pair === null && first.nextPending.kind === 'in');

  const rePress = mod.applyPress(first.nextPending, 'in', 25, 'thumb-in-2');
  check(
    'pressing the same button again moves the pending point rather than pairing with itself',
    rePress.pair === null && rePress.nextPending.seconds === 25
  );

  const completed = mod.applyPress(rePress.nextPending, 'out', 40, 'thumb-out');
  check('the other button completes the pair', completed.pair !== null && completed.nextPending === null);
  check(
    'the pair carries both original presses',
    completed.pair[0].kind === 'in' && completed.pair[1].kind === 'out'
  );
}

/* ── Mark validation: buildClipCandidate — ordering (PRD §7) ───────────── */

console.log('\nbuildClipCandidate — ordering');
{
  const inFirst = mod.buildClipCandidate(
    { kind: 'in', seconds: 12, thumbnail: 'a' },
    { kind: 'out', seconds: 40, thumbnail: 'b' },
    'vid1'
  );
  check('in-then-out is not flagged as swapped', inFirst.swapped === false);
  check('in/out land in the right fields', inFirst.inSeconds === 12 && inFirst.outSeconds === 40);
  check('thumbnails follow their own point', inFirst.inThumbnail === 'a' && inFirst.outThumbnail === 'b');

  // The edge case the PRD calls out by name: out-point pressed before in-point.
  const outFirst = mod.buildClipCandidate(
    { kind: 'out', seconds: 5, thumbnail: 'early' },
    { kind: 'in', seconds: 30, thumbnail: 'late' },
    'vid1'
  );
  check('out-before-in is corrected, not rejected', outFirst.inSeconds === 5 && outFirst.outSeconds === 30);
  check('out-before-in is flagged as swapped', outFirst.swapped === true);
  check(
    'the thumbnail follows the timestamp, not the original button label',
    outFirst.inThumbnail === 'early' && outFirst.outThumbnail === 'late'
  );

  // Two "in" presses at different times (double mark-in without ever
  // pressing "out") still resolves to a valid, ordered pair if paired.
  const bothIn = mod.buildClipCandidate(
    { kind: 'in', seconds: 50, thumbnail: undefined },
    { kind: 'in', seconds: 20, thumbnail: undefined },
    'vid1'
  );
  check('same-kind pair still sorts by time', bothIn.inSeconds === 20 && bothIn.outSeconds === 50);
}

console.log('\nbuildClipCandidate — short clips & missing thumbnails');
{
  const short = mod.buildClipCandidate(
    { kind: 'in', seconds: 10.2 },
    { kind: 'out', seconds: 10.8 },
    'vid1'
  );
  check('sub-second gap is flagged short', short.isShort === true);

  const notShort = mod.buildClipCandidate({ kind: 'in', seconds: 10 }, { kind: 'out', seconds: 12 }, 'vid1');
  check('a 2s gap is not flagged short', notShort.isShort === false);

  const zero = mod.buildClipCandidate({ kind: 'in', seconds: 15 }, { kind: 'out', seconds: 15 }, 'vid1');
  check('an instant bookmark (equal times) is short, not rejected', zero.isShort === true && zero.outSeconds === 15);

  const noThumb = mod.buildClipCandidate(
    { kind: 'in', seconds: 1, thumbnail: undefined },
    { kind: 'out', seconds: 2, thumbnail: undefined },
    'vid1'
  );
  check('a clip survives with no thumbnail at all (capture failure fallback)', noThumb.inThumbnail === undefined);
}

/* ── sortClips / insertClip / removeClip / setClipNote ─────────────────── */

console.log('\nclip list ops');
{
  const c1 = mod.buildClipCandidate({ kind: 'in', seconds: 50 }, { kind: 'out', seconds: 60 }, 'v', { id: 'a' });
  const c2 = mod.buildClipCandidate({ kind: 'in', seconds: 10 }, { kind: 'out', seconds: 20 }, 'v', { id: 'b' });
  const sorted = mod.sortClips([c1, c2]);
  check('clips sort by in-point ascending', sorted[0].id === 'b' && sorted[1].id === 'a');

  const inserted = mod.insertClip([c2], c1);
  check('insertClip keeps the list sorted', inserted[0].id === 'b' && inserted[1].id === 'a');

  const removed = mod.removeClip(inserted, 'b');
  check('removeClip drops only the matching id', removed.length === 1 && removed[0].id === 'a');

  const noted = mod.setClipNote(inserted, 'a', 'the good part');
  check('setClipNote updates only the matching clip', noted.find(c => c.id === 'a').note === 'the good part');
  check('setClipNote leaves other clips alone', noted.find(c => c.id === 'b').note === '');

  check('clipDuration is out minus in', mod.clipDuration(c1) === 10);
}

/* ── Export: Markdown ────────────────────────────────────────────────── */

console.log('\nmarkdown export');
{
  const meta = { videoId: 'abc123', title: 'A great video', channel: 'Some Channel', url: 'https://www.youtube.com/watch?v=abc123' };
  const clips = [
    mod.buildClipCandidate({ kind: 'in', seconds: 12, thumbnail: 'data:image/jpeg;base64,ZmFrZQ==' }, { kind: 'out', seconds: 45 }, meta.videoId, { id: 'x', note: 'Great line here' }),
    mod.buildClipCandidate({ kind: 'out', seconds: 5 }, { kind: 'in', seconds: 90 }, meta.videoId, { id: 'y' }),
  ];

  const md = mod.toMarkdown(meta, clips);
  check('markdown has a title heading', md.startsWith('# A great video — highlights'));
  check('markdown states the channel and url', md.includes('**Channel:** Some Channel') && md.includes(meta.url));
  check('marks appear in chronological order', md.indexOf('00:05') < md.indexOf('00:12'));
  check('a note is included', md.includes('Great line here'));
  check('an embedded thumbnail is a data URI image', md.includes('![In-point thumbnail'));
  check('a missing thumbnail says so instead of breaking', md.includes('(thumbnail unavailable)'));
  check('a corrected (swapped) mark is flagged in the text', md.includes('marks corrected to in/out order'));
  check('timestamps link back to the moment', md.includes(`${meta.url}&t=5`));

  const empty = mod.toMarkdown(meta, []);
  check('an empty clip list produces a valid, non-broken document', empty.includes('No highlights marked yet'));
}

/* ── Export: CSV ─────────────────────────────────────────────────────── */

console.log('\ncsv export');
{
  const meta = { videoId: 'abc123', title: 'Quotes, "the" sequel', channel: 'C', url: 'https://www.youtube.com/watch?v=abc123' };
  const clips = [
    mod.buildClipCandidate(
      { kind: 'in', seconds: 12, thumbnail: 'data:image/jpeg;base64,ZmFrZQ==' },
      { kind: 'out', seconds: 20 },
      meta.videoId,
      { id: 'x', note: 'a note with, a comma and a "quote"' }
    ),
  ];
  const csv = mod.toCsv(meta, clips);
  const lines = csv.trim().split('\r\n');
  check('header row is present', lines[0].startsWith('index,in_timestamp'));
  check('exactly one data row for one clip', lines.length === 2);
  check('no image data appears anywhere in the CSV', !csv.includes('data:image'));
  check('a comma inside a field is quoted', lines[1].includes('"a note with, a comma and a ""quote"""'));
  check('the has_thumbnail column reports yes when a thumbnail exists', csv.includes(',yes,'));
}

/* ── Filenames ───────────────────────────────────────────────────────── */

console.log('\nfilenames');
{
  const meta = { videoId: 'x', title: 'How to build things: a "practical" guide / part 1', channel: 'Some Channel', url: 'https://www.youtube.com/watch?v=x' };
  const filename = mod.buildFilename(meta, 'md');
  check(
    'follows the convention',
    filename === 'Some Channel - How to build things a practical guide part 1 - highlights.md',
    filename
  );
  check('drops filesystem-hostile characters', !/[\\/:*?"<>|]/.test(filename));

  const long = mod.buildFilename({ ...meta, title: 'x'.repeat(400), channel: 'y'.repeat(80) }, 'csv');
  check('truncates to 120 characters', long.length <= 120, `${long.length} chars`);
  check('keeps the extension after truncation', long.endsWith(' - highlights.csv'));

  const blank = mod.buildFilename({ videoId: 'x', title: '', channel: '', url: '' }, 'md');
  check('falls back to a sane name with no metadata at all', blank === 'youtube - highlights.md', blank);
}

/* ── Backup merge (import) ──────────────────────────────────────────── */

console.log('\nbackup merge');
{
  const clipA = mod.buildClipCandidate({ kind: 'in', seconds: 1 }, { kind: 'out', seconds: 2 }, 'v1', { id: 'a' });
  const clipB = mod.buildClipCandidate({ kind: 'in', seconds: 3 }, { kind: 'out', seconds: 4 }, 'v1', { id: 'b' });

  const existing = { v1: [clipA] };
  const backup = { format: 'youtube-highlight-marker-backup', version: 1, exportedAt: '2026-01-01', clipsByVideo: { v1: [clipA, clipB] } };

  const { merged, result } = mod.mergeImport(existing, backup);
  check('importing merges by id, not blind concatenation', merged.v1.length === 2);
  check('only the genuinely new clip is counted', result.clipsImported === 1 && result.videosImported === 1);

  const { result: reImportResult } = mod.mergeImport(merged, backup);
  check('importing the same backup twice never duplicates a clip', reImportResult.clipsImported === 0);

  let threw = false;
  try {
    mod.mergeImport({}, { not: 'a backup' });
  } catch {
    threw = true;
  }
  check('a file that is not a recognized backup is rejected, not silently accepted', threw);
}

fs.rmSync(entry, { force: true });
fs.rmSync(bundlePath, { force: true });

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
