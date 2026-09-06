/**
 * Headless checks for the pure logic: comment parsing/degradation, sorting,
 * keyword search, word-frequency (with stopword filtering), export
 * formatting and filenames. The DOM-bound half (selectors.ts, scan.ts,
 * content.ts) needs a live YouTube page and is covered by the manual
 * checklist in the README instead (PRD §5's required pre-ship spike).
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

const entry = path.join(os.tmpdir(), `ycd-selftest-${process.pid}.mjs`);
fs.writeFileSync(
  entry,
  ['parse.ts', 'comment.ts', 'sort.ts', 'search.ts', 'wordfreq.ts', 'export.ts', 'url.ts']
    .map(file => `export * from ${JSON.stringify(path.join(rootDir, 'src', file).replace(/\\/g, '/'))};`)
    .join('\n')
);

const bundlePath = path.join(os.tmpdir(), `ycd-selftest-bundle-${process.pid}.mjs`);
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

/* ── No network calls anywhere in the source ─────────────────────────── */

console.log('no-network');
const srcDir = path.join(rootDir, 'src');
const forbidden = [/fetch\(/, /XMLHttpRequest\(/, /\.sendBeacon\(/, /new WebSocket\(/];
let networkHit = null;
for (const file of fs.readdirSync(srcDir)) {
  if (!file.endsWith('.ts')) continue;
  const text = fs.readFileSync(path.join(srcDir, file), 'utf8');
  for (const pattern of forbidden) {
    if (pattern.test(text)) networkHit = `${file}: ${pattern}`;
  }
}
check('no fetch/XHR/sendBeacon/WebSocket call anywhere in src/', networkHit === null, networkHit);

/* ── parse.ts ────────────────────────────────────────────────────────── */

console.log('parse');
check('parses a compact like count', mod.parseCompactNumber('1.2K') === 1200);
check('parses a comma-grouped count', mod.parseCompactNumber('1,234') === 1234);
check('parses a bare small count', mod.parseCompactNumber('7') === 7);
check('empty like text is null, not zero', mod.parseCompactNumber('') === null);
check('null input is null', mod.parseCompactNumber(null) === null);
check('garbage input is null, never throws', mod.parseCompactNumber('¯\\_(ツ)_/¯') === null);

check('parses a plural reply count', mod.parseReplyCount('12 replies') === 12);
check('parses a singular reply count', mod.parseReplyCount('1 reply') === 1);
check('parses reply count inside extra text', mod.parseReplyCount('View 3 replies') === 3);
check('no reply text is null', mod.parseReplyCount(null) === null);
check('unrelated text is null, not a false match', mod.parseReplyCount('this is a great video') === null);

const now = Date.parse('2026-09-02T00:00:00Z');
check('parses "3 days ago"', mod.parseRelativeDate('3 days ago', now) === now - 3 * 86400000);
check(
  'strips the "(edited)" suffix without failing',
  mod.parseRelativeDate('3 days ago (edited)', now) === now - 3 * 86400000
);
check('unparseable date text is null', mod.parseRelativeDate('a while back', now) === null);

check('collapses repeated whitespace', mod.normalizeWhitespace('too   many    spaces') === 'too many spaces');
check('trims the ends', mod.normalizeWhitespace('  hi  ') === 'hi');

check('extracts a video id from a watch url', mod.parseVideoId('/watch?v=abc123XYZ_-') === 'abc123XYZ_-');
check('extracts a video id from a shorts url', mod.parseVideoId('/shorts/abc123XYZ_-') === 'abc123XYZ_-');
check('bad href yields null', mod.parseVideoId('not a url') === null);

/* ── url.ts ──────────────────────────────────────────────────────────── */

console.log('url');
check('a watch page is supported', mod.isWatchPage('https://www.youtube.com/watch?v=abc123'));
check('the homepage is not a watch page', !mod.isWatchPage('https://www.youtube.com/'));
check('a non-youtube host is never supported', !mod.isWatchPage('https://example.com/watch?v=abc123'));
check('a lookalike host is rejected', !mod.isWatchPage('https://notyoutube.com.evil.example/watch'));
check('m.youtube.com watch pages are supported', mod.isWatchPage('https://m.youtube.com/watch?v=abc123'));
check('undefined is not supported, never throws', !mod.isWatchPage(undefined));

/* ── comment.ts: build + graceful degradation ───────────────────────── */

console.log('comment');

const goodFields = {
  author: 'Ada L.',
  authorUrl: '/@adal',
  text: 'This actually worked for me — took about 20 minutes.',
  likeCountText: '1.2K',
  replyCountText: '4 replies',
  publishedText: '2 days ago',
  pinned: true,
  hearted: false,
};

const goodComment = mod.buildComment(goodFields, 0, now);
check('author carries through', goodComment.author === 'Ada L.');
check('like count parses', goodComment.likeCount === 1200);
check('reply count parses', goodComment.replyCount === 4);
check('published date parses to an epoch', goodComment.publishedAt === now - 2 * 86400000);
check('pinned flag carries through', goodComment.pinned === true);
check('hearted flag carries through', goodComment.hearted === false);
check('id is a non-empty string', typeof goodComment.id === 'string' && goodComment.id.length > 0);

// PRD §5's central promise: one bad field never drops the comment.
const messyFields = { ...goodFields, likeCountText: 'n/a', replyCountText: 'garbage', publishedText: 'ages ago' };
const messyComment = mod.buildComment(messyFields, 1, now);
check('a comment with an unparseable like count still builds', messyComment !== null);
check('unparseable like count degrades to null, not 0', messyComment.likeCount === null);
check('unparseable reply count degrades to null', messyComment.replyCount === null);
check('unparseable date degrades to null', messyComment.publishedAt === null);
check('text still comes through untouched', messyComment.text === goodFields.text);

const blankFields = { author: null, authorUrl: null, text: null, likeCountText: null, replyCountText: null, publishedText: null, pinned: false, hearted: false };
const blankComment = mod.buildComment(blankFields, 2, now);
check('a fully empty field set still builds without throwing', blankComment.text === '');
check('null author becomes null, not "null" the string', blankComment.author === null);

check(
  'two different comments at different positions get different ids',
  mod.buildComment(goodFields, 0, now).id !== mod.buildComment(goodFields, 1, now).id
);
check(
  'the same fields at the same position are stable across calls',
  mod.buildComment(goodFields, 0, now).id === mod.buildComment(goodFields, 0, now).id
);

/* ── sort.ts ─────────────────────────────────────────────────────────── */

console.log('sort');

const c = (over) => mod.buildComment({ ...goodFields, ...over }, over.domOrder ?? 0, now);
const comments = [
  { ...goodFields, domOrder: 0 },
  { ...goodFields, domOrder: 1 },
  { ...goodFields, domOrder: 2 },
].map((f, i) =>
  mod.buildComment(
    { ...f, likeCountText: ['5', '500', '50'][i], replyCountText: ['0 replies', '9 replies', '2 replies'][i], publishedText: ['1 day ago', '10 days ago', '5 days ago'][i] },
    i,
    now
  )
);

check(
  'top sort preserves dom order',
  mod.sortComments(comments, 'top').map(x => x.domOrder).join(',') === '0,1,2'
);
check(
  'likes sort is descending by like count',
  mod.sortComments(comments, 'likes').map(x => x.likeCount).join(',') === '500,50,5'
);
check(
  'replies sort is descending by reply count',
  mod.sortComments(comments, 'replies').map(x => x.replyCount).join(',') === '9,2,0'
);
check(
  'newest sort puts the most recent first',
  mod.sortComments(comments, 'newest').map(x => x.publishedText).join(',') === '1 day ago,5 days ago,10 days ago'
);

const withUnparseable = [
  ...comments,
  mod.buildComment({ ...goodFields, likeCountText: 'n/a' }, 3, now),
];
const likesSorted = mod.sortComments(withUnparseable, 'likes');
check('a comment with no parseable like count sorts to the end, not the top', likesSorted[likesSorted.length - 1].likeCount === null);

/* ── search.ts ───────────────────────────────────────────────────────── */

console.log('search');
const searchable = [
  mod.buildComment({ ...goodFields, author: 'Battery Nerd', text: 'The battery life is fantastic after the update.' }, 0, now),
  mod.buildComment({ ...goodFields, author: 'Skeptic99', text: 'Did not work for me at all, sadly.' }, 1, now),
];
check('empty query returns everything', mod.filterComments(searchable, '').length === 2);
check('search matches comment body, case-insensitively', mod.filterComments(searchable, 'BATTERY').length === 1);
check('search matches the author name too', mod.filterComments(searchable, 'skeptic').length === 1);
check('a query matching nothing returns an empty list, not null', mod.filterComments(searchable, 'zzzznomatch').length === 0);

/* ── wordfreq.ts ─────────────────────────────────────────────────────── */

console.log('wordfreq');

const wfComments = [
  'The battery life on this thing is amazing honestly.',
  'I agree, the battery life is the best part by far.',
  'Battery life could be better but overall a solid product.',
  "This is the video that finally fixed my battery life issue.",
].map((text, i) => mod.buildComment({ ...goodFields, text }, i, now));

const freq = mod.computeWordFrequency(wfComments);
check('battery is a top word', freq.words.some(w => w.term === 'battery'));
check('"battery life" is a top phrase', freq.phrases.some(p => p.term === 'battery life'));
check('phrase commentCount never exceeds the number of comments scanned', freq.phrases.every(p => p.commentCount <= wfComments.length));
check(
  'a common English stopword never appears in the word list',
  !freq.words.some(w => ['the', 'is', 'this', 'that', 'and'].includes(w.term))
);

const spammy = [
  mod.buildComment({ ...goodFields, text: 'refund refund refund refund refund refund refund refund refund refund' }, 0, now),
  mod.buildComment({ ...goodFields, text: 'Nice tutorial, thanks for sharing this.' }, 1, now),
];
const spamFreq = mod.computeWordFrequency(spammy);
const refundEntry = spamFreq.words.find(w => w.term === 'refund');
check(
  'one spammy comment repeating a word cannot dominate the count unbounded',
  refundEntry && refundEntry.count < 10,
  refundEntry && refundEntry.count
);
check('the spammy word is only attributed to the one comment it appeared in', refundEntry && refundEntry.commentCount === 1);

const empty = mod.computeWordFrequency([]);
check('an empty comment set returns empty lists, not an error', empty.words.length === 0 && empty.phrases.length === 0);

const contraction = mod.computeWordFrequency([
  mod.buildComment({ ...goodFields, text: "I don't think it's worth it, honestly I don't recommend it." }, 0, now),
]);
check('contractions do not leak past stopword filtering as odd tokens', !contraction.words.some(w => w.term === 'dont' || w.term === 'don' || w.term === 't'));

/* ── export.ts ───────────────────────────────────────────────────────── */

console.log('export');

const meta = { videoId: 'abc123XYZ_-', title: 'A Great Tutorial: Part 1', channel: 'Some Channel' };
const exportComments = [
  mod.buildComment({ ...goodFields, author: 'Ada', text: 'Worked great, thanks!' }, 0, now),
  mod.buildComment({ ...goodFields, author: 'Bo, with a comma', text: 'Line one\nLine two', likeCountText: null, pinned: false, hearted: true }, 1, now),
];

const md = mod.toMarkdown({ meta, comments: exportComments });
check('markdown opens with a heading including the video title', md.startsWith('# Comments — A Great Tutorial'));
check('markdown includes the source url built from the video id', md.includes('https://www.youtube.com/watch?v=abc123XYZ_-'));
check('markdown lists each author', md.includes('**Ada**') && md.includes('**Bo, with a comma**'));
check('a pinned comment is badged as pinned', /Ada[^\n]*pinned/.test(md));
check('a hearted comment is badged distinctly as a creator heart, not merged with "pinned"', /Bo[^\n]*creator heart/.test(md) && !/Bo[^\n]*pinned/.test(md));
check('an unparseable like count reads as n/a, not 0', md.includes('likes n/a'));

const emptyMd = mod.toMarkdown({ meta, comments: [] });
check('an empty export explains itself rather than rendering a blank list', emptyMd.includes('No comments to export'));

const csv = mod.toCsv({ meta, comments: exportComments });
const csvLines = csv.trim().split('\r\n');
check('csv has a header row plus one row per comment', csvLines.length === 1 + exportComments.length);
check('csv header matches the documented columns', csvLines[0] === 'author,text,likeCount,replyCount,published,pinned,heartedByCreator');
check('a comma in a field is quoted per RFC 4180', csv.includes('"Bo, with a comma"'));
check('an embedded newline in comment text is quoted, not a stray row', csv.includes('"Line one\nLine two"'));
check('a null like count exports as an empty cell, not the string "null"', !csv.includes('null'));

const filename = mod.buildFilename(meta, 'md');
check('filename follows the "{channel} - {title} comments.{ext}" convention', filename === 'Some Channel - A Great Tutorial Part 1 comments.md', filename);
check('filename drops filesystem-hostile characters', !/[\\/:*?"<>|]/.test(filename));

const longMeta = { ...meta, title: 'x'.repeat(400) };
const longName = mod.buildFilename(longMeta, 'csv');
check('long titles are truncated to a safe filename length', longName.length <= 120, `${longName.length} chars`);
check('truncation keeps the extension', longName.endsWith('.csv'));

const noMeta = mod.buildFilename({ videoId: null, title: null, channel: null }, 'md');
check('a filename can always be built, even with no metadata at all', noMeta === 'youtube-comments comments.md', noMeta);

fs.rmSync(entry, { force: true });
fs.rmSync(bundlePath, { force: true });

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
