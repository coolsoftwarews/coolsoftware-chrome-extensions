/**
 * Headless checks for the pure logic: count/id parsing, capture-card
 * assembly (classification, "update don't duplicate", search, people
 * grouping), the import merge-by-id semantics, and the CSV/Markdown export
 * formatters. The DOM-bound half (scrape.ts, content.ts) needs a real browser
 * and X's live markup, and is covered by the manual checklist in README.md —
 * the same split WebHighlighter and Instagram Research Saver use.
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

const entry = path.join(os.tmpdir(), `xcs-selftest-${process.pid}.mjs`);
fs.writeFileSync(
  entry,
  ['parse.ts', 'capture.ts', 'merge.ts', 'formatters.ts']
    .map(file => `export * from ${JSON.stringify(path.join(rootDir, 'src', file).replace(/\\/g, '/'))};`)
    .join('\n')
);

const bundlePath = path.join(os.tmpdir(), `xcs-selftest-bundle-${process.pid}.mjs`);
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
    quoted: null,
    mediaCount: 0,
    thumbnail: '',
    ...overrides,
  };
}

check('a single post classifies as "post"', mod.classifyKind([post()]) === 'post');
check(
  'same-author posts classify as "thread"',
  mod.classifyKind([post({ id: '1' }), post({ id: '2' })]) === 'thread'
);
check(
  'mixed-author posts classify as "conversation" (PRD §8)',
  mod.classifyKind([post({ id: '1', handle: 'jane' }), post({ id: '2', handle: 'bob' })]) === 'conversation'
);

const singlePost = post();
const builtSingle = mod.buildItem([singlePost], null, 'reference');
check('buildItem assigns the root post id', builtSingle.id === '1');
check('buildItem defaults to the given collection', builtSingle.collectionId === 'reference');
check('buildItem starts with an empty note', builtSingle.note === '');
check('buildItem records unique authors', JSON.stringify(builtSingle.authors) === JSON.stringify(['jane']));
check('buildItem passes truncated through', mod.buildItem([singlePost], null, 'reference', true).truncated === true);
check('buildItem returns null with nothing capturable', mod.buildItem([{ id: '' }], null, 'reference') === null);

// "Saving the same post twice updates, doesn't duplicate" (PRD §8).
const existingCard = { ...builtSingle, note: 'Reply to this', collectionId: 'prospects', savedAt: 111 };
const resaved = mod.buildItem([post({ text: 'Updated text' })], existingCard, 'reference');
check('re-saving keeps the existing note', resaved.note === 'Reply to this');
check('re-saving keeps the existing collection', resaved.collectionId === 'prospects');
check('re-saving keeps the original saved date', resaved.savedAt === 111);
check('re-saving refreshes the captured text', resaved.posts[0].text === 'Updated text');

check('matchesSearch finds text in the post body', mod.matchesSearch(builtSingle, 'hello'));
check('matchesSearch finds the handle', mod.matchesSearch(builtSingle, 'jane'));
check(
  'matchesSearch finds a note',
  mod.matchesSearch({ ...builtSingle, note: 'follow up next week' }, 'follow up')
);
check('matchesSearch rejects unrelated queries', !mod.matchesSearch(builtSingle, 'nonexistent'));
check('an empty query matches everything', mod.matchesSearch(builtSingle, ''));

const personItems = [
  mod.buildItem([post({ id: '1', handle: 'jane', author: 'Jane' })], null, 'reference'),
  mod.buildItem([post({ id: '2', handle: 'jane', author: 'Jane' })], null, 'reference'),
  mod.buildItem([post({ id: '3', handle: 'bob', author: 'Bob' })], null, 'reference'),
];
const groups = mod.groupByPerson(personItems);
check('groupByPerson groups by root author', groups.length === 2);
check(
  'groupByPerson sorts by save count, most first',
  groups[0].handle === 'jane' && groups[0].items.length === 2
);

/* ── Import merge ────────────────────────────────────────────────────── */

console.log('merge');

const local = {
  items: [{ ...builtSingle, note: 'local note', collectionId: 'ideas' }],
  collections: [{ id: 'ideas', name: 'Ideas', createdAt: 1 }],
  people: [{ handle: 'jane', note: 'a local person note', updatedAt: 1 }],
};

const incomingBackup = {
  format: 'x-conversation-saver',
  version: 1,
  exportedAt: new Date().toISOString(),
  items: [
    { ...builtSingle, note: 'note from the file', collectionId: 'reference' }, // same id as local item
    mod.buildItem([post({ id: '2', handle: 'bob', author: 'Bob' })], null, 'reference'), // new id
  ],
  collections: [
    { id: 'ideas', name: 'Renamed in the file', createdAt: 1 },
    { id: 'reference', name: 'Reference', createdAt: 2 },
  ],
  people: [
    { handle: 'jane', note: 'note from the file', updatedAt: 2 },
    { handle: 'bob', note: '', updatedAt: 3 }, // blank notes must not clobber anything
  ],
};

