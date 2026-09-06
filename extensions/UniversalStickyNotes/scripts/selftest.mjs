/**
 * Headless checks for the pure logic: URL normalization, percentage-based
 * position math, the Markdown export, and storage's export/import/merge
 * behaviour (against an in-memory chrome.storage.local mock, since there's
 * no browser here).
 *
 * Position math gets the most weight because it's the one real technical
 * risk this product has (PRD §5) — a note that can't be found again reads as
 * data loss even when the text is perfectly intact. Import/merge gets equal
 * weight because the whole "no account, ever" pitch depends on that path
 * being trustworthy.
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

/* ── In-memory chrome.storage.local mock ────────────────────────────── */
/* storage.ts only touches chrome.* inside functions, never at module-eval
 * time, so installing this before the bundle is imported (not before it's
 * built) is enough. */

const store = new Map();

globalThis.chrome = {
  storage: {
    local: {
      async get(keys) {
        if (keys === null || keys === undefined) return Object.fromEntries(store);
        if (typeof keys === 'string') return store.has(keys) ? { [keys]: store.get(keys) } : {};
        const out = {};
        for (const key of keys) if (store.has(key)) out[key] = store.get(key);
        return out;
      },
      async set(obj) {
        for (const [key, value] of Object.entries(obj)) store.set(key, value);
      },
      async remove(keys) {
        for (const key of Array.isArray(keys) ? keys : [keys]) store.delete(key);
      },
      async getBytesInUse() {
        return Buffer.byteLength(JSON.stringify(Object.fromEntries(store)));
      },
    },
  },
};

function resetStore() {
  store.clear();
}

/* ── Bundle the pure(ish) modules for Node ──────────────────────────── */

const entry = path.join(os.tmpdir(), `sn-selftest-${process.pid}.mjs`);
fs.writeFileSync(
  entry,
  ['url.ts', 'position.ts', 'formatters.ts', 'storage.ts']
    .map(file => `export * from ${JSON.stringify(path.join(rootDir, 'src', file).replace(/\\/g, '/'))};`)
    .join('\n')
);

const bundlePath = path.join(os.tmpdir(), `sn-selftest-bundle-${process.pid}.mjs`);
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

/* ── URL normalization ───────────────────────────────────────────────── */

console.log('urls');
const canonical = 'https://example.com/posts/anti-fragile';
check(
  'strips utm parameters',
  mod.normalizeUrl(`${canonical}?utm_source=newsletter&utm_medium=email`) === canonical,
  mod.normalizeUrl(`${canonical}?utm_source=newsletter`)
);
check('strips the fragment', mod.normalizeUrl(`${canonical}#section-3`) === canonical);
check('drops www and trailing slash', mod.normalizeUrl('https://www.example.com/posts/anti-fragile/') === canonical);
check('keeps meaningful query parameters', mod.normalizeUrl(`${canonical}?page=2`) === `${canonical}?page=2`);
check(
  'parameter order does not create a second key',
  mod.normalizeUrl(`${canonical}?b=2&a=1`) === mod.normalizeUrl(`${canonical}?a=1&b=2`)
);
check('keeps a bare origin usable', mod.normalizeUrl('https://example.com/') === 'https://example.com/');
check('rejects chrome pages', mod.isSupportedUrl('chrome://extensions') === false);
check('rejects file pages', mod.isSupportedUrl('file:///C:/notes.txt') === false);
check('accepts https pages', mod.isSupportedUrl('https://example.com') === true);
check('site name drops www', mod.siteName('https://www.example.com/x') === 'example.com');

/* ── Percentage-based position math ─────────────────────────────────── */

console.log('position');

