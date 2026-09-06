/**
 * Headless checks for the pure logic: number/url parsing, the outlier engine
 * (median baseline, ratio, sample-size honesty), commercial-marker
 * detection, filtering/aggregation for the product board, and the CSV/MD
 * export formats.
 *
 * The DOM-bound half (scan.ts, badge.ts, drawer.ts, content.ts) needs a real
 * TikTok page and is covered by the manual checklist in README.md instead —
 * the same split WebHighlighter uses between quote.ts/formatters.ts (tested
 * here) and anchor.ts/content.ts (tested by hand).
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

const entry = path.join(os.tmpdir(), `tps-selftest-${process.pid}.mjs`);
fs.writeFileSync(
  entry,
  ['parse.ts', 'outlier.ts', 'markers.ts', 'aggregate.ts', 'export.ts']
    .map(file => `export * from ${JSON.stringify(path.join(rootDir, 'src', file).replace(/\\/g, '/'))};`)
    .join('\n')
);

const bundlePath = path.join(os.tmpdir(), `tps-selftest-bundle-${process.pid}.mjs`);
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

console.log('parsing');
check('parses a plain integer', mod.parseCompactNumber('12') === 12);
check('parses thousands with comma', mod.parseCompactNumber('12,345') === 12345);
check('parses K suffix', mod.parseCompactNumber('340K') === 340_000);
check('parses M suffix with a decimal', mod.parseCompactNumber('1.2M') === 1_200_000);
check('parses B suffix', mod.parseCompactNumber('1.5B') === 1_500_000_000);
check('rejects garbage', mod.parseCompactNumber('shop now') === null);
check('rejects empty/null', mod.parseCompactNumber(null) === null && mod.parseCompactNumber('') === null);

check(
  'extracts a video id from a watch url',
  mod.extractVideoId('https://www.tiktok.com/@acme/video/7123456789012345678?lang=en') === '7123456789012345678'
);
check('extracts a handle from a watch url', mod.extractHandle('https://www.tiktok.com/@acme/video/123') === '@acme');
check('extracts a handle from a bare profile url', mod.extractHandle('https://www.tiktok.com/@acme') === '@acme');
check('video id is null without one', mod.extractVideoId('https://www.tiktok.com/@acme') === null);
check('builds a canonical video url', mod.buildVideoUrl('@acme', '123') === 'https://www.tiktok.com/@acme/video/123');

check('classifies the for-you feed', mod.classifyPage('/foryou', '') === 'feed');
check('classifies the bare root as feed', mod.classifyPage('/', '') === 'feed');
check('classifies search', mod.classifyPage('/search', '?q=widget') === 'search');
check('classifies a hashtag page', mod.classifyPage('/tag/widget', '') === 'hashtag');
check('classifies a watch page', mod.classifyPage('/@acme/video/123', '') === 'video');
check('classifies a profile page', mod.classifyPage('/@acme', '') === 'profile');
check('unrecognized paths are unknown', mod.classifyPage('/explore', '') === 'unknown');

check('flags an age-restricted tile', mod.isRestrictedTileText('This video is age-restricted') === true);
check('flags a region-locked tile', mod.isRestrictedTileText('Not available in your region') === true);
check('ordinary caption text is not restricted', mod.isRestrictedTileText('Shop now, link in bio!') === false);

/* ── Outlier engine ──────────────────────────────────────────────────── */

console.log('outlier engine');
check('median of an odd-length list', mod.median([1, 5, 3]) === 3);
check('median of an even-length list', mod.median([1, 2, 3, 4]) === 2.5);
check('median of an empty list is 0', mod.median([]) === 0);

const baseline5 = mod.buildBaseline('@acme', [100, 200, 300, 400, 500]);
check('baseline captures the median', baseline5.median === 300);
check('baseline captures the sample size', baseline5.sampleSize === 5);
check('a zero view count is dropped from the baseline', mod.buildBaseline('@acme', [0, 100, 200]).sampleSize === 2);
check('an all-zero baseline is null rather than a fake median', mod.buildBaseline('@acme', [0, 0]) === null);
check('no data at all is null', mod.buildBaseline('@acme', []) === null);

const pending = mod.computeOutlier(340_000, null);
check('no baseline yet is pending, not a guess', pending.ratio === null && pending.confidence === 'pending');

const oneVideoBaseline = mod.buildBaseline('@acme', [50_000]);
const lowSample = mod.computeOutlier(340_000, oneVideoBaseline);
check('a single-video baseline still produces a ratio', lowSample.ratio === 6.8);
check(
  'but is flagged low-sample rather than hidden (PRD §7: flag, don’t hide)',
  lowSample.confidence === 'low-sample'
);