const merged = mod.mergeBackup(local, incomingBackup);
check('merge keeps items already on the device plus new ones', merged.items.length === 2);
check('merge counts exactly one new item', merged.stats.newItems === 1);
check(
  'on a conflicting id, the imported file wins (restore semantics)',
  merged.items.find(i => i.id === '1').note === 'note from the file'
);
check('merge adds the new collection', merged.collections.some(c => c.id === 'reference'));
check('merge counts exactly one new collection', merged.stats.newCollections === 1);
check(
  'an existing collection is overwritten by the file on conflict',
  merged.collections.find(c => c.id === 'ideas').name === 'Renamed in the file'
);
check(
  'an incoming note updates an existing person note',
  merged.people.find(p => p.handle === 'jane').note === 'note from the file'
);
check('a blank incoming note is never added', !merged.people.some(p => p.handle === 'bob'));

// Importing the same file twice must be idempotent — nothing "new" the second time.
const secondPass = mod.mergeBackup(
  { items: merged.items, collections: merged.collections, people: merged.people },
  incomingBackup
);
check('re-importing the same backup adds no new items', secondPass.stats.newItems === 0);
check('re-importing the same backup adds no new collections', secondPass.stats.newCollections === 0);

const nonsenseImport = mod.mergeBackup(local, { items: [{ id: '', posts: [] }], collections: [{}], people: [{}] });
check('malformed entries are skipped, not thrown', nonsenseImport.items.length === local.items.length);

/* ── Export formats ──────────────────────────────────────────────────── */

console.log('exports');

const collections = [
  { id: 'hooks', name: 'Hooks', createdAt: 1 },
  { id: 'reference', name: 'Reference', createdAt: 2 },
];

const threadItem = mod.buildItem(
  [
    post({ id: '10', handle: 'jane', author: 'Jane', text: 'First post, with a "quote" and, a comma' }),
    post({ id: '11', handle: 'jane', author: 'Jane', text: 'Second post' }),
  ],
  null,
  'hooks'
);
threadItem.note = 'Great opener';

const conversationItem = mod.buildItem(
  [
    post({ id: '20', handle: 'jane', author: 'Jane', text: 'Ask' }),
    post({ id: '21', handle: 'bob', author: 'Bob', text: 'Reply' }),
  ],
  null,
  'reference'
);

const items = [threadItem, conversationItem];

const csv = mod.toCsv(items, collections);
const csvRows = csv.trim().split('\r\n');
check('csv has a header row plus one row per post', csvRows.length === 1 + threadItem.posts.length + conversationItem.posts.length);
check('csv header matches the documented columns', csvRows[0].startsWith('Collection,Kind,Item ID'));
check('csv quotes a field containing a comma and a quote', csv.includes('"First post, with a ""quote"" and, a comma"'));
check('every row for a thread shares one item id', csvRows.slice(1, 3).every(r => r.split(',')[2] === '10'));
check('the note only appears on the first row of an item', csvRows[1].endsWith('Great opener') && !csvRows[2].endsWith('Great opener'));

const md = mod.toMarkdown(items, collections);
check('markdown groups by collection name', md.includes('# Hooks') && md.includes('# Reference'));
check('a thread is labelled Thread with its post count', md.includes('## Thread — Jane (@jane)'));
check('a mixed-author save is labelled Conversation', md.includes('## Conversation — Jane (@jane)'));
check('each post in a thread is attributed', md.includes('**Jane (@jane)**'));
check('post text is rendered as a blockquote', md.includes('> First post'));
check('the note is included', md.includes('**Note:** Great opener'));
check('a link back to the original uses the root post url', md.includes(`[Open on X](${threadItem.posts[0].url})`));

const emptyMd = mod.toMarkdown([], collections);
check('an empty library exports without throwing', emptyMd.includes('No saved items yet'));

const strayCollectionItem = mod.buildItem([post({ id: '99' })], null, 'does-not-exist');
const mdWithStray = mod.toMarkdown([strayCollectionItem], collections);
check('items in a deleted/unknown collection fall back to Uncategorized', mdWithStray.includes('# Uncategorized'));

/* ── Filenames ───────────────────────────────────────────────────────── */

console.log('filenames');
check('csv filename follows the dated convention', /^x-conversation-saver-\d{4}-\d{2}-\d{2}\.csv$/.test(mod.buildExportFilename('csv')));
check('json filename uses the .json extension', mod.buildExportFilename('json').endsWith('.json'));

fs.rmSync(entry, { force: true });
fs.rmSync(bundlePath, { force: true });

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
