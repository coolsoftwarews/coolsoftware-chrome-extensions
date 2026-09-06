/**
 * Headless checks for the pure logic: URL/query-key normalization, the niche
 * scoring engine (medians, concentration, the sales-vs-reviews split, filters,
 * snapshot deltas), the tag aggregator, and both export formats.
 *
 * This is the module where getting it wrong is worse than not shipping — see
 * stats.ts's header comment — so it carries the bulk of the coverage. The
 * DOM-bound half (extract.ts, content.ts's strip/badges) needs a real Etsy
 * page and is covered by the manual QA checklist in README.md instead, same
 * discipline WebHighlighter documents for its own DOM-bound modules.
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

const entry = path.join(os.tmpdir(), `enf-selftest-${process.pid}.mjs`);
fs.writeFileSync(
  entry,
  ['url.ts', 'stats.ts', 'formatters.ts']
    .map(file => `export * from ${JSON.stringify(path.join(rootDir, 'src', file).replace(/\\/g, '/'))};`)
    .join('\n')
);

const bundlePath = path.join(os.tmpdir(), `enf-selftest-bundle-${process.pid}.mjs`);
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

/* ── URL / query-key normalization ──────────────────────────────────── */

console.log('url');

const s1 = mod.parseEtsyUrl('https://www.etsy.com/search?q=leather+wallet&page=2');
check('search page is detected', s1.kind === 'search');
check('query text decodes "+" as a space', s1.query === 'leather wallet', s1.query);
check('page number is read', s1.page === 2);
check('query key ignores the page number', s1.queryKey === 'search:leather wallet', s1.queryKey);

const s2 = mod.parseEtsyUrl('https://www.etsy.com/search?q=Leather+Wallet&page=7');
check('page 1 and page 7 of the same search share a query key', s1.queryKey === s2.queryKey, `${s1.queryKey} vs ${s2.queryKey}`);

const s3 = mod.parseEtsyUrl('https://www.etsy.com/search?q=leather+wallet&color_id=8');
check('a real facet param changes the query key', s3.queryKey !== s1.queryKey);

const s4 = mod.parseEtsyUrl('https://www.etsy.com/search?q=');
check('an empty query is not a supported page', s4.kind === null);

const c1 = mod.parseEtsyUrl('https://www.etsy.com/c/jewelry/necklaces');
check('category page is detected', c1.kind === 'category');
check('category label is readable', c1.query === 'jewelry › necklaces', c1.query);
check('category query key is path-based', c1.queryKey === 'category:/c/jewelry/necklaces', c1.queryKey);

const l1 = mod.parseEtsyUrl('https://www.etsy.com/listing/12345/handmade-mug');
check('a single listing page is not a results page', l1.kind === null);

const g1 = mod.parseEtsyUrl('https://www.google.com/search?q=leather+wallet');
check('a non-Etsy host is never treated as a results page', g1.kind === null);

/* ── Basic statistics ───────────────────────────────────────────────── */

console.log('stats: median / percentile');

check('median of an empty array is null', mod.median([]) === null);
check('median of an odd-length array', mod.median([5, 1, 3]) === 3);
check('median of an even-length array averages the middle two', mod.median([1, 2, 3, 4]) === 2.5);
check('percentile of a single value is that value', mod.percentile([42], 90) === 42);

/* ── computeStats ────────────────────────────────────────────────────── */

console.log('stats: computeStats');

function listing(overrides) {
  return {
    id: Math.random().toString(36).slice(2),
    title: 'Listing',
    url: 'https://www.etsy.com/listing/1',
    price: null,
    currency: '$',
    priceIsRange: false,
    shopName: '',
    isAd: false,
    countKind: null,
    count: null,
    isDigital: false,
    page: 1,
    ...overrides,
  };
}

