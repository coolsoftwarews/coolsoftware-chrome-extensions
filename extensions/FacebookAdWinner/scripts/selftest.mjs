/**
 * Headless checks for the pure logic: date/card parsing, variant grouping,
 * longevity/badge math, filters/sort, exports and filenames.
 *
 * The PRD calls longevity and grouping "the entire product" (§4), so those
 * get the most coverage here. The DOM-bound half (finding cards on a live
 * Ad Library page) needs a browser and is covered by the manual checklist
 * in the README — Meta's markup cannot be fixtured honestly without it.
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

const entry = path.join(os.tmpdir(), `faw-selftest-${process.pid}.mjs`);
fs.writeFileSync(
  entry,
  ['adparser.ts', 'grouping.ts', 'longevity.ts', 'filters.ts', 'formatters.ts', 'url.ts']
    .map(file => `export * from ${JSON.stringify(path.join(rootDir, 'src', file).replace(/\\/g, '/'))};`)
    .join('\n')
);

const bundlePath = path.join(os.tmpdir(), `faw-selftest-bundle-${process.pid}.mjs`);
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

/* ── URLs ────────────────────────────────────────────────────────────── */

console.log('urls');
check('accepts an Ad Library results page', mod.isAdLibraryUrl('https://www.facebook.com/ads/library/?active_status=active') === true);
check('accepts the bare Ad Library path', mod.isAdLibraryUrl('https://www.facebook.com/ads/library') === true);
check('rejects the News Feed', mod.isAdLibraryUrl('https://www.facebook.com/') === false);
check('rejects a different site entirely', mod.isAdLibraryUrl('https://example.com/ads/library/') === false);
check('rejects undefined', mod.isAdLibraryUrl(undefined) === false);
check('extractDomain strips protocol and www', mod.extractDomain('https://www.example.com/landing?x=1') === 'example.com');
check('extractDomain handles a bare host', mod.extractDomain('shop.example.co') === 'shop.example.co');
check('extractDomain is empty for garbage', mod.extractDomain('not a url') === '');

/* ── Date parsing ────────────────────────────────────────────────────── */

console.log('date parsing');
check('parses "Jan 15, 2026"', mod.parseDateToIso('Jan 15, 2026') === '2026-01-15');
check('parses "January 15, 2026"', mod.parseDateToIso('January 15, 2026') === '2026-01-15');
check('parses "15 Jan 2026"', mod.parseDateToIso('15 Jan 2026') === '2026-01-15');
check('parses an ISO date unchanged', mod.parseDateToIso('2026-01-05') === '2026-01-05');
check('rejects nonsense', mod.parseDateToIso('whenever') === null);

/* ── Ad card text parsing ────────────────────────────────────────────── */

console.log('card parsing');

const activeCardText = [
  'Sponsored',
  'Library ID: 123456789012345',
  'Started running on Jan 5, 2026',
  'Platforms',
  'Active',
  'Shop the sale before it ends. Free shipping on orders over $50.',
  'See ad details',
].join('\n');

const parsedActive = mod.parseAdCardText(activeCardText);
check('reads the library id', parsedActive.libraryId === '123456789012345');
check('reads the start date', parsedActive.startDate === '2026-01-05');
check('has no stop date', parsedActive.stopDate === null);
check('status is active', parsedActive.status === 'active');

const stoppedCardText = [
  'Library ID: 987654321098765',
  'Started running on Nov 1, 2025',
  'Stopped running on Dec 15, 2025',
  'Inactive',
  'Our best offer of the year — active for a limited time only.',
].join('\n');

const parsedStopped = mod.parseAdCardText(stoppedCardText);
check('reads the stop date', parsedStopped.stopDate === '2025-12-15');
check(
  '"Inactive" wins over a stray "active" elsewhere in the text',
  parsedStopped.status === 'stopped',
  parsedStopped.status
);

const unreadableCardText = 'Something the Library renders that this parser has never seen.';
const parsedUnreadable = mod.parseAdCardText(unreadableCardText);
check('an unrecognized card returns a null library id, not a guess', parsedUnreadable.libraryId === null);

check(
  'extractBodyText drops the chrome lines',
  mod.extractBodyText(activeCardText) === 'Shop the sale before it ends. Free shipping on orders over $50.',
  mod.extractBodyText(activeCardText)
);

check('detectFormatFromSignals: video wins', mod.detectFormatFromSignals({ hasVideo: true, imageCount: 3 }) === 'video');
check('detectFormatFromSignals: multiple images is a carousel', mod.detectFormatFromSignals({ hasVideo: false, imageCount: 3 }) === 'carousel');
check('detectFormatFromSignals: one image is an image ad', mod.detectFormatFromSignals({ hasVideo: false, imageCount: 1 }) === 'image');
check('detectFormatFromSignals: nothing readable is unknown', mod.detectFormatFromSignals({ hasVideo: false, imageCount: 0 }) === 'unknown');

/* ── Longevity ───────────────────────────────────────────────────────── */

console.log('longevity');