const reliableBaseline = mod.buildBaseline('@acme', [50_000, 55_000, 45_000]);
const reliable = mod.computeOutlier(310_000, reliableBaseline);
check('three or more videos is a reliable baseline', reliable.confidence === 'reliable');
check('ratio math is views / median', Math.abs(reliable.ratio - 6.2) < 0.001);

check('formats a reliable ratio', mod.formatRatio(reliable) === '6.2×');
check('formats a low-sample ratio with a qualifier', mod.formatRatio(lowSample).includes('low sample'));
check('formats a pending ratio as the word "pending"', mod.formatRatio(pending) === 'pending');

check(
  'medianRatioOf excludes pending results rather than treating them as 0',
  mod.medianRatioOf([{ ratio: null, confidence: 'pending' }, { ratio: 4, confidence: 'reliable' }, { ratio: 6, confidence: 'reliable' }]) === 5
);
check('medianRatioOf of all-pending is null', mod.medianRatioOf([{ ratio: null, confidence: 'pending' }]) === null);

/* ── Commercial markers ──────────────────────────────────────────────── */

console.log('commercial markers');
const shopCaption = mod.detectCaptionMarkers('Shop now! Link in bio, use code SAVE10');
check('detects shop language', shopCaption.some(m => m.type === 'shop_language'));
check('detects a bio link mention', shopCaption.some(m => m.type === 'bio_link'));
check('detects a discount code pattern', shopCaption.some(m => m.type === 'discount_code'));
check('every caption marker is heuristic, never verified', shopCaption.every(m => m.confidence === 'heuristic'));
check('one marker per type, not one per phrase match', shopCaption.filter(m => m.type === 'shop_language').length === 1);
check('a plain caption yields no markers', mod.detectCaptionMarkers('Just a normal day, feeling great').length === 0);
check('empty caption is safe', mod.detectCaptionMarkers('').length === 0);

const verifiedShop = [{ type: 'shop_link', confidence: 'verified', label: 'TikTok Shop' }];
const combined = mod.combineMarkers(verifiedShop, 'Shop now, 20% off');
check('combineMarkers keeps the verified marker first', combined[0].confidence === 'verified');
check('combineMarkers still adds caption heuristics', combined.some(m => m.confidence === 'heuristic'));
check('hasCommercialMarker is true with any marker', mod.hasCommercialMarker(combined) === true);
check('hasCommercialMarker is false with none', mod.hasCommercialMarker([]) === false);
check('hasVerifiedMarker distinguishes a real shop link from a guess', mod.hasVerifiedMarker(verifiedShop) === true);
check('hasVerifiedMarker is false for heuristic-only markers', mod.hasVerifiedMarker(shopCaption) === false);

check(
  'the badge label for a verified marker never says "possible"',
  mod.markerBadgeLabel(verifiedShop) === '🛒 shop link'
);
check(
  'the badge label for a heuristic-only marker is hedged, never presented as fact',
  mod.markerBadgeLabel(shopCaption) === '🛒 possible link'
);
check('no markers means no badge label', mod.markerBadgeLabel([]) === null);

check('shop markers group by their verified label', mod.groupKeyFor(verifiedShop) === 'shop:tiktok shop');
check('caption-only markers group by pattern type', mod.groupKeyFor(shopCaption).startsWith('caption:'));
check('no markers means no group key', mod.groupKeyFor([]) === null);

/* ── Filtering & aggregation ─────────────────────────────────────────── */

console.log('filtering & aggregation');

const now = Date.parse('2026-09-01T00:00:00Z');
const day = 24 * 60 * 60 * 1000;

function video(overrides) {
  return {
    id: 'v1',
    url: 'https://www.tiktok.com/@a/video/1',
    creatorHandle: '@a',
    views: 300_000,
    likes: 1000,
    comments: 10,
    publishedAt: null,
    markers: [],
    addedAt: now,
    ...overrides,
  };
}

const commercialVideo = video({ id: 'v1', markers: verifiedShop });
const plainVideo = video({ id: 'v2', markers: [] });

check(
  'onlyCommercial filter keeps commercial videos',
  mod.matchesFilters(commercialVideo, { minRatio: null, onlyCommercial: true, withinDays: null, minViews: null }, now)
);
check(
  'onlyCommercial filter drops plain videos',
  !mod.matchesFilters(plainVideo, { minRatio: null, onlyCommercial: true, withinDays: null, minViews: null }, now)
);
check(
  'minViews filter drops videos below the threshold',
  !mod.matchesFilters(video({ views: 100 }), { minRatio: null, onlyCommercial: false, withinDays: null, minViews: 1000 }, now)
);
check(
  'withinDays filter drops videos older than the window',
  !mod.matchesFilters(video({ addedAt: now - 10 * day }), { minRatio: null, onlyCommercial: false, withinDays: 7, minViews: null }, now)
);
check(
  'withinDays filter keeps videos inside the window',
  mod.matchesFilters(video({ addedAt: now - 2 * day }), { minRatio: null, onlyCommercial: false, withinDays: 7, minViews: null }, now)
);