const dataset = [
  listing({ shopName: 'Alpha', countKind: 'sales', count: 120, price: 20, currency: '$' }),
  listing({ shopName: 'Alpha', countKind: 'sales', count: 80, price: 25, currency: '$' }),
  listing({ shopName: 'Beta', countKind: 'sales', count: 300, price: 15, currency: '$' }),
  listing({ shopName: 'Gamma', countKind: 'sales', count: 0, price: 10, currency: '$' }),
  listing({ shopName: 'Delta', countKind: 'reviews', count: 45, price: 35, currency: '$' }),
  listing({ shopName: 'Delta', countKind: 'reviews', count: 12, price: 40, currency: '£' }),
  listing({ shopName: 'Epsilon', countKind: 'sales', count: 60, price: 50, currency: '$', isDigital: true, priceIsRange: true }),
  listing({ shopName: 'Zeta', countKind: 'sales', count: 200, price: 22, currency: '$' }),
  listing({ shopName: 'Eta', countKind: 'sales', count: 150, price: 18, currency: '$' }),
  listing({ shopName: 'Theta', countKind: 'reviews', count: 5, price: 28, currency: '$' }),
  listing({ shopName: 'Omega', countKind: 'sales', count: 9999, price: 500, currency: '$', isAd: true }),
  listing({ shopName: 'Omega', countKind: 'sales', count: 8888, price: 400, currency: '$', isAd: true }),
];

const stats = mod.computeStats(dataset, 'leather wallet', 'search:leather wallet', 2);

check('ads are excluded from the organic count', stats.organicListings === 10, stats.organicListings);
check('ads are counted separately', stats.adListings === 2, stats.adListings);
check('sample counts every listing read, ads included', stats.sampleListings === 12, stats.sampleListings);
check('distinct shops counts unique organic shop names', stats.distinctShops === 8, stats.distinctShops);
check('top-3 concentration excludes ad-shop volume', stats.top3Pct === 50, stats.top3Pct);
check(
  'the predominant count kind wins when sales and reviews both appear',
  stats.medianCountKind === 'sales',
  stats.medianCountKind
);
check('mixing sales and review counts is flagged', stats.mixedCountKinds === true);
check('median is built only from the predominant kind, ads excluded', stats.medianCount === 120, stats.medianCount);
check('a zero-sales listing is counted, not dropped', stats.zeroCountListings === 1, stats.zeroCountListings);
check('median price uses only organic, priced listings', stats.medianPrice === 23.5, stats.medianPrice);
check('price band low (25th pct)', stats.priceBandLow === 18.5, stats.priceBandLow);
check('price band high (75th pct)', stats.priceBandHigh === 33.25, stats.priceBandHigh);
check('the majority currency is reported', stats.currency === '$', stats.currency);
check('a second currency on the page is flagged', stats.currencyMixed === true);
check('a variable-price listing is counted', stats.variablePriceListings === 1, stats.variablePriceListings);
check('digital vs physical is split', stats.digitalListings === 1 && stats.physicalListings === 9);

const noListings = mod.computeStats([], 'empty query', 'search:empty query', 1);
check('an all-empty page never throws and reports nulls', noListings.medianPrice === null && noListings.top3Pct === null);

/* ── aggregateTags ───────────────────────────────────────────────────── */

console.log('stats: aggregateTags');

const titledListings = [
  listing({ title: 'Handmade Leather Wallet Gift' }),
  listing({ title: 'Leather Wallet Personalized Gift' }),
  listing({ title: 'Custom Leather Journal Cover' }),
  listing({ title: 'Sponsored Leather Bag', isAd: true }),
];
const tagTable = mod.aggregateTags(titledListings);
check('ad titles are excluded from the tag table', !tagTable.tags.some(t => t.tag === 'bag'));
check('stopwords like "gift" and "handmade" are dropped', !tagTable.tags.some(t => t.tag === 'gift' || t.tag === 'handmade'));
check(
  'a word repeated within one title counts once per title',
  tagTable.tags.find(t => t.tag === 'leather')?.count === 3,
  JSON.stringify(tagTable.tags)
);
check('tags are sorted by count, most common first', tagTable.tags[0].tag === 'leather');
check('sample size is the number of organic titles used', tagTable.sampleSize === 3, tagTable.sampleSize);

/* ── applyFilters ────────────────────────────────────────────────────── */

console.log('stats: applyFilters');

const DEFAULT_FILTERS = { maxSales: null, minPrice: null, maxPrice: null, shop: null, organicOnly: false };