const now = new Date('2026-05-01T00:00:00Z');
check('days running counts to today for an active ad', mod.daysRunning('2026-01-01', null, now) === 120, mod.daysRunning('2026-01-01', null, now));
check('days running counts to the stop date once stopped', mod.daysRunning('2026-01-01', '2026-01-31', now) === 30);
check('same-day start is 0, never negative', mod.daysRunning('2026-05-01', null, now) === 0);
check('a missing start date is 0, not NaN', mod.daysRunning(null, null, now) === 0);
check(
  'a stop date before the start date still floors at 0',
  mod.daysRunning('2026-05-01', '2026-04-01', now) === 0
);

check(
  'badge text matches the PRD example shape',
  mod.formatBadge({ daysRunning: 127, variantCount: 9, status: 'active', format: 'unknown' }) ===
    '🏆 127 days running · 9 variants · still active',
  mod.formatBadge({ daysRunning: 127, variantCount: 9, status: 'active', format: 'unknown' })
);
check('badge singularizes one day / one variant', mod.formatBadge({ daysRunning: 1, variantCount: 1, status: 'stopped', format: 'video' }).startsWith('🏆 1 day running · 1 variant · stopped'));
check('isLikelyWinner respects the 90-day default', mod.isLikelyWinner({ daysRunning: 90 }) === true && mod.isLikelyWinner({ daysRunning: 89 }) === false);

/* ── Grouping ────────────────────────────────────────────────────────── */

console.log('grouping');

check('normalizeText lowercases and strips punctuation', mod.normalizeText('Shop THE Sale!! 50% off.') === 'shop the sale 50 off');
check('normalizeText collapses whitespace from reflow', mod.normalizeText('Free   shipping\n\ttoday') === 'free shipping today');
check('normalizeText handles accented (non-English) text without translating', mod.normalizeText('Café münchen') === 'café münchen');

check('identical text is fully similar', mod.textSimilarity('shop the sale', 'shop the sale') === 1);
check('disjoint text has zero similarity', mod.textSimilarity('shop the sale', 'completely unrelated words') === 0);
check('near-identical copy scores high but not perfect', mod.textSimilarity('shop the summer sale today', 'shop the winter sale today') > 0.5);

function ad(overrides) {
  return {
    libraryId: overrides.libraryId,
    advertiser: overrides.advertiser ?? 'Acme',
    bodyText: overrides.bodyText ?? '',
    landingDomain: overrides.landingDomain ?? 'acme.com',
    startDate: overrides.startDate ?? '2026-01-01',
    stopDate: overrides.stopDate ?? null,
    status: overrides.status ?? 'active',
    format: overrides.format ?? 'image',
    thumbnailUrl: null,
    libraryUrl: `https://www.facebook.com/ads/library/?id=${overrides.libraryId}`,
    region: 'United States',
  };
}

const near1 = ad({ libraryId: '1', bodyText: 'Shop the summer sale today, free shipping over $50' });
const near2 = ad({ libraryId: '2', bodyText: 'Shop the summer sale today! Free shipping over fifty dollars' });
const unrelated = ad({ libraryId: '3', bodyText: 'A completely different product with different copy entirely' });
const otherDomain = ad({ libraryId: '4', bodyText: near1.bodyText, landingDomain: 'other.com' });

const grouped = mod.groupAds([near1, near2, unrelated, otherDomain], { now });
check('similar ads on the same domain merge into one group', grouped.computed.find(a => a.libraryId === '1').variantGroupId === grouped.computed.find(a => a.libraryId === '2').variantGroupId);
check('that group reports a variant count of 2', grouped.computed.find(a => a.libraryId === '1').variantCount === 2);
check('unrelated copy on the same domain does not merge', grouped.computed.find(a => a.libraryId === '1').variantGroupId !== grouped.computed.find(a => a.libraryId === '3').variantGroupId);
check(
  'identical copy on a different landing domain never merges (PRD §5)',
  grouped.computed.find(a => a.libraryId === '1').variantGroupId !== grouped.computed.find(a => a.libraryId === '4').variantGroupId
);
check('every input ad gets a computed day count', grouped.computed.every(a => typeof a.daysRunning === 'number'));
check('not capped under the cap', grouped.capped === false);

const manyAds = Array.from({ length: 12 }, (_, i) => ad({ libraryId: `many-${i}`, bodyText: `Unique copy number ${i}` }));
const cappedResult = mod.groupAds(manyAds, { cap: 5, now });
check('enormous result sets are capped and the caller is told (PRD §7)', cappedResult.capped === true);
check('grouped count matches the cap', cappedResult.groupedCount === 5);
check('every ad still comes back, capped or not', cappedResult.computed.length === 12);
check('overflow ads still get a real day count', cappedResult.computed.find(a => a.libraryId === 'many-11').daysRunning >= 0);

/* ── Filters / sort ──────────────────────────────────────────────────── */

console.log('filters and sort');

const computedFixture = mod.groupAds(
  [
    ad({ libraryId: 'a', startDate: '2025-10-01', status: 'active', format: 'video' }),
    ad({ libraryId: 'b', startDate: '2026-04-01', status: 'stopped', stopDate: '2026-04-10', format: 'image' }),
    ad({ libraryId: 'c', startDate: '2026-01-01', status: 'active', format: 'carousel', bodyText: near1.bodyText }),
    ad({ libraryId: 'd', startDate: '2026-01-01', status: 'active', format: 'carousel', bodyText: near2.bodyText }),
  ],
  { now }
).computed;

