/**
 * Headless checks for the pure logic: listing-URL matching, title/price
 * analysis, the schema.org JSON-LD parser, the text-pattern fallback
 * parsers, tag recurrence (with its sample floor), the compare table's
 * diff-highlighting, and both export formats plus the saved-teardown diff.
 *
 * The DOM-bound half (src/extract.ts, src/content.ts) needs a real Etsy page
 * and is covered by the manual checklist in the README — see PRD §5's
 * half-day spike, which is required before shipping regardless of what this
 * script proves.
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

const entry = path.join(os.tmpdir(), `ela-selftest-${process.pid}.mjs`);
fs.writeFileSync(
  entry,
  ['url.ts', 'analysis.ts', 'formatters.ts']
    .map(file => `export * from ${JSON.stringify(path.join(rootDir, 'src', file).replace(/\\/g, '/'))};`)
    .join('\n')
);

const bundlePath = path.join(os.tmpdir(), `ela-selftest-bundle-${process.pid}.mjs`);
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

/* ── Listing URLs ────────────────────────────────────────────────────── */

console.log('urls');
check('matches a plain listing url', mod.listingIdFromUrl('https://www.etsy.com/listing/123456789/hand-thrown-mug') === '123456789');
check(
  'matches a locale-prefixed listing url',
  mod.listingIdFromUrl('https://www.etsy.com/uk/listing/987654321/ceramic-vase') === '987654321'
);
check(
  'matches with query params and a referral suffix',
  mod.listingIdFromUrl('https://www.etsy.com/listing/555/x?ref=shop_home_active_1&click_key=abc') === '555'
);
check('rejects the shop homepage', mod.listingIdFromUrl('https://www.etsy.com/shop/SomeShop') === null);
check('rejects a non-Etsy host', mod.listingIdFromUrl('https://www.not-etsy.com/listing/123/x') === null);
check('rejects garbage input', mod.listingIdFromUrl('not a url') === null);
check('isListingUrl agrees with listingIdFromUrl', mod.isListingUrl('https://www.etsy.com/listing/1/x') === true);

/* ── Title analysis ──────────────────────────────────────────────────── */

console.log('title analysis');
const title = mod.analyzeTitle('Hand Thrown Ceramic Mug Personalized Gift for Coffee Lovers');
check('counts words', title.wordCount === 9, title.wordCount);
check('counts characters', title.charCount === 'Hand Thrown Ceramic Mug Personalized Gift for Coffee Lovers'.length);
check('front-loaded is null with no tag to check against', title.frontLoaded === null);

const frontLoaded = mod.analyzeTitle('Hand Thrown Ceramic Mug for Coffee', 'ceramic mug');
check('detects a front-loaded title', frontLoaded.frontLoaded === true);

const notFrontLoaded = mod.analyzeTitle('Handmade Gift for Coffee Lovers featuring a Ceramic Mug', 'ceramic mug');
check('detects a title that is not front-loaded', notFrontLoaded.frontLoaded === false);

const emptyTitle = mod.analyzeTitle('');
check('an empty title never throws', emptyTitle.wordCount === 0 && emptyTitle.charCount === 0);

/* ── Price ───────────────────────────────────────────────────────────── */

console.log('price');
check('formats GBP with a symbol', mod.formatMoney(24, 'GBP') === '£24.00');
check('falls back to the ISO code for an unmapped currency', mod.currencyLabel('SEK') === 'SEK ');
check('a null price prints an em dash', mod.formatPriceRange({ currency: 'USD', min: null, max: null, isRange: false }) === '—');
check(
  'a single price has no dash',
  mod.formatPriceRange({ currency: 'USD', min: 24, max: 24, isRange: false }) === '$24.00'
);
check(
  'a variation range shows both ends, never a single averaged number',
  mod.formatPriceRange({ currency: 'GBP', min: 18, max: 26, isRange: true }) === '£18.00–£26.00'
);

/* ── JSON-LD Product parsing ─────────────────────────────────────────── */

console.log('json-ld');

