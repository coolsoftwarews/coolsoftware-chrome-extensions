/**
 * Headless checks for the pure logic: pin id/URL normalization, capture-card
 * building (dedupe/update semantics), search, domain grouping, thumbnail
 * dimension capping, the three export formats, and import merge-by-id
 * semantics.
 *
 * The DOM-bound half (content.ts — scraping Pinterest's live markup, button
 * injection) needs a real browser and is covered by the manual checklist in
 * the README, same split as WebHighlighter's quote.ts / anchor.ts.
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

const entry = path.join(os.tmpdir(), `pcr-selftest-${process.pid}.mjs`);
fs.writeFileSync(
  entry,
  ['capture.ts', 'formatters.ts', 'merge.ts', 'thumbnail.ts', 'types.ts']
    .map(file => `export * from ${JSON.stringify(path.join(rootDir, 'src', file).replace(/\\/g, '/'))};`)
    .join('\n')
);

const bundlePath = path.join(os.tmpdir(), `pcr-selftest-bundle-${process.pid}.mjs`);
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
    console.log(`  FAIL ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`);
  }
}

/* ── Pin id / URL normalization ─────────────────────────────────────── */

console.log('pin ids and urls');

check(
  'extracts the trailing numeric id',
  mod.pinIdFromUrl('https://www.pinterest.com/pin/1234567890123456789/') === 'pin:1234567890123456789'
);
check(
  'extracts the id when a descriptive slug precedes it',
  mod.pinIdFromUrl('https://www.pinterest.com/pin/best-summer-recipes--9876543210123456789/') ===
    'pin:9876543210123456789'
);
check(
  'the same pin reached two different ways gets the same id',
  mod.pinIdFromUrl('https://de.pinterest.com/pin/1234567890123456789/') ===
    mod.pinIdFromUrl('https://www.pinterest.com/pin/1234567890123456789/?utm_source=x')
);
check(
  'normalizes to the canonical pinterest.com pin URL',
  mod.normalizePinUrl('https://uk.pinterest.com/pin/1234567890123456789/?e=1') ===
    'https://www.pinterest.com/pin/1234567890123456789/'
);
check('a URL with no recognizable id never throws', typeof mod.pinIdFromUrl('not a url at all') === 'string');

check('drops www from a plain domain', mod.domainFromUrl('https://www.example.com/a/b') === 'example.com');
check('lowercases the domain', mod.domainFromUrl('https://Shop.Example.COM/x') === 'shop.example.com');
check('an empty destination yields an empty domain', mod.domainFromUrl('') === '');

/* ── capDimensions ───────────────────────────────────────────────────── */

console.log('thumbnail sizing');

check('leaves a small image untouched', JSON.stringify(mod.capDimensions(100, 80)) === JSON.stringify({ width: 100, height: 80 }));
const landscape = mod.capDimensions(2400, 1200);
check('caps a wide image on its longer side', landscape.width === 240 && landscape.height === 120, landscape);
const portrait = mod.capDimensions(900, 1800);
check('caps a tall image on its longer side', portrait.height === 240 && portrait.width === 120, portrait);
check('zero-size input never divides by zero', JSON.stringify(mod.capDimensions(0, 0)) === JSON.stringify({ width: 0, height: 0 }));

/* ── buildCapture: dedupe / update semantics ────────────────────────── */

console.log('buildCapture');

const rawGrid = {
  pinUrl: 'https://www.pinterest.com/pin/1111111111111111111/',
  imageDataUri: 'data:image/jpeg;base64,AAAA',
  imageRemoteUrl: 'https://i.pinimg.com/originals/aa/bb/cc.jpg',
  titleRaw: 'Cozy fall recipes  ',
  descriptionRaw: '',
  descriptionTruncated: true,
  destinationDomainRaw: '',
  destinationUrlRaw: '',
  boardNameRaw: '',
  creatorRaw: '',
  savesRaw: '',
  capturedFrom: 'grid',
};