check(
  'organicOnly drops the ads',
  mod.applyFilters(dataset, { ...DEFAULT_FILTERS, organicOnly: true }).length === 10
);
check(
  'maxSales only compares listings whose badge is actually a sales count',
  mod.applyFilters(dataset, { ...DEFAULT_FILTERS, maxSales: 100 }).length === 6
);
check(
  'a price band filters by price regardless of ad status',
  mod.applyFilters(dataset, { ...DEFAULT_FILTERS, minPrice: 20, maxPrice: 30 }).length === 4
);
check(
  'a shop filter isolates that shop only',
  mod.applyFilters(dataset, { ...DEFAULT_FILTERS, shop: 'Delta' }).length === 2
);

/* ── Snapshot delta ──────────────────────────────────────────────────── */

console.log('stats: snapshot delta');

const DAY = 24 * 60 * 60 * 1000;
const previousStats = { ...stats, generatedAt: Date.now() - 12 * DAY, medianCount: 100, medianPrice: 20, top3Pct: 40 };
const currentStats = { ...stats, generatedAt: Date.now(), medianCount: 140, medianPrice: 22, top3Pct: 45 };

const delta = mod.computeDelta(previousStats, currentStats);
check('days since is computed from the two timestamps', delta.daysSince === 12, delta.daysSince);
check('median count delta', delta.medianCountDelta === 40, delta.medianCountDelta);
check('median price delta', delta.medianPriceDelta === 2, delta.medianPriceDelta);
check('top-3 share delta', delta.top3PctDelta === 5, delta.top3PctDelta);
check('no count-kind change is flagged when the kind stayed the same', delta.countKindChanged === false);

const switchedKind = { ...currentStats, medianCountKind: 'reviews' };
const kindDelta = mod.computeDelta(previousStats, switchedKind);
check('a sales<->reviews switch is flagged as not comparable', kindDelta.countKindChanged === true);
check(
  'describeDelta explains the switch in plain language',
  mod.describeDelta(kindDelta, previousStats.generatedAt, switchedKind.medianCountKind).includes('not comparable')
);
check(
  'describeDelta reports a signed change with the saved date',
  /\+40/.test(mod.describeDelta(delta, previousStats.generatedAt, currentStats.medianCountKind))
);

/* ── Exports ─────────────────────────────────────────────────────────── */

console.log('exports');

const bundle = {
  stats,
  listings: [
    listing({ title: 'Leather, "Tote" Bag', shopName: 'Alpha', price: 20, currency: '$', countKind: 'sales', count: 10 }),
    listing({ title: 'Plain Wallet', shopName: 'Beta', price: 15, currency: '$', countKind: 'reviews', count: 3, isAd: true }),
  ],
  tags: tagTable,
  filters: DEFAULT_FILTERS,
};

const md = mod.toMarkdownReport(bundle);
check('markdown opens with the niche read heading', md.startsWith('# Etsy niche read'));
check('markdown carries the query name', md.includes('leather wallet'));
check('markdown includes a listings table', md.includes('| # | Title | Price |'));
check('markdown keeps a title with a comma and quotes intact', md.includes('Leather, "Tote" Bag'));
check('markdown flags mixed sales/reviews counts', md.includes('mixes sales counts and review counts'));
check('markdown flags mixed currencies', md.includes('multiple currencies'));
check('markdown never claims a search-volume number', !/search volume/i.test(md));

const csv = mod.toCsvReport(bundle);
const csvLines = csv.trim().split('\r\n');
check('csv opens with the niche read row', csvLines[0].startsWith('Etsy niche read,'));
check('csv quotes a title containing a comma', csv.includes('"Leather, ""Tote"" Bag"'));
check('csv has a listings section header', csv.includes('Listings'));
check('csv has a tags section header', csv.includes('Tags,from'));

/* ── Filenames ───────────────────────────────────────────────────────── */

console.log('filenames');

const filename = mod.buildFilename('leather wallet', 'csv');
check('follows the "etsy-niche - {query}.{ext}" convention', filename === 'etsy-niche - leather wallet.csv', filename);
check('drops filesystem-hostile characters', !/[\\/:*?"<>|]/.test(mod.buildFilename('leather/wallet:2', 'md')));

const longName = mod.buildFilename('x'.repeat(400), 'md');
check('truncates to 120 characters', longName.length <= 120, `${longName.length} chars`);
check('keeps the extension after truncation', longName.endsWith('.md'));

fs.rmSync(entry, { force: true });
fs.rmSync(bundlePath, { force: true });

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