const singleOfferLd = {
  '@type': 'Product',
  name: 'Hand Thrown Ceramic Mug',
  image: ['a.jpg', 'b.jpg', 'c.jpg'],
  offers: { '@type': 'Offer', price: '24.00', priceCurrency: 'GBP', availability: 'https://schema.org/InStock' },
  aggregateRating: { ratingValue: '4.9', reviewCount: '312' },
  brand: { name: 'CoolCeramicsCo' },
};
const singleParsed = mod.parseProductLd(singleOfferLd);
check('reads the title', singleParsed.title === 'Hand Thrown Ceramic Mug');
check('counts photos from the image array', singleParsed.photoCount === 3);
check('reads a plain Offer price', singleParsed.priceMin === 24 && singleParsed.priceMax === 24);
check('reads availability as in-stock', singleParsed.soldOut === false);
check('reads rating and review count', singleParsed.rating === 4.9 && singleParsed.reviewCount === 312);
check('reads the shop name from a brand object', singleParsed.shopName === 'CoolCeramicsCo');

const aggregateOfferLd = {
  '@type': 'Product',
  name: 'Variable Priced Mug',
  offers: { '@type': 'AggregateOffer', lowPrice: 18, highPrice: 26, priceCurrency: 'USD', availability: 'https://schema.org/OutOfStock' },
  brand: 'StringBrand',
};
const aggParsed = mod.parseProductLd(aggregateOfferLd);
check('reads an AggregateOffer as a range', aggParsed.priceMin === 18 && aggParsed.priceMax === 26);
check('reads out-of-stock availability', aggParsed.soldOut === true);
check('reads the shop name when brand is a plain string', aggParsed.shopName === 'StringBrand');

check('a graph without a Product node returns an empty result', mod.parseProductLd({ '@graph': [{ '@type': 'BreadcrumbList' }] }).title === null);
check('non-object input never throws', mod.parseProductLd(null).title === null);
check('a single image (not an array) still counts as one photo', mod.parseProductLd({ '@type': 'Product', name: 'x', image: 'only.jpg' }).photoCount === 1);

/* ── Text-pattern fallbacks ──────────────────────────────────────────── */

console.log('text patterns');
check('finds an established year', mod.findEstablishedYear('CoolCeramicsCo · Est. 2019 · Leeds, UK') === 2019);
check('ignores an out-of-range year', mod.findEstablishedYear('Est. 1800') === null);
check('finds shop total sales', mod.findShopTotalSales('4,800 Sales') === 4800);
check('finds listing purchases from "bought this"', mod.findListingPurchases('1,240 people bought this') === 1240);
check('finds listing purchases from "sold"', mod.findListingPurchases('50+ sold') === 50);
check('finds a shop location', mod.findShopLocation('Ships from United Kingdom') === 'United Kingdom');
check('detects free shipping', mod.detectFreeShipping('Free shipping to United States') === true);
check('does not false-positive on paid shipping', mod.detectFreeShipping('Shipping: $4.50') === false);
check('detects a digital download', mod.detectDigital('This is a digital download — no physical item will be shipped') === true);
check('detects personalization copy', mod.detectPersonalization('Add your personalization') === true);
check('sold-out text alone is enough without ld data', mod.detectSoldOut('Sorry, this item is unavailable.', null) === true);
check('ld availability forces sold-out even without matching text', mod.detectSoldOut('In stock and ready to ship', true) === true);
check('detects a deactivated listing', mod.detectDeactivated('This listing has been removed by Etsy or the shop owner.') === true);
check('parses a keywords meta tag into tags', mod.parseKeywordsMeta('ceramic mug, coffee gift, handmade pottery').length === 3);

/* ── Tag recurrence (PRD §10 floor) ──────────────────────────────────── */

console.log('tag recurrence');

const belowFloor = [
  { listingId: '1', tags: ['ceramic mug', 'coffee gift'] },
  { listingId: '2', tags: ['ceramic mug'] },
  { listingId: '3', tags: ['pottery'] },
];
check('below the 4-listing floor, recurrence is null (not a misleading 1-of-3)', mod.tagRecurrence(belowFloor) === null);