const firstSave = mod.buildCapture(rawGrid, null, 'competitors');
check('assigns the default collection on first save', firstSave.collectionId === 'competitors');
check('trims the title', firstSave.title === 'Cozy fall recipes');
check('prefers the capped data URI over the remote URL', firstSave.imageUrl === rawGrid.imageDataUri && !firstSave.imageIsRemote);
check('grid captures are flagged as possibly-truncated', firstSave.descriptionTruncated === true);
check('savedAt and updatedAt match on first save', firstSave.savedAt === firstSave.updatedAt);

const withNote = { ...firstSave, note: 'Keep an eye on this one', collectionId: 'design-ideas' };
const rawDetail = {
  ...rawGrid,
  descriptionRaw: 'The full description, only visible on the pin detail page.',
  descriptionTruncated: false,
  destinationDomainRaw: 'competitorshop.com',
  destinationUrlRaw: 'https://competitorshop.com/product/123',
  boardNameRaw: 'Fall Favorites',
  creatorRaw: '@competitor_brand',
  savesRaw: '4.2k',
  capturedFrom: 'detail',
};
const secondSave = mod.buildCapture(rawDetail, withNote, 'competitors');

check('re-saving the same pin keeps the same id', secondSave.id === firstSave.id);
check('re-saving preserves the user note', secondSave.note === 'Keep an eye on this one');
check('re-saving preserves the collection the user chose', secondSave.collectionId === 'design-ideas');
check('re-saving preserves the original saved date', secondSave.savedAt === firstSave.savedAt);
check('re-saving refreshes the description', secondSave.description.includes('only visible on the pin detail page'));
check('re-saving un-flags truncation once a full capture succeeds', secondSave.descriptionTruncated === false);
check('creator handle loses its leading @', secondSave.creator === 'competitor_brand');
check('destination domain comes from the scraped label', secondSave.destinationDomain === 'competitorshop.com');

const noDomainLabel = mod.buildCapture(
  { ...rawDetail, destinationDomainRaw: '', destinationUrlRaw: 'https://Other-Shop.com/x' },
  null,
  'competitors'
);
check('falls back to deriving the domain from the URL', noDomainLabel.destinationDomain === 'other-shop.com');

const mixedCaseLabel = mod.buildCapture({ ...rawDetail, destinationDomainRaw: 'CompetitorShop.COM' }, null, 'competitors');
check('lowercases a scraped domain label so grouping is consistent', mixedCaseLabel.destinationDomain === 'competitorshop.com');

/* ── search / grouping ───────────────────────────────────────────────── */

console.log('search and grouping');

const pins = [
  { ...secondSave, id: 'p1', destinationDomain: 'shopa.com', title: 'Autumn wreaths', description: 'DIY wreath ideas', note: '' },
  { ...secondSave, id: 'p2', destinationDomain: 'shopa.com', title: 'Fall table settings', description: '', note: 'reuse this angle' },
  { ...secondSave, id: 'p3', destinationDomain: 'shopb.com', title: 'Minimalist decor', description: '', note: '' },
];

check('search matches on title', mod.matchesSearch(pins[0], 'wreath'));
check('search matches on note', mod.matchesSearch(pins[1], 'reuse'));
check('search is case-insensitive', mod.matchesSearch(pins[0], 'AUTUMN'));
check('search rejects a non-match', !mod.matchesSearch(pins[2], 'wreath'));
check('an empty query matches everything', pins.every(p => mod.matchesSearch(p, '')));

const groups = mod.groupByDomain(pins);
check('groups by domain', groups.length === 2);
check('the busier domain sorts first', groups[0].domain === 'shopa.com' && groups[0].count === 2);

/* ── Export formats ──────────────────────────────────────────────────── */

console.log('exports');

const collections = [
  { id: 'competitors', name: 'Competitors', createdAt: 1 },
  { id: 'design-ideas', name: 'Design ideas', createdAt: 2 },
];

const csv = mod.toCsv([secondSave], collections);
const csvLines = csv.trim().split('\r\n');
check('csv has a header row plus one row per pin', csvLines.length === 2);
check('csv header carries the PRD-named columns', csv.includes('Title') && csv.includes('Domain') && csv.includes('Saves'));
check('csv resolves the collection name, not the id', csv.includes('Design ideas'));
check('csv keeps the destination and pin urls', csv.includes(secondSave.destinationUrl) && csv.includes(secondSave.pinUrl));

