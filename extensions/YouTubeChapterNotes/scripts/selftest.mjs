/**
 * Headless checks for the pure logic: url parsing, note CRUD + draft
 * continuation, the two export formats, filenames and import merge-by-id
 * semantics. The DOM-bound half (content.ts, panel.ts) needs a real browser
 * and a live YouTube page, and is covered by the manual checklist in the
 * README instead — same split every other extension in this portfolio uses.
 *
 * Also greps src/*.ts for any network-capable call, so PRIVACY.md's "no
 * network requests" claim stays true rather than merely believed. Careful
 * not to literally type those exact substrings-with-parens anywhere else in
 * this file, or the grep would false-positive on itself.
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
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/* ── No network calls anywhere in the source ───────────────────────────── */

console.log('privacy');
const NETWORK_PATTERNS = ['fetch(', 'XMLHttpRequest(', '.sendBeacon(', 'new WebSocket('];
const srcDir = path.join(rootDir, 'src');
const offenders = [];
for (const file of fs.readdirSync(srcDir)) {
  if (!file.endsWith('.ts')) continue;
  const text = fs.readFileSync(path.join(srcDir, file), 'utf8');
  for (const pattern of NETWORK_PATTERNS) {
    if (text.includes(pattern)) offenders.push(`${file}: ${pattern}`);
  }
}
check('no network-capable calls in src/*.ts', offenders.length === 0, offenders.join(', '));

/* ── Bundle the pure modules and run the rest headlessly ──────────────── */

const entry = path.join(os.tmpdir(), `ycn-selftest-${process.pid}.mjs`);
fs.writeFileSync(
  entry,
  ['notes.ts', 'backup.ts', 'formatters.ts', 'url.ts', 'types.ts']
    .map(file => `export * from ${JSON.stringify(path.join(rootDir, 'src', file).replace(/\\/g, '/'))};`)
    .join('\n')
);

const bundlePath = path.join(os.tmpdir(), `ycn-selftest-bundle-${process.pid}.mjs`);
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

/* ── URL / video id parsing ─────────────────────────────────────────────── */

console.log('url parsing');
check('accepts www.youtube.com', mod.isYouTubeUrl('https://www.youtube.com/watch?v=abc123'));
check('accepts a youtube subdomain', mod.isYouTubeUrl('https://m.youtube.com/watch?v=abc123'));
check('rejects a different site', mod.isYouTubeUrl('https://youtube.com.evil.example/') === false);
check('rejects chrome pages', mod.isYouTubeUrl('chrome://extensions') === false);
check('rejects undefined', mod.isYouTubeUrl(undefined) === false);