check('pxToPercent / percentToPx round-trip', Math.abs(mod.percentToPx(mod.pxToPercent(340, 1200), 1200) - 340) < 1e-6);
check('pxToPercent clamps below zero', mod.pxToPercent(-50, 1000) === 0);
check('pxToPercent clamps above the total', mod.pxToPercent(5000, 1000) === 100);
check('pxToPercent on a zero-width document does not divide by zero', mod.pxToPercent(50, 0) === 0);
check('percentToPx clamps a negative percent', mod.percentToPx(-10, 1000) === 0);
check('percentToPx clamps a percent over 100', mod.percentToPx(140, 1000) === 1000);

check(
  'a note keeps its relative position when the document simply gets taller',
  // A note saved at 50% down a 2000px-tall page should land at the same
  // *visual neighbourhood* proportionally on a 2400px-tall page — this is
  // the whole mitigation from PRD §5.
  Math.round(mod.percentToPx(mod.pxToPercent(1000, 2000), 2400)) === 1200
);

check('clampSize enforces the minimum width', mod.clampSize(40, 200).width === mod.MIN_NOTE_WIDTH);
check('clampSize enforces the minimum height', mod.clampSize(300, 10).height === mod.MIN_NOTE_HEIGHT);
check('clampSize leaves a reasonable size untouched', JSON.stringify(mod.clampSize(240, 160)) === JSON.stringify({ width: 240, height: 160 }));

const withinDoc = mod.clampToDocument(500, 500, 2000, 3000);
check('clampToDocument leaves an in-bounds position alone', withinDoc.left === 500 && withinDoc.top === 500);

const offLeft = mod.clampToDocument(-200, 500, 2000, 3000);
check('clampToDocument pulls a note back from the left edge', offLeft.left === 0);

const offRight = mod.clampToDocument(2500, 500, 2000, 3000, 24);
check(
  'clampToDocument keeps a note reachable at the right edge — never fully off-document',
  offRight.left === 2000 - 24
);

const offBottom = mod.clampToDocument(500, 9999, 2000, 3000, 24);
check('clampToDocument keeps a note reachable at the bottom edge', offBottom.top === 3000 - 24);

const shrunkDoc = mod.clampToDocument(1900, 2900, 800, 1200, 24);
check(
  'a note whose page got dramatically shorter is still pulled back onto the document, not lost',
  shrunkDoc.left <= 800 && shrunkDoc.top <= 1200
);

check('cascadeOffset is zero for the first note', mod.cascadeOffset(0) === 0);
check('cascadeOffset increases for the next drop', mod.cascadeOffset(1) > mod.cascadeOffset(0));
check('cascadeOffset wraps rather than growing without bound', mod.cascadeOffset(8) === mod.cascadeOffset(0));

/* ── Markdown export ─────────────────────────────────────────────────── */

console.log('markdown export');

const notePages = [
  {
    meta: { url: 'https://example.com/a', title: 'Article A', site: 'example.com', captured: '2026-08-01' },
    hidden: false,
    updatedAt: 2,
    notes: [
      { id: 'n1', color: 'yellow', text: 'Check this stat', xPct: 10, yPct: 10, widthPx: 220, heightPx: 160, createdAt: 2, updatedAt: 2 },
      { id: 'n2', color: 'pink', text: '  ', xPct: 30, yPct: 40, widthPx: 220, heightPx: 160, createdAt: 1, updatedAt: 1 },
    ],
  },
  {
    meta: { url: 'https://example.com/b', title: '', site: 'example.com', captured: '2026-08-02' },
    hidden: false,
    updatedAt: 1,
    notes: [],
  },
];

const md = mod.toMarkdown(notePages);
check('markdown groups by page', md.includes('## Article A'));
check('markdown carries the source url', md.includes('Source: https://example.com/a'));
check('markdown includes each note with its colour', md.includes('**[yellow]** Check this stat'));
check('notes come out in creation order', md.indexOf('**[pink]**') < md.indexOf('**[yellow]**'));
check('whitespace-only notes still export, labelled as empty', md.includes('_(empty note)_'));
check('a page with zero notes is skipped entirely', !md.includes('example.com/b'));

