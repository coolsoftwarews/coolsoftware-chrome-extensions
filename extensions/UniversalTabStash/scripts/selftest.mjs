/**
 * Headless checks for the pure logic: stash creation, filtering, search,
 * restore planning, the two export formats, filenames, and backup merge-by-id.
 * Nothing in stash.ts or formatters.ts touches chrome.* — that's the whole
 * point of the split (PRD §5) — so all of it runs here in plain Node.
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

const entry = path.join(os.tmpdir(), `uts-selftest-${process.pid}.mjs`);
fs.writeFileSync(
  entry,
  ['stash.ts', 'formatters.ts']
    .map(file => `export * from ${JSON.stringify(path.join(rootDir, 'src', file).replace(/\\/g, '/'))};`)
    .join('\n')
);

const bundlePath = path.join(os.tmpdir(), `uts-selftest-bundle-${process.pid}.mjs`);
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
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/* ── Fixtures ────────────────────────────────────────────────────────── */

let idCounter = 0;
const idGenerator = () => `fixed-${++idCounter}`;

const openTabs = [
  { chromeTabId: 1, title: 'Antifragile — Wikipedia', url: 'https://en.wikipedia.org/wiki/Antifragility', pinned: false },
  { chromeTabId: 2, title: 'Gmail', url: 'https://mail.google.com/', pinned: true },
  { chromeTabId: 3, title: 'Research notes doc', url: 'https://docs.example.com/notes', favIconUrl: 'https://docs.example.com/favicon.ico', pinned: false },
];

/* ── createStash / defaultStashName ─────────────────────────────────── */

console.log('createStash');
idCounter = 0;
const now = new Date('2026-09-02T15:14:00').getTime();
const stash = mod.createStash({ name: '  Q3 research  ', notes: ' for the review ', tabs: openTabs, now, idGenerator });

check('trims the given name', stash.name === 'Q3 research');
check('trims notes', stash.notes === 'for the review');
check('keeps tab order', stash.tabs.map(t => t.url).join(',') === openTabs.map(t => t.url).join(','));
check('every tab gets a stable id', stash.tabs.every(t => typeof t.id === 'string' && t.id.length > 0));
check('tab ids are unique', new Set(stash.tabs.map(t => t.id)).size === stash.tabs.length);
check('pinned flag is carried through', stash.tabs[1].pinned === true);
check('favicon is carried through when present', stash.tabs[2].favIconUrl === 'https://docs.example.com/favicon.ico');
check('createdAt/updatedAt use the given clock', stash.createdAt === now && stash.updatedAt === now);

const blank = mod.createStash({ name: '   ', tabs: openTabs.slice(0, 2), now, idGenerator: () => `x${Math.random()}` });
check('a blank name falls back to the default namer', blank.name.startsWith('2 tabs'));

check('a page still loading falls back to its URL as a title', (() => {
  const open = mod.toOpenTab({ id: 9, title: '', url: 'https://example.com/slow', pinned: false });
  return open.title === 'https://example.com/slow';
})());
check('a tab with neither title nor url gets a plain placeholder', mod.toOpenTab({ id: 9, pinned: false }).title === 'Untitled tab');

/* ── filterIncludable (pinned-tab default, PRD §7) ──────────────────── */

console.log('filterIncludable');
check('pinned tabs are excluded by default', mod.filterIncludable(openTabs, false).every(t => !t.pinned));
check('pinned tabs can be opted in', mod.filterIncludable(openTabs, true).some(t => t.pinned));
check('excluding pinned keeps everything else', mod.filterIncludable(openTabs, false).length === 2);

/* ── searchStashes ───────────────────────────────────────────────────── */

console.log('searchStashes');
idCounter = 0;
const stashA = mod.createStash({ name: 'Reading', tabs: [openTabs[0]], now: now - 1000, idGenerator });
const stashB = mod.createStash({ name: 'Work', tabs: [openTabs[2], openTabs[1]], now, idGenerator });

const hitsByTitle = mod.searchStashes([stashA, stashB], 'antifragil');
check('matches by title, case-insensitive', hitsByTitle.length === 1 && hitsByTitle[0].tab.url === openTabs[0].url);

const hitsByUrl = mod.searchStashes([stashA, stashB], 'docs.example.com');
check('matches by url', hitsByUrl.length === 1 && hitsByUrl[0].tab.title === 'Research notes doc');

check('empty query returns nothing', mod.searchStashes([stashA, stashB], '   ').length === 0);
check('no match returns an empty array, not null', Array.isArray(mod.searchStashes([stashA, stashB], 'nonexistent-xyz')));
check(
  'more recently updated stashes are searched first',
  mod.searchStashes([stashA, stashB], 'e')[0].stashName === 'Work'
);

/* ── planRestore (batching + confirmation threshold, PRD §7) ──────────── */

console.log('planRestore');
idCounter = 0;
const small = mod.createStash({ name: 'Small', tabs: openTabs.slice(0, 2), now, idGenerator });
const smallPlan = mod.planRestore(small);
check('small stash needs no confirmation', smallPlan.needsConfirmation === false);
check('small stash is a single batch', smallPlan.batches.length === 1);

const manyOpen = Array.from({ length: 47 }, (_, i) => ({
  chromeTabId: i,
  title: `Tab ${i}`,
  url: `https://example.com/${i}`,
  pinned: false,
}));
idCounter = 0;
const bigStash = mod.createStash({ name: 'Big', tabs: manyOpen, now, idGenerator });
const bigPlan = mod.planRestore(bigStash);
check('a 47-tab stash needs confirmation', bigPlan.needsConfirmation === true, `${bigPlan.tabs.length} tabs`);
check(
  'batches are capped at the configured batch size',
  bigPlan.batches.every(batch => batch.length <= mod.RESTORE_BATCH_SIZE)
);
check(
  'batches cover every tab exactly once',
  bigPlan.batches.flat().length === bigPlan.tabs.length &&
    new Set(bigPlan.batches.flat().map(t => t.id)).size === bigPlan.tabs.length
);

