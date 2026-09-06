/**
 * Headless checks for the pure logic: capture-card creation, collection
 * assignment, search matching, CSV/Markdown export formatting, and the
 * storage layer's dedupe-on-resave / import merge-by-id semantics.
 *
 * storage.ts talks to chrome.storage.local, which doesn't exist in Node — so
 * this file installs a tiny in-memory mock on globalThis.chrome before
 * exercising it. That's the only thing standing between storage.ts and a real
 * headless test, and it lets this suite cover more than WebHighlighter's
 * (which skips its storage.ts entirely).
 *
 * The DOM-bound half (content.ts, scrape.ts — injecting the button, reading
 * Instagram's page, resizing the thumbnail) needs a real browser and a real
 * Instagram DOM, and is covered by the manual checklist in README.md.
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

/* ── Minimal in-memory chrome.storage.local ─────────────────────────── */

function createChromeMock() {
  const store = new Map();
  return {
    storage: {
      local: {
        async get(keys) {
          if (keys === null || keys === undefined) return Object.fromEntries(store);
          const list = Array.isArray(keys) ? keys : typeof keys === 'string' ? [keys] : Object.keys(keys ?? {});
          const result = {};
          for (const key of list) if (store.has(key)) result[key] = store.get(key);
          return result;
        },
        async set(items) {
          for (const [key, value] of Object.entries(items)) store.set(key, value);
        },
        async remove(keys) {
          for (const key of Array.isArray(keys) ? keys : [keys]) store.delete(key);
        },
        async getBytesInUse(keys) {
          const values = keys == null ? [...store.values()] : (Array.isArray(keys) ? keys : [keys]).map(k => store.get(k)).filter(v => v !== undefined);
          return values.reduce((sum, v) => sum + JSON.stringify(v).length, 0);
        },
        async clear() {
          store.clear();
        },
      },
    },
  };
}

globalThis.chrome = createChromeMock();

const entry = path.join(os.tmpdir(), `irs-selftest-${process.pid}.mjs`);
fs.writeFileSync(
  entry,
  ['capture.ts', 'formatters.ts', 'storage.ts', 'types.ts']
    .map(file => `export * from ${JSON.stringify(path.join(rootDir, 'src', file).replace(/\\/g, '/'))};`)
    .join('\n')
);

const bundlePath = path.join(os.tmpdir(), `irs-selftest-bundle-${process.pid}.mjs`);
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

/* ── parseCount ──────────────────────────────────────────────────────── */

console.log('parseCount');
check('parses plain digits', mod.parseCount('1,204') === 1204);
check('parses K suffix', mod.parseCount('3.4K views') === 3400);
check('parses M suffix', mod.parseCount('1.2M') === 1_200_000);
check('parses B suffix', mod.parseCount('2.1B') === 2_100_000_000);
check('parses bare "likes" label', mod.parseCount('12,345 likes') === 12345);
check('missing count returns null, not 0', mod.parseCount(null) === null, mod.parseCount(null));
check('empty string returns null', mod.parseCount('') === null);
check('non-numeric text returns null', mod.parseCount('Liked by a friend') === null);

/* ── postIdFromUrl / normalizeInstagramUrl ──────────────────────────── */

console.log('urls');
check(
  'post id includes the type and shortcode',
  mod.postIdFromUrl('https://www.instagram.com/p/CxYz123/') === 'p:CxYz123'
);
check('reel id uses the reel type', mod.postIdFromUrl('https://www.instagram.com/reel/AbC9/') === 'reel:AbC9');
check(
  'the same post via different query params has the same id',
  mod.postIdFromUrl('https://www.instagram.com/p/CxYz123/?img_index=2') === mod.postIdFromUrl('https://www.instagram.com/p/CxYz123/'),
);
check(
  'normalized URL strips query params and hostname noise',
  mod.normalizeInstagramUrl('https://instagram.com/p/CxYz123/?utm_source=ig') === 'https://www.instagram.com/p/CxYz123/'
);

/* ── buildCapture: capture-card creation + collection assignment ──────── */

console.log('buildCapture');

const rawA = {
  postUrl: 'https://www.instagram.com/p/CxYz123/',
  creatorHandle: '@creator.one',
  thumbnailDataUri: 'data:image/webp;base64,AAA',
  thumbnailRemoteUrl: 'https://scontent.cdninstagram.com/thumb.jpg',
  captionRaw: '  A great hook about mornings.  ',
  postDateRaw: '2026-08-01',
  viewsRaw: '12.3K',
  likesRaw: '900',
  commentsRaw: null,
  carouselCount: null,
  mediaType: 'post',
};