const atFloor = [
  { listingId: '1', tags: ['ceramic mug', 'personalized gift'] },
  { listingId: '2', tags: ['ceramic mug', 'coffee gift'] },
  { listingId: '3', tags: ['ceramic mug', 'personalized gift'] },
  { listingId: '4', tags: ['pottery'] },
];
const recurrence = mod.tagRecurrence(atFloor);
check('at the floor, recurrence is computed', recurrence !== null);
check('the most common tag is first', recurrence[0].tag === 'ceramic mug' && recurrence[0].count === 3);
check('a tag used by only one listing is excluded', !recurrence.some(r => r.tag === 'pottery'));

const caseInsensitive = mod.tagRecurrence([
  { listingId: '1', tags: ['Ceramic Mug', 'ceramic mug'] }, // duplicate within one listing must count once
  { listingId: '2', tags: ['ceramic mug'] },
  { listingId: '3', tags: ['ceramic mug'] },
  { listingId: '4', tags: [] },
]);
check('a duplicate tag within one listing counts once', caseInsensitive.find(r => r.tag === 'ceramic mug').count === 3);

/* ── Compare table ───────────────────────────────────────────────────── */

console.log('compare table');

function makeTeardown(overrides = {}) {
  return {
    listingId: overrides.listingId ?? '1',
    url: `https://www.etsy.com/listing/${overrides.listingId ?? '1'}/x`,
    capturedAt: overrides.capturedAt ?? Date.parse('2026-08-01'),
    title: { text: 'Ceramic Mug', wordCount: 2, charCount: 11, frontLoaded: true, ...overrides.title },
    tags: { count: 10, max: 13, tags: ['ceramic mug', 'coffee gift'], ...overrides.tags },
    photos: { count: 8, hasVideo: true, ...overrides.photos },
    price: { currency: 'GBP', min: 24, max: 24, isRange: false, freeShipping: true, isDigital: false, ...overrides.price },
    options: { variationCount: 3, hasPersonalization: true, ...overrides.options },
    sales: { purchases: 1240, rating: 4.9, reviewCount: 312, ...overrides.sales },
    shop: { name: 'CoolCeramicsCo', establishedYear: 2019, totalSales: 4800, location: 'UK', ...overrides.shop },
    status: { soldOut: false, deactivated: false, ...overrides.status },
    unavailable: overrides.unavailable ?? [],
  };
}

const entryA = makeTeardown({ listingId: '1' });
const entryB = makeTeardown({ listingId: '2', price: { currency: 'GBP', min: 30, max: 30, isRange: false, freeShipping: false, isDigital: false } });
const rows = mod.buildCompareRows([entryA, entryB]);
const priceRow = rows.find(r => r.key === 'price');
check('a differing field is flagged', priceRow.differs === true);
check('the shop row does not differ when both listings share a shop', rows.find(r => r.key === 'shopName').differs === false);
check('price values are formatted with currency symbols', priceRow.values[0] === '£24.00' && priceRow.values[1] === '£30.00');

/* ── CSV export ──────────────────────────────────────────────────────── */

console.log('csv');
const csv = mod.buildCsv([entryA, entryB]);
check('csv has a header row naming each listing', csv.startsWith('Field,Listing 1,Listing 2'));
check('csv includes a url row', csv.includes(entryA.url));
check('csv includes a tags row', csv.includes('ceramic mug'));
check('an empty tray exports without throwing', mod.buildCsv([]).includes('No listings'));

const commaTeardown = makeTeardown({ listingId: '3', title: { text: 'Mug, "Best Gift"', wordCount: 3, charCount: 16, frontLoaded: null } });
const quotedCsv = mod.buildCsv([commaTeardown]);
check('a title with a comma and quotes is CSV-escaped', quotedCsv.includes('"Mug, ""Best Gift"""'));

/* ── Markdown audit ──────────────────────────────────────────────────── */

console.log('markdown audit');

const singleMd = mod.buildMarkdownAudit([entryA]);
check('opens with the audit heading', singleMd.startsWith('# Etsy Listing Audit'));
check('includes the title line with word/char counts', singleMd.includes('2 words · 11 chars'));
check('includes the tag list', singleMd.includes('ceramic mug, coffee gift'));
check('includes the source link', singleMd.includes(`[Source](${entryA.url})`));
check('a single listing has no comparison table', !singleMd.includes('## Comparison'));