const singleTabPlan = mod.planRestore(bigStash, [bigStash.tabs[3].id]);
check('restoring a subset only plans those tabs', singleTabPlan.tabs.length === 1);
check('a one-tab restore needs no confirmation', singleTabPlan.needsConfirmation === false);

/* ── mergeBackup (import merge-by-id, PRD §4) ───────────────────────── */

console.log('mergeBackup');

const backupV1 = {
  format: 'universal-tab-stash',
  version: 1,
  exportedAt: new Date(now).toISOString(),
  stashes: [stashA, stashB],
};

const firstImport = mod.mergeBackup([], backupV1);
check('importing into an empty library adds every stash', firstImport.merged.length === 2);
check('importing into an empty library counts every tab as new', firstImport.stats.tabs === stashA.tabs.length + stashB.tabs.length);

const secondImport = mod.mergeBackup(firstImport.merged, backupV1);
check('re-importing the same file adds no new stashes', secondImport.stats.stashes === 0);
check('re-importing the same file adds no new tabs', secondImport.stats.tabs === 0);
check('re-importing does not duplicate tabs inside a stash', secondImport.merged.find(s => s.id === stashB.id).tabs.length === stashB.tabs.length);

idCounter = 100;
const extraTab = mod.createStash({ name: 'ignored', tabs: [{ chromeTabId: 5, title: 'New find', url: 'https://example.com/new', pinned: false }], now, idGenerator }).tabs[0];
const backupV2 = {
  format: 'universal-tab-stash',
  version: 1,
  exportedAt: new Date(now).toISOString(),
  stashes: [{ ...stashB, tabs: [...stashB.tabs, extraTab] }],
};
const thirdImport = mod.mergeBackup(firstImport.merged, backupV2);
check('adding one new tab to an existing stash is detected', thirdImport.stats.tabs === 1);
check('the existing stash keeps its old tabs plus the new one', thirdImport.merged.find(s => s.id === stashB.id).tabs.length === stashB.tabs.length + 1);

check('a file with the wrong format is rejected', (() => {
  try {
    mod.parseBackup({ format: 'something-else', stashes: [] });
    return false;
  } catch (e) {
    return /not a Universal Tab Stash backup/.test(e.message);
  }
})());

/* ── Export formats ──────────────────────────────────────────────────── */

console.log('exports');

const exportStash = {
  id: 's1',
  name: 'Q3 research',
  notes: 'For the strategy review',
  createdAt: new Date('2026-08-15').getTime(),
  updatedAt: new Date('2026-08-15').getTime(),
  tabs: [
    { id: 't1', title: 'Antifragile — Wikipedia', url: 'https://en.wikipedia.org/wiki/Antifragility', pinned: false },
    { id: 't2', title: 'A "quoted", tricky title', url: 'https://example.com/x?y=1', pinned: true },
  ],
};

const md = mod.toMarkdown(exportStash);
check('markdown starts with a heading of the stash name', md.startsWith('## Q3 research'));
check('markdown includes the notes', md.includes('For the strategy review'));
check('markdown lists every tab as a link', md.includes('[Antifragile — Wikipedia](https://en.wikipedia.org/wiki/Antifragility)'));
check('markdown flags pinned tabs', md.includes('*(pinned)*'));

const emptyStash = { ...exportStash, tabs: [] };
check('an empty stash exports without throwing', mod.toMarkdown(emptyStash).includes('No tabs in this stash'));

const mdAll = mod.toMarkdownAll([exportStash, emptyStash]);
check('toMarkdownAll includes every stash as its own section', mdAll.includes('## Q3 research') && mdAll.includes(emptyStash.name));
check('an empty library exports without throwing', mod.toMarkdownAll([]).includes('No stashes yet'));

const csv = mod.toCsv(exportStash);
const csvLines = csv.trim().split('\r\n');
check('csv has a header row', csvLines[0] === 'stash,title,url,pinned,stash_created,notes');
check('csv has one row per tab', csvLines.length === 1 + exportStash.tabs.length);
check('csv quotes a value containing a comma or quote', csvLines[2].includes('"A ""quoted"", tricky title"'));
check('csv marks the pinned tab as true', csvLines[2].includes(',true,'));

const csvAll = mod.toCsvAll([exportStash, emptyStash]);
check('toCsvAll has one row per tab across every stash', csvAll.trim().split('\r\n').length === 1 + exportStash.tabs.length);

/* ── Filenames ───────────────────────────────────────────────────────── */

console.log('filenames');
const filename = mod.buildFilename('Q3 research', 'md');
check('sanitizes and appends the extension', filename === 'Q3 research.md', filename);
check('drops filesystem-hostile characters', !/[\\/:*?"<>|]/.test(mod.buildFilename('a/b:c*d?', 'csv')));

const longName = mod.buildFilename('x'.repeat(400), 'csv');
check('truncates to 120 characters', longName.length <= 120, `${longName.length} chars`);
check('keeps the extension after truncation', longName.endsWith('.csv'));

const blankName = mod.buildFilename('   ', 'json');
check('falls back to a default stem when the name is blank', blankName === 'tab-stash.json', blankName);

fs.rmSync(entry, { force: true });
fs.rmSync(bundlePath, { force: true });

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
