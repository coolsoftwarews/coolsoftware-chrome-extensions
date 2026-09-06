/**
 * Headless checks for the pure logic: count/id/tag parsing, capture-card
 * assembly (index/touch, staleness derivation, search, tag listing), the
 * import merge-by-id semantics, and the CSV/Markdown export formatters. The
 * DOM-bound half (scrape.ts, content.ts) needs a real browser and X's live
 * markup, and is covered by the manual checklist in README.md — the same
 * split every DOM-reading extension in this portfolio uses.
 *
 * Also enforces this PRD's "no network requests of any kind" posture
 * (PRD §6) by grepping src/*.ts for network call sites and failing the build
 * if any exist.
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

const entry = path.join(os.tmpdir(), `xbo-selftest-${process.pid}.mjs`);
fs.writeFileSync(
  entry,
  ['parse.ts', 'capture.ts', 'merge.ts', 'formatters.ts']
    .map(file => `export * from ${JSON.stringify(path.join(rootDir, 'src', file).replace(/\\/g, '/'))};`)
    .join('\n')
);

const bundlePath = path.join(os.tmpdir(), `xbo-selftest-bundle-${process.pid}.mjs`);
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

/* ── Parsing ─────────────────────────────────────────────────────────── */

console.log('parse');
check('parses plain counts', mod.parseCount('1,204') === 1204);
check('parses K suffix', mod.parseCount('1.2K') === 1200);
check('parses M suffix', mod.parseCount('3.4M') === 3400000);
check('parses an aria-label sentence', mod.parseCount('128 replies') === 128, mod.parseCount('128 replies'));
check('returns null for nothing usable', mod.parseCount('') === null);
check('returns null for undefined', mod.parseCount(undefined) === null);
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
check('isBookmarksUrl accepts the bookmarks page', mod.isBookmarksUrl('https://x.com/i/bookmarks'));
check('isBookmarksUrl accepts a bookmarks folder sub-path', mod.isBookmarksUrl('https://x.com/i/bookmarks/12345'));
check('isBookmarksUrl accepts the folded /i/history page', mod.isBookmarksUrl('https://x.com/i/history'));
check('isBookmarksUrl rejects the home timeline', !mod.isBookmarksUrl('https://x.com/home'));
check('isBookmarksUrl rejects a non-X site', !mod.isBookmarksUrl('https://example.com/i/bookmarks'));

check('parseTags splits and trims', JSON.stringify(mod.parseTags('hooks, ideas ,  reference')) === JSON.stringify(['hooks', 'ideas', 'reference']));
check('parseTags dedupes case-insensitively, keeping first casing', JSON.stringify(mod.parseTags('Hooks, hooks, HOOKS')) === JSON.stringify(['Hooks']));
check('parseTags drops empty entries', JSON.stringify(mod.parseTags('a,,  ,b')) === JSON.stringify(['a', 'b']));
check('parseTags of empty string is empty', mod.parseTags('').length === 0);
check('tagsToInput joins with a comma-space', mod.tagsToInput(['a', 'b']) === 'a, b');

/* ── Capture assembly ────────────────────────────────────────────────── */

console.log('capture');

function post(overrides = {}) {
  return {
    id: '1',
    author: 'Jane',
    handle: 'jane',
    text: 'Hello world',
    url: 'https://x.com/jane/status/1',
    postDate: '2026-01-01T00:00:00.000Z',
    metrics: { replies: 1, reposts: 2, likes: 3, views: 400 },
    mediaCount: 0,
    thumbnail: '',
    ...overrides,
  };
}

const built = mod.buildOrTouchItem(post(), null, 'read-later', 1000);
check('buildOrTouchItem assigns the post id', built.id === '1');
check('buildOrTouchItem defaults to the given folder', built.collectionId === 'read-later');
check('buildOrTouchItem starts with an empty note and no tags', built.note === '' && built.tags.length === 0);
check('buildOrTouchItem stamps lastSeenAt to the session time, not now', built.lastSeenAt === 1000);
check('buildOrTouchItem returns null with nothing capturable', mod.buildOrTouchItem({ id: '' }, null, 'read-later', 1000) === null);

// "Indexing the same bookmark twice updates, doesn't duplicate" (PRD §7).
const existingCard = { ...built, note: 'read this', tags: ['hooks'], collectionId: 'reference', indexedAt: 111 };
const retouched = mod.buildOrTouchItem(post({ text: 'Updated text' }), existingCard, 'read-later', 2000);
check('re-touching keeps the existing note', retouched.note === 'read this');
check('re-touching keeps the existing tags', JSON.stringify(retouched.tags) === JSON.stringify(['hooks']));
check('re-touching keeps the existing folder', retouched.collectionId === 'reference');
check('re-touching keeps the original indexed date', retouched.indexedAt === 111);
check('re-touching refreshes the captured text', retouched.post.text === 'Updated text');
check('re-touching updates lastSeenAt to the new session', retouched.lastSeenAt === 2000);

console.log('staleness');
check('null lastReindexAt never flags anything as possibly removed', mod.isPossiblyRemoved(built, null) === false);
check('an item seen in the latest session is not flagged', mod.isPossiblyRemoved({ ...built, lastSeenAt: 5000 }, 5000) === false);
check('an item last seen before the latest session is flagged', mod.isPossiblyRemoved({ ...built, lastSeenAt: 4000 }, 5000) === true);
check('an item seen exactly at the session boundary is not flagged (no false positive within one session)', mod.isPossiblyRemoved({ ...built, lastSeenAt: 5000 }, 5000) === false);