const emptyMd = mod.toMarkdown([]);
check('an empty library exports without throwing', emptyMd.includes('No notes yet'));

const filenameMd = mod.buildMarkdownFilename();
check('markdown filename has a .md extension and a date', /^sticky-notes-\d{4}-\d{2}-\d{2}\.md$/.test(filenameMd), filenameMd);
const filenameBackup = mod.buildBackupFilename();
check('backup filename has a .json extension and a date', /^sticky-notes-backup-\d{4}-\d{2}-\d{2}\.json$/.test(filenameBackup), filenameBackup);

/* ── Storage: writes, quota, and whole-library ops ──────────────────── */

console.log('storage — basics');
resetStore();

// mutatePage's second argument is meta whose own .url is what actually gets
// used as the storage key when creating a new record (real callers always
// keep this in sync with the normalizedUrl argument — see content.ts). Every
// call below builds a meta object matching the page it targets, on purpose.
const metaFor = url => ({ url, title: 'Page', site: 'example.com', captured: '2026-09-01' });

await mod.mutatePage('https://example.com/page', metaFor('https://example.com/page'), record => {
  record.notes.push({ id: 'a', color: 'yellow', text: 'first', xPct: 10, yPct: 10, widthPx: 200, heightPx: 140, createdAt: 1, updatedAt: 1 });
});
let stored = await mod.readPage('https://example.com/page');
check('mutatePage creates a page record on first write', stored?.notes.length === 1);

await mod.mutatePage('https://example.com/page', metaFor('https://example.com/page'), record => {
  record.notes.push({ id: 'b', color: 'blue', text: 'second', xPct: 20, yPct: 20, widthPx: 200, heightPx: 140, createdAt: 2, updatedAt: 2 });
});
stored = await mod.readPage('https://example.com/page');
check('a second mutatePage call appends rather than overwrites', stored?.notes.length === 2);

// Concurrent mutations on the same page must serialize, not race.
resetStore();
await Promise.all(
  Array.from({ length: 20 }, (_, i) =>
    mod.mutatePage('https://example.com/race', metaFor('https://example.com/race'), record => {
      record.notes.push({ id: `r${i}`, color: 'yellow', text: `${i}`, xPct: 0, yPct: 0, widthPx: 200, heightPx: 140, createdAt: i, updatedAt: i });
    })
  )
);
const raced = await mod.readPage('https://example.com/race');
check('20 concurrent mutatePage calls all land — none lost to a race', raced?.notes.length === 20, raced?.notes.length);

// Writing a page down to zero notes removes the record rather than storing a husk.
resetStore();
await mod.mutatePage('https://example.com/husk', metaFor('https://example.com/husk'), record => {
  record.notes.push({ id: 'x', color: 'yellow', text: 'x', xPct: 0, yPct: 0, widthPx: 200, heightPx: 140, createdAt: 1, updatedAt: 1 });
});
await mod.mutatePage('https://example.com/husk', metaFor('https://example.com/husk'), record => {
  record.notes = [];
});
check('a page emptied back to zero notes is removed, not stored empty', (await mod.readPage('https://example.com/husk')) === null);

console.log('storage — mutateExistingPage');
resetStore();
const missing = await mod.mutateExistingPage('https://example.com/nope', record => {
  record.notes.push({});
});
check('mutateExistingPage is a no-op when the page does not exist', missing === undefined);

await mod.mutatePage('https://example.com/real', metaFor('https://example.com/real'), record => {
  record.notes.push({ id: 'z', color: 'green', text: 'z', xPct: 0, yPct: 0, widthPx: 200, heightPx: 140, createdAt: 1, updatedAt: 1 });
});
await mod.mutateExistingPage('https://example.com/real', record => {
  record.hidden = true;
});
const hiddenToggled = await mod.readPage('https://example.com/real');
check('mutateExistingPage can toggle hidden without touching notes', hiddenToggled?.hidden === true && hiddenToggled?.notes.length === 1);

