/**
 * Headless checks for the pure logic: string parsing, the reading-time/
 * completeness-honesty helpers, and the Markdown/text export formatters.
 * The DOM-bound half (scrape.ts, content.ts) needs a real browser and X's
 * live markup, and is covered by the manual checklist in README.md — the
 * same split every DOM-reading extension in this portfolio uses.
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

const entry = path.join(os.tmpdir(), `xtu-selftest-${process.pid}.mjs`);
fs.writeFileSync(
  entry,
  ['parse.ts', 'reading.ts', 'formatters.ts']
    .map(file => `export * from ${JSON.stringify(path.join(rootDir, 'src', file).replace(/\\/g, '/'))};`)
    .join('\n')
);

const bundlePath = path.join(os.tmpdir(), `xtu-selftest-bundle-${process.pid}.mjs`);
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

/* ── Parsing ─────────────────────────────────────────────────────────── */

console.log('parse');
check('extracts a status id', mod.parseStatusId('https://x.com/jack/status/1234567890') === '1234567890');
check('returns null with no status id', mod.parseStatusId('https://x.com/jack') === null);
check('normalizes a handle', mod.normalizeHandle('@Jack') === 'jack');
check('builds a canonical status url', mod.canonicalStatusUrl('Jack', '99') === 'https://x.com/jack/status/99');
check('cleanText collapses runaway blank lines', mod.cleanText('a\n\n\n\nb') === 'a\n\nb');
check('cleanText trims trailing line whitespace', mod.cleanText('a   \nb') === 'a\nb');
check('isXUrl accepts x.com', mod.isXUrl('https://x.com/jack/status/1'));
check('isXUrl accepts twitter.com subdomains', mod.isXUrl('https://mobile.twitter.com/jack'));
check('isXUrl rejects other sites', !mod.isXUrl('https://example.com'));
check('isXUrl rejects http', !mod.isXUrl('http://x.com'));
check('mediaLabel: no media', mod.mediaLabel(0, false) === '');
check('mediaLabel: one image', mod.mediaLabel(1, false) === '1 image');
check('mediaLabel: one video', mod.mediaLabel(1, true) === '1 video');
check('mediaLabel: several images', mod.mediaLabel(3, false) === '3 images');
check('mediaLabel: mixed media', mod.mediaLabel(2, true) === '2 media items');

/* ── Reading time / completeness honesty ────────────────────────────── */

console.log('reading');

function post(overrides = {}) {
  return {
    id: '1',
    author: 'Jane',
    handle: 'jane',
    avatarUrl: '',
    text: 'Hello world',
    postDate: '2026-01-01T00:00:00.000Z',
    url: 'https://x.com/jane/status/1',
    media: { count: 0, label: '', thumbnailUrl: '' },
    quoted: null,
    deleted: false,
    ...overrides,
  };
}

const deletedPost = { ...post(), id: '', author: '', handle: '', text: '', url: '', deleted: true };

check('wordCount counts whitespace-separated words', mod.wordCount('one two three') === 3);
check('wordCount of empty string is 0', mod.wordCount('   ') === 0);
check(
  'totalWordCount sums across posts, skipping nothing',
  mod.totalWordCount([post({ text: 'one two' }), post({ text: 'three' })]) === 3
);
check('estimateReadingMinutes is 0 for an empty thread', mod.estimateReadingMinutes([]) === 0);
check(
  'estimateReadingMinutes is at least 1 for any non-empty thread',
  mod.estimateReadingMinutes([post({ text: 'one' })]) === 1
);
check(
  'estimateReadingMinutes scales with word count at the given rate',
  mod.estimateReadingMinutes([post({ text: Array(400).fill('word').join(' ') })], 200) === 2
);
check('readingTimeLabel renders a tilde-minute string', mod.readingTimeLabel([post({ text: 'one' })]) === '~1 min read');
check('readingTimeLabel is empty for nothing readable', mod.readingTimeLabel([]) === '');

check(
  'readablePosts excludes deleted placeholders',
  mod.readablePosts([post({ id: '1' }), deletedPost, post({ id: '2' })]).length === 2
);
check(
  'postsShownLabel counts only readable posts',
  mod.postsShownLabel([post({ id: '1' }), deletedPost]) === '1 post shown'
);
check(
  'postsShownLabel pluralizes',
  mod.postsShownLabel([post({ id: '1' }), post({ id: '2' })]) === '2 posts shown'
);

check(
  'completenessNote is null when nothing was cut off',
  mod.completenessNote({ truncated: false, cappedAt200: false }) === null
);
check(
  'completenessNote flags a truncated thread without inventing a total',
  mod.completenessNote({ truncated: true, cappedAt200: false }) === 'More may exist — X did not fully load this thread.'
);
check(
  'completenessNote flags the 200-post safety cap distinctly from truncation',
  mod.completenessNote({ truncated: true, cappedAt200: true }) === 'Stopped at 200 posts — this thread may have more.'
);

/* ── Export formats ──────────────────────────────────────────────────── */

console.log('exports');

function session(overrides = {}) {
  return {
    key: '1',
    rootAuthor: 'Jane',
    rootHandle: 'jane',
    posts: [
      post({ id: '1', text: 'First post in the thread' }),
      post({ id: '2', text: 'Second post', media: { count: 1, label: '1 image', thumbnailUrl: 'https://example.com/x.jpg' } }),
    ],
    status: 'done',
    truncated: false,
    cappedAt200: false,
    startedAt: Date.now(),
    ...overrides,
  };
}

const md = mod.toMarkdown(session());
check('markdown titles the thread by its author', md.startsWith("# Jane's thread"));
check('markdown includes the post count', md.includes('2 posts shown'));
check('markdown includes each post body', md.includes('First post in the thread') && md.includes('Second post'));
check('markdown includes a media reference, not a file', md.includes('[1 image]'));
check('markdown links back to each post', md.includes('[Open on X](https://x.com/jane/status/1)'));

const mdWithGap = mod.toMarkdown(session({ posts: [post({ id: '1' }), deletedPost, post({ id: '2' })] }));
check(
  'markdown preserves a deleted-post gap rather than closing the numbering up',
  mdWithGap.includes('a post in this thread is no longer available')
);

const mdTruncated = mod.toMarkdown(session({ truncated: true }));
check(
  'markdown carries the honest completeness note, never an invented total',
  mdTruncated.includes('More may exist — X did not fully load this thread.')
);
check('markdown never fabricates an "of N" fraction', !/of \d+ posts/i.test(mdTruncated));

const txt = mod.toPlainText(session());
check('plain text includes each post body', txt.includes('First post in the thread') && txt.includes('Second post'));
check('plain text includes a media reference', txt.includes('[1 image]'));
check('plain text includes the post url', txt.includes('https://x.com/jane/status/1'));

const emptySession = mod.toMarkdown(session({ posts: [] }));
check('an empty thread exports without throwing', emptySession.includes("Jane's thread"));

/* ── Filenames ───────────────────────────────────────────────────────── */

console.log('filenames');
check(
  'filename follows the handle-and-date convention',
  /^x-thread-jane-\d{4}-\d{2}-\d{2}\.md$/.test(mod.buildFilename({ rootHandle: 'jane' }, 'md'))
);
check('filename falls back when the handle is empty', mod.buildFilename({ rootHandle: '' }, 'txt').startsWith('x-thread-thread-'));
check('filename sanitizes unsafe characters', !mod.buildFilename({ rootHandle: 'ja/ck:*?' }, 'md').match(/[\\/:*?"<>|]/));

fs.rmSync(entry, { force: true });
fs.rmSync(bundlePath, { force: true });

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