check('extracts a watch id', mod.extractVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ') === 'dQw4w9WgXcQ');
check('extracts a watch id with extra params', mod.extractVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s&list=PL1') === 'dQw4w9WgXcQ');
check('extracts a live id', mod.extractVideoId('https://www.youtube.com/live/dQw4w9WgXcQ') === 'dQw4w9WgXcQ');
check('extracts a shorts id', mod.extractVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ') === 'dQw4w9WgXcQ');
check('returns null for a channel page', mod.extractVideoId('https://www.youtube.com/@somechannel') === null);
check('returns null for the homepage', mod.extractVideoId('https://www.youtube.com/') === null);
check('returns null off youtube entirely', mod.extractVideoId('https://example.com/watch?v=dQw4w9WgXcQ') === null);

check(
  'builds a jump link with whole seconds',
  mod.youtubeTimestampUrl('abc123', 92.7) === 'https://www.youtube.com/watch?v=abc123&t=92s'
);
check('jump link floors negative input to 0', mod.youtubeTimestampUrl('abc123', -5) === 'https://www.youtube.com/watch?v=abc123&t=0s');

/* ── Note CRUD ───────────────────────────────────────────────────────── */

console.log('notes');

function newNoteInput(overrides = {}) {
  return {
    videoId: 'abc123',
    videoTitle: 'A Long Lecture',
    seconds: 754,
    text: '  This is the key claim.  ',
    isLive: false,
    ...overrides,
  };
}

const firstSave = mod.addNote([], newNoteInput());
check('a new note gets an id', firstSave.note.id.startsWith('n_'), firstSave.note.id);
check('note text is trimmed', firstSave.note.text === 'This is the key claim.');
check('addNote grows the list by one', firstSave.notes.length === 1);

const secondSave = mod.addNote(firstSave.notes, newNoteInput({ seconds: 754, text: 'A second thought at the same moment.' }));
check('two notes at the same timestamp are both kept (not deduped)', secondSave.notes.length === 2);

const edited = mod.editNoteText(secondSave.notes, firstSave.note.id, 'Updated text.');
check('editNoteText updates only the target note', edited.find(n => n.id === firstSave.note.id).text === 'Updated text.');
check('editNoteText leaves the other note alone', edited.find(n => n.id === secondSave.note.id).text === 'A second thought at the same moment.');

const removed = mod.removeNote(edited, firstSave.note.id);
check('removeNote drops the note', removed.length === 1);
check('removeNote keeps the other note', removed[0].id === secondSave.note.id);

const otherVideoSave = mod.addNote(secondSave.notes, newNoteInput({ videoId: 'zzz999', seconds: 10, text: 'Different video.' }));
const forVideo = mod.notesForVideo(otherVideoSave.notes, 'abc123');
check('notesForVideo filters to one video', forVideo.every(n => n.videoId === 'abc123'));
check('notesForVideo sorts by timestamp ascending', forVideo[0].seconds <= forVideo[forVideo.length - 1].seconds);

const summary = mod.summarizeVideos(otherVideoSave.notes);
check('summarizeVideos returns one row per video', summary.length === 2);
check('summarizeVideos counts notes per video', summary.find(v => v.videoId === 'abc123').count === 2);

console.log('draft continuation');
const draft = { videoId: 'abc123', videoTitle: 'A Long Lecture', seconds: 300, text: 'half-typed thought', updatedAt: 1 };
check('continues a draft for the same video with text', mod.continueDraftFor(draft, 'abc123') === draft);
check('does not continue a draft for a different video', mod.continueDraftFor(draft, 'zzz999') === null);
check('does not continue an empty draft', mod.continueDraftFor({ ...draft, text: '   ' }, 'abc123') === null);
check('handles a null draft', mod.continueDraftFor(null, 'abc123') === null);

/* ── Import merge-by-id ──────────────────────────────────────────────── */

console.log('import');

const backupData = mod.buildBackup(secondSave.notes, '2026-09-02T00:00:00.000Z');
check('buildBackup carries the format tag', backupData.format === 'youtube-chapter-notes');
check('buildBackup carries the version', backupData.version === 1);

let threw = false;
try {
  mod.mergeImport([], { format: 'something-else', notes: [] });
} catch {
  threw = true;
}
check('an unrecognised file is rejected', threw);

const firstImport = mod.mergeImport([], backupData);
check('a fresh import inserts every note', firstImport.notes.length === secondSave.notes.length);
check('a fresh import reports what changed', firstImport.result.notes === secondSave.notes.length);

const secondImport = mod.mergeImport(firstImport.notes, backupData);
check('importing the same file twice does not duplicate notes', secondImport.notes.length === secondSave.notes.length);
check('importing the same file twice reports nothing new', secondImport.result.notes === 0);

const editedBackup = mod.buildBackup([{ ...secondSave.notes[0], text: 'Overwritten by import.' }]);
const overwritten = mod.mergeImport(firstImport.notes, editedBackup);
check(
  'a re-import with a known id overwrites the stored record',
  overwritten.notes.find(n => n.id === secondSave.notes[0].id).text === 'Overwritten by import.'
);

/* ── Export formats ─────────────────────────────────────────────────── */

console.log('exports');

check('timeLabel formats under an hour as mm:ss', mod.timeLabel(754) === '12:34');
check('timeLabel formats an hour or more as h:mm:ss', mod.timeLabel(3723) === '1:02:03');
check('timeLabel floors sub-second input', mod.timeLabel(59.9) === '0:59');

const noteA = { id: 'n1', videoId: 'abc123', videoTitle: 'A Long Lecture', seconds: 754, text: 'The key claim, "as stated".', isLive: false, createdAt: 1 };
const noteB = { id: 'n2', videoId: 'abc123', videoTitle: 'A Long Lecture', seconds: 30, text: 'Intro point', isLive: false, createdAt: 2 };
const noteLive = { id: 'n3', videoId: 'abc123', videoTitle: 'A Long Lecture', seconds: 120, text: 'Said live', isLive: true, createdAt: 3 };
const allThree = [noteA, noteB, noteLive];

const md = mod.toMarkdown('A Long Lecture', 'abc123', allThree, new Date('2026-09-02T00:00:00.000Z'));
check('markdown includes the video title as a heading', md.includes('# A Long Lecture'));
check('markdown includes the video url', md.includes('https://www.youtube.com/watch?v=abc123'));
check('markdown entries include a clickable jump link', md.includes('[12:34](https://www.youtube.com/watch?v=abc123&t=754s)'));
check('markdown includes the note text', md.includes('The key claim, "as stated".'));
check('a live note is labelled and not linked', md.includes('**2:00 (live)**') && !md.includes('t=120s'));

const emptyMd = mod.toMarkdown('A Long Lecture', 'abc123', [], new Date('2026-09-02T00:00:00.000Z'));
check('an empty note list exports without throwing', emptyMd.includes('No notes taken on this video yet'));

const csv = mod.toCsv('A Long Lecture', 'abc123', allThree);
const csvLines = csv.trim().split('\r\n');
check('csv has a header row plus one row per note', csvLines.length === allThree.length + 1);
check('csv header matches the documented columns', csvLines[0] === 'timestamp,timestamp_seconds,note,is_live,video_title,video_id,jump_url,created_at');
check('csv quotes a field containing a comma and double-quotes it', csv.includes('"The key claim, ""as stated""."'));
check('csv leaves the jump url blank for a live note', csvLines.some(line => line.includes(',true,') && line.includes(',,')));

/* ── Filenames ───────────────────────────────────────────────────────── */

console.log('filenames');
const fixedDate = new Date('2026-09-02T12:00:00.000Z');
check(
  'md filename follows the dated convention',
  mod.buildFilename('A Long Lecture', 'md', fixedDate) === 'A Long Lecture - notes - 2026-09-02.md'
);
check(
  'csv filename uses the same convention',
  mod.buildFilename('A Long Lecture', 'csv', fixedDate) === 'A Long Lecture - notes - 2026-09-02.csv'
);
const sanitized = mod.buildFilename('Q&A: "live" / special <chars>', 'md', fixedDate);
check('filename strips path-hostile characters from the title', !/["/\\:*?<>|]/.test(sanitized.replace(/\.md$/, '')));
check('filename collapses the stripped characters to single spaces', !sanitized.includes('  '));
check('filename falls back to "video" for a blank title', mod.buildFilename('', 'md', fixedDate).startsWith('video - notes -'));
check('filename stays under a sane length for a very long title', mod.buildFilename('x'.repeat(300), 'md', fixedDate).length <= 120);

fs.rmSync(entry, { force: true });
fs.rmSync(bundlePath, { force: true });

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