const filtered = mod.applyFilters(computedFixture, { minDays: 60, activeOnly: false, minVariants: 0, format: 'all' });
check('minDays filters out short-running ads', filtered.every(a => a.daysRunning >= 60));

const activeOnly = mod.applyFilters(computedFixture, { minDays: 0, activeOnly: true, minVariants: 0, format: 'all' });
check('activeOnly drops stopped ads', activeOnly.every(a => a.status === 'active'));

const byVariants = mod.applyFilters(computedFixture, { minDays: 0, activeOnly: false, minVariants: 2, format: 'all' });
check('minVariants keeps only grouped ads', byVariants.every(a => a.variantCount >= 2) && byVariants.length === 2);

const byFormat = mod.applyFilters(computedFixture, { minDays: 0, activeOnly: false, minVariants: 0, format: 'video' });
check('format filter matches exactly one ad', byFormat.length === 1 && byFormat[0].libraryId === 'a');

const sortedByDays = mod.sortAds(computedFixture, 'days');
check('sort by days is descending', sortedByDays[0].daysRunning >= sortedByDays[sortedByDays.length - 1].daysRunning);

const sortedByStart = mod.sortAds(computedFixture, 'start');
check('sort by start date is ascending (oldest first)', sortedByStart[0].startDate <= sortedByStart[1].startDate);

const withMissingDate = [...computedFixture, { ...computedFixture[0], libraryId: 'no-date', startDate: null }];
const sortedWithMissing = mod.sortAds(withMissingDate, 'start');
check('an unreadable date sorts last, not first', sortedWithMissing[sortedWithMissing.length - 1].libraryId === 'no-date');

/* ── Exports ─────────────────────────────────────────────────────────── */

console.log('exports');

const csv = mod.resultsToCsv(computedFixture);
check('csv has a header row', csv.startsWith('advertiser,body_text,landing_domain'));
check('csv has one data row per ad', csv.trim().split('\r\n').length === computedFixture.length + 1);

const csvWithComma = mod.resultsToCsv([{ ...computedFixture[0], bodyText: 'Buy one, get one free' }]);
check('csv quotes a field containing a comma', csvWithComma.includes('"Buy one, get one free"'));

const md = mod.resultsToMarkdown(computedFixture, 'United States');
check('markdown carries the region', md.includes('United States'));
check('markdown includes the badge line', md.includes('days running'));
check('an empty result set says so rather than an empty document', mod.resultsToMarkdown([]).includes('No ads matched'));

const savedItems = [
  {
    id: 's1',
    savedAt: Date.parse('2026-04-01T00:00:00Z'),
    collectionId: 'c1',
    note: 'Great hook',
    advertiser: 'Acme',
    adText: 'Shop the sale, "today only"',
    landingDomain: 'acme.com',
    startDate: '2026-01-01',
    daysRunning: 90,
    variantCount: 3,
    format: 'video',
    status: 'active',
    thumbnailUrl: null,
    libraryUrl: 'https://www.facebook.com/ads/library/?id=1',
  },
  {
    id: 's2',
    savedAt: Date.parse('2026-04-02T00:00:00Z'),
    collectionId: null,
    note: '',
    advertiser: 'Beta',
    adText: 'Different offer entirely',
    landingDomain: 'beta.com',
    startDate: '2026-02-01',
    daysRunning: 60,
    variantCount: 1,
    format: 'image',
    status: 'stopped',
    thumbnailUrl: null,
    libraryUrl: 'https://www.facebook.com/ads/library/?id=2',
  },
];
const collections = [{ id: 'c1', name: 'Ecom winners', createdAt: 1 }];

const swipeCsv = mod.swipeFileToCsv(savedItems, collections);
check('swipe csv quotes an embedded quote character', swipeCsv.includes('""today only""'));
check('swipe csv resolves the collection name', swipeCsv.includes('Ecom winners'));

const swipeMd = mod.swipeFileToMarkdown(savedItems, collections);
check('swipe markdown groups by collection', swipeMd.indexOf('## Ecom winners') < swipeMd.indexOf('## Uncategorized'));
check('swipe markdown carries the note', swipeMd.includes('Great hook'));
check('an empty swipe file says so', mod.swipeFileToMarkdown([], []).includes('Nothing saved yet'));

/* ── Filenames ───────────────────────────────────────────────────────── */

console.log('filenames');
const filename = mod.buildFilename('meta-ad-winner-results', 'csv', new Date('2026-05-01T00:00:00Z'));
check('follows the {prefix}-{date}.{ext} convention', filename === 'meta-ad-winner-results-2026-05-01.csv', filename);
check('drops filesystem-hostile characters from the prefix', !/[\\/:*?"<>|]/.test(mod.buildFilename('a/b:c*d', 'md', new Date('2026-01-01'))));

fs.rmSync(entry, { force: true });
fs.rmSync(bundlePath, { force: true });

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