const cardA = mod.buildCapture(rawA, null, 'hooks');
check('id derives from the post URL', cardA.id === 'p:CxYz123');
check('handle strips the leading @', cardA.creatorHandle === 'creator.one');
check('caption is trimmed', cardA.caption === 'A great hook about mornings.');
check('views/likes parsed, missing comments is null', cardA.metrics.views === 12300 && cardA.metrics.likes === 900 && cardA.metrics.comments === null);
check('new capture lands in the default collection', cardA.collectionId === 'hooks');
check('note starts empty', cardA.note === '');
check('data URI thumbnail is preferred over the remote fallback', cardA.thumbnail === rawA.thumbnailDataUri && !cardA.thumbnailIsRemote);
check('savedAt and updatedAt are set', cardA.savedAt > 0 && cardA.updatedAt > 0);

// Edge case: no data URI captured (tainted canvas) — stores the remote URL and says so.
const rawNoThumb = { ...rawA, thumbnailDataUri: null };
const cardNoThumb = mod.buildCapture(rawNoThumb, null, 'hooks');
check('missing data URI falls back to the remote thumbnail URL', cardNoThumb.thumbnail === rawA.thumbnailRemoteUrl && cardNoThumb.thumbnailIsRemote === true);

// Edge case: carousel — first slide saved, slide count noted.
const rawCarousel = { ...rawA, carouselCount: 4 };
check('carousel count is carried through', mod.buildCapture(rawCarousel, null, 'hooks').carouselCount === 4);

// Edge case: saving the same post twice updates rather than duplicates, and
// preserves the user's note + collection while refreshing the numbers.
const userEdited = { ...cardA, note: 'Use this as next week\'s hook.', collectionId: 'ad-ideas' };
const resaved = mod.buildCapture({ ...rawA, likesRaw: '2,000' }, userEdited, 'hooks');
check('id is unchanged on a re-save', resaved.id === cardA.id);
check('re-saving does not move the post out of its collection', resaved.collectionId === 'ad-ideas');
check('re-saving keeps the note the user wrote', resaved.note === userEdited.note);
check('re-saving refreshes the numbers', resaved.metrics.likes === 2000);
check('savedAt does not move on a re-save', resaved.savedAt === userEdited.savedAt);

/* ── matchesSearch ───────────────────────────────────────────────────── */

console.log('matchesSearch');
check('matches on caption', mod.matchesSearch(cardA, 'mornings'));
check('matches on handle', mod.matchesSearch(cardA, 'creator.one'));
check('matches on note', mod.matchesSearch(resaved, 'next week'));
check('is case-insensitive', mod.matchesSearch(cardA, 'HOOK'));
check('no match returns false', !mod.matchesSearch(cardA, 'unrelated topic'));
check('empty query matches everything', mod.matchesSearch(cardA, ''));

/* ── Export formats ─────────────────────────────────────────────────── */

console.log('exports');

const collections = [
  { id: 'hooks', name: 'Hooks', createdAt: 1 },
  { id: 'ad-ideas', name: 'Ad Ideas', createdAt: 2 },
];
const posts = [cardA, resaved].map((p, i) => ({ ...p, id: `p:${i}`, savedAt: 1000 + i }));
posts[0].collectionId = 'hooks';
posts[1].collectionId = 'ad-ideas';
posts[1].caption = 'A caption, with a comma and a "quote".';

const csv = mod.toCsv(posts, collections);
const csvLines = csv.trim().split('\r\n');
check('CSV has a header plus one row per post', csvLines.length === posts.length + 1, csvLines.length);
check('CSV header names the capture fields', csvLines[0].includes('Creator handle') && csvLines[0].includes('Views'));
check('a caption containing a quote has it doubled per CSV escaping', csvLines[2].includes('""quote""'), csvLines[2]);
check('a cell containing a comma is wrapped in quotes', /"[^"]*A caption, with a comma[^"]*"/.test(csvLines[2]), csvLines[2]);
check('missing metrics render as an empty cell, not "null"', !csv.includes('null'));

const md = mod.toMarkdown(posts, collections);
check('Markdown groups posts under their collection heading', md.includes('# Hooks') && md.includes('# Ad Ideas'));
check('Markdown includes the handle as a section', md.includes('## @creator.one'));
check('Markdown includes the numbers line', /Views: 12,300/.test(md));
check('Markdown includes the note when present', md.includes("Use this as next week's hook."));
check('Markdown links back to the original post', md.includes(`[Open post](${posts[0].postUrl})`));
check('a post with no comments shows an em dash, not "null"', md.includes('Comments: —') && !md.includes('null'));

