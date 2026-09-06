/**
 * Headless checks for the pure logic: locale parsing, the category-read
 * calculation (median/moat/ceiling/concentration), filters, watch deltas,
 * exports and filenames. Everything here is DOM-free by design (see the
 * comment at the top of src/stats.ts), which is what makes it testable
 * without a browser.
 *
 * Also enforces PRD §5's legal posture in code: no network API call may
 * exist anywhere in src/.
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

/* ── PRD §5's gate, enforced in code: no network API anywhere in src/ ──── */

console.log('legal posture (PRD §5)');
const NETWORK_PATTERNS = [/fetch\s*\(/, /XMLHttpRequest\s*\(/, /\.sendBeacon\s*\(/, /new\s+WebSocket\s*\(/];
const srcFiles = fs.readdirSync(path.join(rootDir, 'src')).filter(f => f.endsWith('.ts'));
let networkHit = null;
for (const file of srcFiles) {
  const text = fs.readFileSync(path.join(rootDir, 'src', file), 'utf8');
  for (const pattern of NETWORK_PATTERNS) {
    if (pattern.test(text)) networkHit = `${file} matches ${pattern}`;
  }
}
check('no fetch/XHR/sendBeacon/WebSocket call anywhere in src/', networkHit === null, networkHit);

/* ── Bundle the pure modules for headless import ────────────────────── */

const entry = path.join(os.tmpdir(), `apo-selftest-${process.pid}.mjs`);
fs.writeFileSync(
  entry,
  ['parsing.ts', 'stats.ts', 'filters.ts', 'exporters.ts', 'deltas.ts']
    .map(file => `export * from ${JSON.stringify(path.join(rootDir, 'src', file).replace(/\\/g, '/'))};`)
    .join('\n')
);

const bundlePath = path.join(os.tmpdir(), `apo-selftest-bundle-${process.pid}.mjs`);
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

/* ── Price parsing ───────────────────────────────────────────────────── */

console.log('parsing: price');
check('US dollars', mod.parsePriceText('$19.99').value === 19.99);
check('US dollars keeps the symbol', mod.parsePriceText('$19.99').currency === '$');
check('British pounds', mod.parsePriceText('£19.99').value === 19.99);
check('euro, comma decimal', mod.parsePriceText('19,99 €').value === 19.99);
check('euro, dot thousands + comma decimal', mod.parsePriceText('1.234,56 €').value === 1234.56);
check('dollars, comma thousands + dot decimal', mod.parsePriceText('$1,234.56').value === 1234.56);
check('dollars, comma thousands, no decimal', mod.parsePriceText('$1,234').value === 1234);
check('a price range reads the low end', mod.parsePriceText('$19.99 - $29.99').value === 19.99);
check('empty string yields null', mod.parsePriceText('').value === null);
check('null input does not throw', mod.parsePriceText(null).value === null);
check('garbage text yields null', mod.parsePriceText('Currently unavailable').value === null);

/* ── Rating parsing ──────────────────────────────────────────────────── */

console.log('parsing: rating');
check('English aria-label', mod.parseRatingText('4.5 out of 5 stars') === 4.5);
check('German aria-label', mod.parseRatingText('4,5 von 5 Sternen') === 4.5);
check('French aria-label', mod.parseRatingText('4.5 sur 5 étoiles') === 4.5);
check('bare leading number', mod.parseRatingText('4.2') === 4.2);
check('out-of-range value is rejected', mod.parseRatingText('6 out of 5 stars') === null);
check('empty string yields null', mod.parseRatingText('') === null);
check('non-numeric text yields null', mod.parseRatingText('New arrival') === null);

/* ── Review count parsing ────────────────────────────────────────────── */

console.log('parsing: review count');
check('comma thousands', mod.parseCountText('1,234 ratings') === 1234);
check('dot thousands (German)', mod.parseCountText('1.234 Bewertungen') === 1234);
check('bare number', mod.parseCountText('12') === 12);
check('empty string yields null', mod.parseCountText('') === null);
check('no digits yields null', mod.parseCountText('No ratings yet') === null);

/* ── Brand parsing ───────────────────────────────────────────────────── */

console.log('parsing: brand');
check('"by X"', mod.parseBrandText('by Acme') === 'Acme');
check('"Brand: X"', mod.parseBrandText('Brand: Acme') === 'Acme');
check('"Visit the X Store"', mod.parseBrandText('Visit the Acme Store') === 'Acme');
check('unrecognised text yields null', mod.parseBrandText('Acme Widget Pro') === null);
check('empty string yields null', mod.parseBrandText('') === null);

/* ── Category stats (the opportunity read) ──────────────────────────── */

console.log('stats: category read');

function listing(overrides) {
  return {
    asin: 'ASIN0',
    position: 0,
    title: 'A listing',
    brand: null,
    price: null,
    priceRaw: null,
    currency: null,
    rating: null,
    reviewCount: null,
    prime: null,
    sponsored: false,
    url: null,
    ...overrides,
  };
}

const basic = [
  listing({ asin: 'A1', brand: 'Acme', reviewCount: 100, rating: 4.5 }),
  listing({ asin: 'A2', brand: 'Acme', reviewCount: 300, rating: 4.0 }),
  listing({ asin: 'A3', brand: 'Zenith', reviewCount: 500, rating: 4.2 }),
  listing({ asin: 'A3', brand: 'Zenith', reviewCount: 999999, rating: 1 }), // duplicate ASIN — a variation, counted once
  listing({ asin: 'SP1', brand: 'Sponsor Co', reviewCount: 1, rating: 5, sponsored: true }),
];

const basicStats = mod.computeCategoryStats(basic);
check('sponsored listings excluded from the count', basicStats.totalListings === 3, basicStats.totalListings);
check('sponsored count reported separately', basicStats.sponsoredExcluded === 1);
check('duplicate ASIN (a variation) counted once', basicStats.totalListings === 3);
check('median reviews computed on organic listings only', basicStats.medianReviews === 300, basicStats.medianReviews);
check('median rating computed correctly', Math.abs(basicStats.medianRating - 4.2) < 1e-9, basicStats.medianRating);
check('distinct brands counted case-insensitively', basicStats.distinctBrands === 2);

check('moat: light under 150 median reviews', mod.computeCategoryStats([
  listing({ asin: 'L1', reviewCount: 50, rating: 4 }),
  listing({ asin: 'L2', reviewCount: 60, rating: 4 }),
]).moat === 'light');

check('moat: moderate between 150 and 1500', mod.computeCategoryStats([
  listing({ asin: 'M1', reviewCount: 380, rating: 4 }),
  listing({ asin: 'M2', reviewCount: 400, rating: 4 }),
]).moat === 'moderate');

check('moat: strong at or above 1500 median reviews', mod.computeCategoryStats([
  listing({ asin: 'S1', reviewCount: 20000, rating: 4 }),
  listing({ asin: 'S2', reviewCount: 18000, rating: 4 }),
]).moat === 'strong');

check('moat: unknown with no readable review counts', mod.computeCategoryStats([
  listing({ asin: 'U1', reviewCount: null }),
]).moat === 'unknown');

const tenListings = Array.from({ length: 10 }, (_, i) =>
  listing({ asin: `T${i}`, reviewCount: 100, rating: i < 3 ? 3.9 : 4.6 })
);
const ceiling = mod.computeCategoryStats(tenListings).ratingCeiling;
check('rating ceiling counts listings under the threshold', ceiling.underThreshold === 3, ceiling.underThreshold);
check('rating ceiling samples the top 10', ceiling.sample === 10);
check('3 of 10 under 4.3 reads as "soft"', ceiling.label === 'soft');

const noGap = Array.from({ length: 10 }, (_, i) => listing({ asin: `N${i}`, rating: 4.8 }));
check('no listings under the threshold reads as "strong"', mod.computeCategoryStats(noGap).ratingCeiling.label === 'strong');

const concentrated = [
  listing({ asin: 'C1', brand: 'BigCo' }),
  listing({ asin: 'C2', brand: 'BigCo' }),
  listing({ asin: 'C3', brand: 'BigCo' }),
  listing({ asin: 'C4', brand: 'Indie' }),
  listing({ asin: 'C5', brand: 'Other' }),
];
const concStats = mod.computeCategoryStats(concentrated);
check('top brand identified', concStats.concentration.topBrand === 'BigCo');
check('top brand share computed', Math.abs(concStats.concentration.topBrandShare - 0.6) < 1e-9);
check('60% by one brand reads as "concentrated"', concStats.concentration.label === 'concentrated');

const fragmented = ['A', 'B', 'C', 'D', 'E', 'F'].map((brand, i) => listing({ asin: `F${i}`, brand }));
check('six distinct single-listing brands reads as "fragmented"', mod.computeCategoryStats(fragmented).concentration.label === 'fragmented');

check('unreadable brands are counted, not silently dropped', mod.computeCategoryStats([
  listing({ asin: 'B1', brand: null }),
  listing({ asin: 'B2', brand: 'Acme' }),
]).brandUnknown === 1);

check('median() of an empty list is null', mod.median([]) === null);
check('median() of an even-length list averages the middle two', mod.median([1, 2, 3, 4]) === 2.5);

/* ── Filters ─────────────────────────────────────────────────────────── */

console.log('filters');

const filterListings = [
  listing({ asin: 'X1', reviewCount: 50, rating: 3.8, price: 15, brand: 'Acme' }),
  listing({ asin: 'X2', reviewCount: 5000, rating: 4.8, price: 45, brand: 'Zenith' }),
  listing({ asin: 'X3', reviewCount: 120, rating: 4.0, price: 25, brand: 'Acme Labs' }),
];

check('empty filters match everything', mod.isEmptyFilter(mod.EMPTY_FILTERS ?? { maxReviews: null, minRatingGap: null, priceMin: null, priceMax: null, brand: null }));

const maxReviewsFilter = { maxReviews: 200, minRatingGap: null, priceMin: null, priceMax: null, brand: null };
const maxReviewsResult = mod.applyFilters(filterListings, maxReviewsFilter);
check('maxReviews filters out high-review listings', maxReviewsResult.find(r => r.listing.asin === 'X2').matches === false);
check('maxReviews keeps low-review listings', maxReviewsResult.find(r => r.listing.asin === 'X1').matches === true);

const ratingGapFilter = { maxReviews: null, minRatingGap: 4.0, priceMin: null, priceMax: null, brand: null };
const ratingGapResult = mod.applyFilters(filterListings, ratingGapFilter);
check('minRatingGap keeps only listings below the value', ratingGapResult.find(r => r.listing.asin === 'X1').matches === true);
check('minRatingGap excludes listings at or above the value', ratingGapResult.find(r => r.listing.asin === 'X3').matches === false);

const priceFilter = { maxReviews: null, minRatingGap: null, priceMin: 20, priceMax: 30, brand: null };
const priceResult = mod.applyFilters(filterListings, priceFilter);
check('price band excludes below the minimum', priceResult.find(r => r.listing.asin === 'X1').matches === false);
check('price band excludes above the maximum', priceResult.find(r => r.listing.asin === 'X2').matches === false);
check('price band keeps listings inside the range', priceResult.find(r => r.listing.asin === 'X3').matches === true);

const brandFilter = { maxReviews: null, minRatingGap: null, priceMin: null, priceMax: null, brand: 'acme' };
const brandResult = mod.applyFilters(filterListings, brandFilter);
check('brand filter is case-insensitive and matches substrings', brandResult.find(r => r.listing.asin === 'X3').matches === true);
check('brand filter excludes non-matching brands', brandResult.find(r => r.listing.asin === 'X2').matches === false);

const opportunityFilter = { maxReviews: 100, minRatingGap: 4.0, priceMin: null, priceMax: null, brand: null };
const opportunityResult = mod.applyFilters(filterListings, opportunityFilter);
check(
  'a listing under both the review ceiling and the rating floor is flagged as an opportunity',
  opportunityResult.find(r => r.listing.asin === 'X1').opportunity === true
);
check(
  'opportunity requires both signals, not just one',
  opportunityResult.find(r => r.listing.asin === 'X3').opportunity === false
);
check(
  'opportunity flag is never set without both filters configured',
  mod.applyFilters(filterListings, { maxReviews: 100, minRatingGap: null, priceMin: null, priceMax: null, brand: null }).every(r => !r.opportunity)
);

/* ── Exports ─────────────────────────────────────────────────────────── */

console.log('exports: results');

const snapshot = {
  marketplace: 'amazon.com',
  query: 'water bottle',
  canonicalKey: 'amazon.com::water bottle',
  capturedAt: '2026-08-15T12:00:00.000Z',
  page: 1,
  url: 'https://www.amazon.com/s?k=water+bottle',
  listings: [
    listing({ asin: 'A1', title: 'Steel bottle, 32oz', brand: 'Acme', price: 19.99, priceRaw: '$19.99', currency: '$', rating: 4.5, reviewCount: 1200, prime: true, url: 'https://www.amazon.com/dp/A1' }),
    listing({ asin: 'A2', title: 'Contains, "quotes", and a comma', brand: null, reviewCount: 40, rating: 3.9, sponsored: true }),
  ],
};
const stats = mod.computeCategoryStats(snapshot.listings);

const csv = mod.buildResultsCsv(snapshot);
check('CSV starts with the header row', csv.startsWith('position,asin,title,brand,'));
check('CSV quotes a title containing a comma', csv.includes('"Contains, ""quotes"", and a comma"'));
check('CSV has one row per listing plus the header', csv.trim().split('\r\n').length === 3, csv.trim().split('\r\n').length);

const md = mod.buildResultsMarkdown(snapshot, stats);
check('Markdown carries the category read line', md.includes('Category read:'));
check('Markdown carries the moat/ceiling/concentration line', md.includes('Moat:') && md.includes('Rating ceiling:'));
check('Markdown table lists every listing', md.includes('Steel bottle, 32oz') && md.includes('quotes'));
check('Markdown escapes table-breaking pipes', !mod.buildResultsMarkdown({ ...snapshot, listings: [listing({ asin: 'P1', title: 'A | B' })] }, stats).match(/\| A \| B \|/));

console.log('exports: watchlist');

const searchWatches = [
  {
    key: 'amazon.com::water bottle',
    marketplace: 'amazon.com',
    query: 'water bottle',
    url: snapshot.url,
    createdAt: '2026-08-01T00:00:00.000Z',
    snapshots: [
      { capturedAt: '2026-08-01T00:00:00.000Z', resultCount: 40, medianReviews: 240, medianRating: 4.1, distinctBrands: 9 },
      { capturedAt: '2026-08-15T00:00:00.000Z', resultCount: 42, medianReviews: 380, medianRating: 4.2, distinctBrands: 11 },
    ],
  },
];
const productWatches = [
  {
    asin: 'A1',
    marketplace: 'amazon.com',
    title: 'Steel bottle, 32oz',
    url: 'https://www.amazon.com/dp/A1',
    createdAt: '2026-08-01T00:00:00.000Z',
    snapshots: [
      { capturedAt: '2026-08-01T00:00:00.000Z', price: 21.99, rating: 4.4, reviewCount: 1000, prime: true },
      { capturedAt: '2026-08-15T00:00:00.000Z', price: 19.99, rating: 4.5, reviewCount: 1200, prime: true },
    ],
  },
];

const watchCsv = mod.buildWatchlistCsv(searchWatches, productWatches);
check('watchlist CSV includes a row per snapshot', watchCsv.trim().split('\r\n').length === 5, watchCsv);
check('watchlist CSV tags rows by type', watchCsv.includes('search,') && watchCsv.includes('product,'));

const watchMd = mod.buildWatchlistMarkdown(searchWatches, productWatches);
check('watchlist Markdown sections both kinds', watchMd.includes('Watched searches') && watchMd.includes('Watched products'));
check('empty watchlist exports without throwing', mod.buildWatchlistMarkdown([], []).includes('Nothing watched yet'));

console.log('exports: filenames');

const filename = mod.buildFilename(['amazon-opportunity', 'amazon.com', 'water bottle'], 'csv');
check('joins parts with " - "', filename === 'amazon-opportunity - amazon.com - water bottle.csv', filename);
check('drops filesystem-hostile characters', !/[\\/:*?"<>|]/.test(mod.buildFilename(['a/b:c*d'], 'csv')));
const longName = mod.buildFilename(['x'.repeat(400)], 'md');
check('truncates to 120 characters', longName.length <= 120, longName.length);
check('keeps the extension after truncation', longName.endsWith('.md'));

/* ── Watch deltas ────────────────────────────────────────────────────── */

console.log('deltas');

const searchDelta = mod.describeSearchSnapshotDelta(searchWatches[0].snapshots[0], searchWatches[0].snapshots[1]);
check('search delta reports the review increase', searchDelta.includes('+140 median reviews'), searchDelta);
check('search delta reports the result-count increase', searchDelta.includes('+2 results'), searchDelta);
check('search delta names the earlier date', searchDelta.includes('since'));

const productDelta = mod.describeProductSnapshotDelta(productWatches[0].snapshots[0], productWatches[0].snapshots[1]);
check('product delta reports the review increase', productDelta.includes('+200 reviews'), productDelta);
check('product delta reports the price drop', productDelta.includes('-2 price'), productDelta);

const flatDelta = mod.describeSearchSnapshotDelta(
  { capturedAt: '2026-08-01T00:00:00.000Z', resultCount: 10, medianReviews: 100, medianRating: 4.2, distinctBrands: 5 },
  { capturedAt: '2026-08-15T00:00:00.000Z', resultCount: 10, medianReviews: 100, medianRating: 4.2, distinctBrands: 5 }
);
check('no movement reads as "No change"', flatDelta.startsWith('No change since'), flatDelta);

fs.rmSync(entry, { force: true });
fs.rmSync(bundlePath, { force: true });

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