const baselines = new Map([['@a', { handle: '@a', median: 50_000, sampleSize: 5, updatedAt: now }]]);
check(
  'minRatio filter needs a baseline lookup and drops videos under it',
  mod.filterVideos([video({ views: 100_000 })], { minRatio: 5, onlyCommercial: false, withinDays: null, minViews: null }, baselines, now)
    .length === 0
);
check(
  'minRatio filter keeps videos at or above it',
  mod.filterVideos([video({ views: 300_000 })], { minRatio: 5, onlyCommercial: false, withinDays: null, minViews: null }, baselines, now)
    .length === 1
);
check(
  'minRatio filter drops pending (no-baseline) videos rather than guessing them in',
  mod.filterVideos(
    [video({ creatorHandle: '@unknown' })],
    { minRatio: 1, onlyCommercial: false, withinDays: null, minViews: null },
    baselines,
    now
  ).length === 0
);

const product = {
  id: 'p1',
  name: 'Collapsible bottle',
  groupType: 'shop',
  groupKey: 'shop:tiktok shop',
  createdAt: now,
  updatedAt: now,
  videos: [
    video({ id: 'v1', creatorHandle: '@a', views: 300_000, addedAt: now - 3 * day }),
    video({ id: 'v2', creatorHandle: '@b', views: 400_000, addedAt: now - 1 * day }),
    video({ id: 'v3', creatorHandle: '@a', views: 100_000, addedAt: now }), // same creator as v1 — should not inflate distinct-creator count
  ],
};
const noFilters = { minRatio: null, onlyCommercial: false, withinDays: null, minViews: null };
const baselinesForProduct = new Map([
  ['@a', { handle: '@a', median: 50_000, sampleSize: 5, updatedAt: now }],
  // @b has no baseline yet — its video should count toward pendingBaselines.
]);

const stats = mod.computeProductStats(product, noFilters, baselinesForProduct, now);
check('distinct creators counts unique handles, not videos', stats.distinctCreators === 2);
check('the biggest-thing-on-the-card number is the distinct-creator count', stats.distinctCreators === 2);
check('firstSeen is the earliest addedAt', stats.firstSeen === now - 3 * day);
check('lastSeen is the latest addedAt', stats.lastSeen === now);
check('one video with no baseline is counted as pending', stats.pendingBaselines === 1);
check('median ratio ignores the pending video', stats.medianRatio !== null);

const ranked = mod.rankProducts([product], noFilters, baselinesForProduct, now);
check('rankProducts returns the product', ranked.length === 1);
check('products with zero matching videos are dropped entirely', mod.rankProducts([product], { ...noFilters, minViews: 999_999_999 }, baselinesForProduct, now).length === 0);

const threeCreatorProduct = {
  ...product,
  videos: [video({ id: 'x1', creatorHandle: '@a' }), video({ id: 'x2', creatorHandle: '@b' }), video({ id: 'x3', creatorHandle: '@c' })],
};
check(
  'countBoardsAtThreeCreators counts boards at the PRD §8 milestone',
  mod.countBoardsAtThreeCreators([product, threeCreatorProduct]) === 1
);

/* ── Export ──────────────────────────────────────────────────────────── */

console.log('export');

const csv = mod.toCsv([stats]);
const csvLines = csv.trim().split('\n');
check('csv has a header plus one row per product', csvLines.length === 2);
check('csv header matches the PRD §4 column list', csvLines[0] === mod.CSV_HEADER.join(','));
check('csv row carries the distinct-creator count', csvLines[1].split(',')[2] === '2');
check('a comma in a product name is quoted', mod.toCsv([{ ...stats, product: { ...stats.product, name: 'Bottle, 32oz' } }]).includes('"Bottle, 32oz"'));

const md = mod.toMarkdownSummary([stats], now);
check('markdown starts with a title', md.startsWith('# TikTok Product Scout'));
check('markdown includes the product name as a heading', md.includes('## Collapsible bottle'));
check('markdown states the distinct-creator count', md.includes('**2 distinct creators**'));
check('markdown flags pending baselines rather than hiding the gap', md.includes('awaiting a creator baseline'));
check('markdown lists source video links', md.includes('](https://www.tiktok.com/@a/video/1)'));

const emptyMd = mod.toMarkdownSummary([], now);
check('an empty board exports without throwing', emptyMd.includes('No products match'));

check('filenames follow the tiktok-product-scout-{date}.{ext} convention', mod.buildFilename('csv', now) === `tiktok-product-scout-${new Date(now).toISOString().slice(0, 10)}.csv`);

fs.rmSync(entry, { force: true });
fs.rmSync(bundlePath, { force: true });

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