const emptyMd = mod.toMarkdown([], collections);
check('an empty library exports without throwing', emptyMd.includes('No saved posts yet'));

const filename = mod.buildExportFilename('csv');
check('export filenames end with the right extension', filename.endsWith('.csv'));
check('export filenames are dated', /instagram-research-\d{4}-\d{2}-\d{2}\.csv/.test(filename), filename);

/* ── Storage: dedupe-on-resave + import merge-by-id ─────────────────── */

console.log('storage');

const built = mod.buildCapture(rawA, null, 'hooks');
const saved1 = await mod.savePost(built.id, existing => mod.buildCapture(rawA, existing, 'hooks'));
const afterFirstSave = await mod.readAllPosts();
check('saving a new post stores exactly one card', afterFirstSave.length === 1);

const saved2 = await mod.savePost(built.id, existing => mod.buildCapture({ ...rawA, likesRaw: '5,000' }, existing, 'hooks'));
const afterSecondSave = await mod.readAllPosts();
check('saving the same post again updates it, not a duplicate', afterSecondSave.length === 1, afterSecondSave.length);
check('the update carries the new numbers', saved2.metrics.likes === 5000);
check('id is stable across saves of the same post', saved1.id === saved2.id);

const seededCollections = await mod.readCollections();
check('collections seed with the four PRD defaults', seededCollections.map(c => c.name).join(',') === 'Hooks,Competitors,Ad Ideas,Reel Ideas', seededCollections.map(c => c.name));

const newCollection = await mod.addCollection('Client Pitch');
check('a new collection gets a stable id', typeof newCollection.id === 'string' && newCollection.id.length > 0);
await mod.renameCollection(newCollection.id, 'Client Pitch Deck');
const renamed = (await mod.readCollections()).find(c => c.id === newCollection.id);
check('collections are renameable', renamed?.name === 'Client Pitch Deck');

const quota = await mod.quotaStatus();
check('quota status reports a nonzero byte count once data exists', quota.bytes > 0, quota.bytes);
check('quota is not flagged as warning at this tiny size', quota.warn === false);

const backup = await mod.exportBackup();
check('exported backup is re-importable', backup.format === 'instagram-research-saver' && backup.version === 1);
check('exported backup carries every saved post', backup.posts.length === afterSecondSave.length);

await mod.clearAllData();
check('clearAllData removes every post', (await mod.readAllPosts()).length === 0);
check('clearAllData reseeds the default collections', (await mod.readCollections()).length === 4);

const importResult1 = await mod.importBackup(backup);
check('importing a backup restores its posts', importResult1.posts === backup.posts.length);
const afterFirstImport = await mod.readAllPosts();

const importResult2 = await mod.importBackup(backup);
check('importing the same backup twice does not duplicate posts', (await mod.readAllPosts()).length === afterFirstImport.length);
check('re-import reports the same post count, not a growing one', importResult2.posts === backup.posts.length);

const editedBackup = {
  ...backup,
  posts: backup.posts.map(p => ({ ...p, note: 'Imported note' })),
};
await mod.importBackup(editedBackup);
const afterEditedImport = await mod.readAllPosts();
check(
  'importing an updated backup overwrites the matching card by id (merge-by-id)',
  afterEditedImport.every(p => p.note === 'Imported note'),
  afterEditedImport.map(p => p.note)
);

check(
  'importBackup rejects a file that is not this product\'s backup format',
  await mod.importBackup({ format: 'something-else' }).then(
    () => false,
    () => true
  )
);

// Quota failure must never drop a save silently (PRD §8).
const originalSet = globalThis.chrome.storage.local.set;
globalThis.chrome.storage.local.set = async () => {
  throw new Error('QUOTA_BYTES_PER_ITEM quota exceeded');
};
let threw = false;
try {
  await mod.savePost('p:quota-test', existing => mod.buildCapture(rawA, existing, 'hooks'));
} catch (error) {
  threw = true;
  check('a quota failure surfaces a plain-language error, not a raw exception', /storage is full/i.test(error.message), error.message);
}
check('a storage failure while saving throws rather than failing silently', threw);
globalThis.chrome.storage.local.set = originalSet;

fs.rmSync(entry, { force: true });
fs.rmSync(bundlePath, { force: true });

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