/* ── Export / import / merge ────────────────────────────────────────── */

console.log('storage — export / import / merge');
resetStore();

await mod.mutatePage('https://example.com/one', { url: 'https://example.com/one', title: 'One', site: 'example.com', captured: '2026-08-01' }, record => {
  record.notes.push({ id: 'n1', color: 'yellow', text: 'note one', xPct: 10, yPct: 10, widthPx: 200, heightPx: 140, createdAt: 1, updatedAt: 1 });
});
await mod.mutatePage('https://example.com/two', { url: 'https://example.com/two', title: 'Two', site: 'example.com', captured: '2026-08-02' }, record => {
  record.notes.push({ id: 'n2', color: 'blue', text: 'note two', xPct: 20, yPct: 20, widthPx: 200, heightPx: 140, createdAt: 1, updatedAt: 1 });
});

const backup = await mod.exportBackup();
check('backup has the right format tag', backup.format === 'universal-sticky-notes');
check('backup captures every page', backup.pages.length === 2);
check('backup captures every note', backup.pages.reduce((sum, p) => sum + p.notes.length, 0) === 2);

resetStore(); // simulate a fresh browser profile
const firstImport = await mod.importBackup(backup);
check('importing into an empty store restores every page', firstImport.pages === 2);
check('importing into an empty store restores every note', firstImport.notes === 2);

const secondImport = await mod.importBackup(backup);
check(
  'importing the exact same backup twice does not duplicate a single note',
  secondImport.notes === 0,
  `expected 0 new notes, got ${secondImport.notes}`
);
const afterDoubleImport = await mod.readPage('https://example.com/one');
check('note count after a duplicate import is unchanged', afterDoubleImport?.notes.length === 1);

// A note edited locally after the backup was made must survive a re-import
// of the older backup (merge by id keeps the newest object per id — a
// straight import of an older file should not resurrect stale text once a
// note has been edited to a *new* id-preserving state from the import path
// itself, but an edit made outside the import must not be silently reverted
// by an unrelated page in the same file).
await mod.mutatePage('https://example.com/one', { url: 'https://example.com/one', title: 'One', site: 'example.com', captured: '2026-08-01' }, record => {
  record.notes.push({ id: 'n3', color: 'green', text: 'added after export', xPct: 5, yPct: 5, widthPx: 200, heightPx: 140, createdAt: 2, updatedAt: 2 });
});
const thirdImport = await mod.importBackup(backup);
check('re-importing an older backup does not remove a note added since', thirdImport.pages === 2);
const mergedOne = await mod.readPage('https://example.com/one');
check('a note added after export survives a re-import of the older file', mergedOne?.notes.some(n => n.id === 'n3'));
check('the original note is still present after merge', mergedOne?.notes.some(n => n.id === 'n1'));
check('merge does not duplicate the original note', mergedOne?.notes.filter(n => n.id === 'n1').length === 1);

check('importing something that is not a backup throws a plain-language error', await (async () => {
  try {
    await mod.importBackup({ not: 'a backup' });
    return false;
  } catch (error) {
    return typeof error.message === 'string' && error.message.length > 0;
  }
})());

console.log('storage — clear all');
await mod.clearAllData();
check('clearAllData removes every page', (await mod.readAllPages()).length === 0);

console.log('storage — quota');
resetStore();
await mod.mutatePage('https://example.com/quota', metaFor('https://example.com/quota'), record => {
  record.notes.push({ id: 'q', color: 'yellow', text: 'x'.repeat(1000), xPct: 0, yPct: 0, widthPx: 200, heightPx: 140, createdAt: 1, updatedAt: 1 });
});
const quota = await mod.quotaStatus();
check('quotaStatus reports a non-zero byte count once something is stored', quota.bytes > 0);
check('quotaStatus does not warn at trivial usage', quota.warn === false);

fs.rmSync(entry, { force: true });
fs.rmSync(bundlePath, { force: true });

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