console.log('search');
check('matchesSearch finds text in the post body', mod.matchesSearch(built, 'hello'));
check('matchesSearch finds the handle', mod.matchesSearch(built, 'jane'));
check('matchesSearch finds a tag', mod.matchesSearch({ ...built, tags: ['fundraising'] }, 'fundrais'));
check('matchesSearch finds a note', mod.matchesSearch({ ...built, note: 'follow up next week' }, 'follow up'));
check('matchesSearch rejects unrelated queries', !mod.matchesSearch(built, 'nonexistent'));
check('an empty query matches everything', mod.matchesSearch(built, ''));

console.log('tags');
const taggedItems = [
  { ...built, id: '1', tags: ['Hooks', 'ideas'] },
  { ...built, id: '2', tags: ['hooks'] },
  { ...built, id: '3', tags: [] },
];
check('allTags is unique, alphabetical, keeps first-seen casing', JSON.stringify(mod.allTags(taggedItems)) === JSON.stringify(['Hooks', 'ideas']));
check('hasTag matches case-insensitively', mod.hasTag(taggedItems[0], 'HOOKS'));
check('hasTag rejects an absent tag', !mod.hasTag(taggedItems[2], 'hooks'));

/* ── Import merge ────────────────────────────────────────────────────── */

console.log('merge');

const local = {
  items: [{ ...built, note: 'local note', collectionId: 'ideas' }],
  collections: [{ id: 'ideas', name: 'Ideas', createdAt: 1 }],
};

const incomingBackup = {
  format: 'x-bookmark-organizer',
  version: 1,
  exportedAt: new Date().toISOString(),
  items: [
    { ...built, note: 'note from the file', collectionId: 'reference' }, // same id as local item
    mod.buildOrTouchItem(post({ id: '2', handle: 'bob', author: 'Bob' }), null, 'reference', 1000), // new id
  ],
  collections: [
    { id: 'ideas', name: 'Renamed in the file', createdAt: 1 },
    { id: 'reference', name: 'Reference', createdAt: 2 },
  ],
};

const merged = mod.mergeBackup(local, incomingBackup);
check('merge keeps items already on the device plus new ones', merged.items.length === 2);
check('merge counts exactly one new item', merged.stats.newItems === 1);
check('on a conflicting id, the imported file wins (restore semantics)', merged.items.find(i => i.id === '1').note === 'note from the file');
check('merge adds the new collection', merged.collections.some(c => c.id === 'reference'));
check('merge counts exactly one new collection', merged.stats.newCollections === 1);
check('an existing collection is overwritten by the file on conflict', merged.collections.find(c => c.id === 'ideas').name === 'Renamed in the file');

// Importing the same file twice must be idempotent — nothing "new" the second time.
const secondPass = mod.mergeBackup({ items: merged.items, collections: merged.collections }, incomingBackup);
check('re-importing the same backup adds no new items', secondPass.stats.newItems === 0);
check('re-importing the same backup adds no new collections', secondPass.stats.newCollections === 0);

const nonsenseImport = mod.mergeBackup(local, { items: [{ id: '', post: null }], collections: [{}] });
check('malformed entries are skipped, not thrown', nonsenseImport.items.length === local.items.length);

/* ── Export formats ──────────────────────────────────────────────────── */

console.log('exports');

const collections = [
  { id: 'hooks', name: 'Hooks', createdAt: 1 },
  { id: 'reference', name: 'Reference', createdAt: 2 },
];

const hookItem = mod.buildOrTouchItem(
  post({ id: '10', handle: 'jane', author: 'Jane', text: 'First post, with a "quote" and, a comma' }),
  null,
  'hooks',
  1000
);
hookItem.note = 'Great opener';
hookItem.tags = ['fundraising', 'hooks'];

const referenceItem = mod.buildOrTouchItem(post({ id: '20', handle: 'bob', author: 'Bob', text: 'Ask' }), null, 'reference', 1000);

const items = [hookItem, referenceItem];

const csv = mod.toCsv(items, collections);
const csvRows = csv.trim().split('\r\n');
check('csv has a header row plus one row per item', csvRows.length === 1 + items.length);
check('csv header matches the documented columns', csvRows[0].startsWith('Folder,Tags,Item ID'));
check('csv quotes a field containing a comma and a quote', csv.includes('"First post, with a ""quote"" and, a comma"'));
check('csv includes the tags column, semicolon-joined', csv.includes('fundraising; hooks'));

const md = mod.toMarkdown(items, collections);
check('markdown groups by folder name', md.includes('# Hooks') && md.includes('# Reference'));
check('each item is attributed to its author', md.includes('## Jane (@jane)'));
check('post text is rendered as a blockquote', md.includes('> First post'));
check('the note is included', md.includes('**Note:** Great opener'));
check('tags are included', md.includes('Tags: fundraising, hooks'));
check('a link back to the original uses the post url', md.includes(`[Open on X](${hookItem.post.url})`));

const emptyMd = mod.toMarkdown([], collections);
check('an empty library exports without throwing', emptyMd.includes('No bookmarks indexed yet'));

const strayCollectionItem = mod.buildOrTouchItem(post({ id: '99' }), null, 'does-not-exist', 1000);
const mdWithStray = mod.toMarkdown([strayCollectionItem], collections);
check('items in a deleted/unknown folder fall back to Uncategorized', mdWithStray.includes('# Uncategorized'));

/* ── Filenames ───────────────────────────────────────────────────────── */

console.log('filenames');
check('csv filename follows the dated convention', /^x-bookmark-organizer-\d{4}-\d{2}-\d{2}\.csv$/.test(mod.buildExportFilename('csv')));
check('json filename uses the .json extension', mod.buildExportFilename('json').endsWith('.json'));

fs.rmSync(entry, { force: true });
fs.rmSync(bundlePath, { force: true });

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