const multiMd = mod.buildMarkdownAudit([entryA, entryB]);
check('multiple listings get a comparison table', multiMd.includes('## Comparison'));
check('a differing row is bolded in the comparison table', multiMd.includes('**Price**'));
check('below the recurrence floor, the audit says why nothing shows', multiMd.includes('Compare at least 4 listings'));

const fourEntries = [entryA, entryB, makeTeardown({ listingId: '3' }), makeTeardown({ listingId: '4' })];
const fourMd = mod.buildMarkdownAudit(fourEntries);
check('at the floor, the audit lists recurring tags', fourMd.includes('## Tag recurrence') && fourMd.includes('ceramic mug'));

const notedMd = mod.buildMarkdownAudit([entryA], { notes: { [entryA.listingId]: 'Beats mine on photo count.' } });
check('a note is included when supplied', notedMd.includes('Beats mine on photo count.'));

const soldOutMd = mod.buildMarkdownAudit([makeTeardown({ listingId: '5', status: { soldOut: true, deactivated: false } })]);
check('a sold-out listing is flagged in the audit', soldOutMd.includes('Sold out'));

const deactivatedMd = mod.buildMarkdownAudit([makeTeardown({ listingId: '6', status: { soldOut: false, deactivated: true } })]);
check('a deactivated listing is flagged in the audit', deactivatedMd.includes('removed or deactivated'));

const noTagsMd = mod.buildMarkdownAudit([makeTeardown({ listingId: '7', tags: { count: 0, max: 13, tags: [] } })]);
check('a listing with no tags shown still exports cleanly', noTagsMd.includes('0 of 13 used'));

const digitalMd = mod.buildMarkdownAudit([makeTeardown({ listingId: '8', price: { currency: 'USD', min: 5, max: 5, isRange: false, freeShipping: false, isDigital: true } })]);
check('a digital download is labelled instead of showing a false shipping value', digitalMd.includes('digital download (no shipping)'));
check('a digital download does not print a free-shipping mark', !digitalMd.includes('free shipping ✓') && !digitalMd.includes('free shipping ✗'));

const emptyMd = mod.buildMarkdownAudit([]);
check('an empty audit exports without throwing', emptyMd.includes('No listings captured yet'));

/* ── Saved-teardown diff ─────────────────────────────────────────────── */

console.log('saved diff');

const savedOne = { listingId: '1', note: '', snapshots: [entryA], updatedAt: Date.now() };
check('a single snapshot has nothing to diff yet', mod.diffSnapshots(savedOne) === null);

const later = makeTeardown({
  listingId: '1',
  capturedAt: Date.parse('2026-08-15'),
  price: { currency: 'GBP', min: 28, max: 28, isRange: false, freeShipping: true, isDigital: false },
  tags: { count: 11, max: 13, tags: ['ceramic mug', 'coffee gift', 'personalized gift'] },
  sales: { purchases: 1500, rating: 4.9, reviewCount: 340 },
});
const savedTwo = { listingId: '1', note: 'Watching this one', snapshots: [entryA, later], updatedAt: Date.now() };
const diff = mod.diffSnapshots(savedTwo);
check('detects a price change', diff.priceChanged === true && diff.priceFrom === '£24.00' && diff.priceTo === '£28.00');
check('detects a sales/review change', diff.salesChanged === true);
check('detects an added tag', diff.tagsAdded.includes('personalized gift'));
check('does not report a removed tag that is still present', !diff.tagsRemoved.includes('ceramic mug'));

/* ── Filenames ───────────────────────────────────────────────────────── */

console.log('filenames');
check('builds a clean .csv filename', mod.buildFilename('Etsy Compare', 'csv') === 'Etsy Compare.csv');
check('strips filesystem-hostile characters', !/[\\/:*?"<>|]/.test(mod.buildFilename('a/b:c*d?', 'md')));
const longName = mod.buildFilename('x'.repeat(400), 'md');
check('truncates to 120 characters', longName.length <= 120, `${longName.length} chars`);
check('keeps the extension after truncation', longName.endsWith('.md'));
check('falls back to a default name when the base is empty', mod.buildFilename('   ', 'csv') === 'etsy-listing.csv');

fs.rmSync(entry, { force: true });
fs.rmSync(bundlePath, { force: true });

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