const withComma = { ...secondSave, id: 'p4', title: 'Recipes, breads & cakes' };
const csvEscaped = mod.toCsv([withComma], collections);
check('csv quotes a field containing a comma', csvEscaped.includes('"Recipes, breads & cakes"'));

const md = mod.toMarkdown([secondSave, firstSave], collections);
check('markdown groups by collection with a heading', md.includes('# Design ideas'));
check('markdown embeds the thumbnail', md.includes(`![`) && md.includes(secondSave.imageUrl));
check('markdown includes the note', md.includes('Keep an eye on this one'));
check('markdown links back to the pin', md.includes(`[Open pin](${secondSave.pinUrl})`));
check('markdown flags a truncated grid capture', md.includes('captured from the grid') || md.includes('No description captured'));

const emptyMd = mod.toMarkdown([], collections);
check('an empty library exports without throwing', emptyMd.includes('No saved pins yet'));

const filename = mod.buildExportFilename('csv');
check('filenames are dated and namespaced', /^pinterest-competitor-research-\d{4}-\d{2}-\d{2}\.csv$/.test(filename), filename);

/* ── Import merge-by-id semantics ───────────────────────────────────── */

console.log('import merge');

check('a non-backup file is rejected', (() => {
  try {
    mod.validateBackup({ format: 'something-else', pins: [] });
    return false;
  } catch {
    return true;
  }
})());

const backup = mod.validateBackup({
  format: 'pinterest-competitor-research',
  version: 1,
  exportedAt: new Date().toISOString(),
  pins: [
    { ...secondSave, id: 'p1', note: 'from backup' }, // conflicts with an existing local pin
    { ...secondSave, id: 'p9', pinUrl: 'https://www.pinterest.com/pin/9999999999999999999/' }, // brand new
  ],
  collections: [
    { id: 'competitors', name: 'Competitors (renamed in backup)', createdAt: 1 }, // conflicts, incoming wins
    { id: 'title-patterns', name: 'Title patterns', createdAt: 2 }, // new
  ],
});

const localPins = [
  { ...secondSave, id: 'p1', note: 'kept locally until import' },
  { ...secondSave, id: 'p5', pinUrl: 'https://www.pinterest.com/pin/5555555555555555555/', note: 'local-only pin' },
];
const localCollections = collections;

const merged = mod.mergeImport(backup, localPins, localCollections);
check('reports both incoming pins as processed', merged.stats.pins === 2);
check('reports one brand-new collection (the other already existed)', merged.stats.collections === 1);
check('the incoming pin wins on a conflicting id', merged.pins.find(p => p.id === 'p1').note === 'from backup');
check('a pin only in the backup is added', Boolean(merged.pins.find(p => p.id === 'p9')));
check('a local pin absent from the backup is preserved, not dropped', merged.pins.find(p => p.id === 'p5')?.note === 'local-only pin');
check('the merged library has exactly the union of both sides', merged.pins.length === 3);
check('the incoming collection name wins on conflict', merged.collections.find(c => c.id === 'competitors').name.includes('renamed'));
check('a collection only in the backup is added', Boolean(merged.collections.find(c => c.id === 'title-patterns')));

const reimported = mod.mergeImport(backup, merged.pins, merged.collections);
check('importing the same backup twice does not duplicate pins', reimported.pins.length === merged.pins.length);
check('importing the same backup twice keeps the library at three pins', reimported.pins.length === 3);
check('importing the same backup twice reports zero new collections', reimported.stats.collections === 0);

const defaults = mod.defaultCollections();
check('ships with four default collections', defaults.length === 4);
check('default collection names match the PRD', defaults.map(c => c.name).join(',') === 'Competitors,Title patterns,Product framing,Design ideas');

fs.rmSync(entry, { force: true });
fs.rmSync(bundlePath, { force: true });

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
