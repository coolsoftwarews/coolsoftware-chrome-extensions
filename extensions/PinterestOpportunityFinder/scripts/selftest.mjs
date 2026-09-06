/**
 * Headless checks for the pure logic: the outlier engine (median baseline,
 * ratio badges, sample-size honesty), the keyword/domain/format extraction,
 * filters, and the CSV/Markdown export layer. DOM-bound extraction
 * (src/extract.ts) needs a browser and is covered by the manual checklist in
 * README.md instead — same split WebHighlighter uses between quote.ts and
 * anchor.ts.
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

const entry = path.join(os.tmpdir(), `pof-selftest-${process.pid}.mjs`);
fs.writeFileSync(
  entry,
  ['domains.ts', 'outlier.ts', 'keywords.ts', 'filters.ts', 'formatters.ts', 'extract.ts']
    .map(file => `export * from ${JSON.stringify(path.join(rootDir, 'src', file).replace(/\\/g, '/'))};`)
    .join('\n')
);

const bundlePath = path.join(os.tmpdir(), `pof-selftest-bundle-${process.pid}.mjs`);
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

/* ── Fixtures ────────────────────────────────────────────────────────── */

function pin(overrides) {
  return {
    id: 'p0',
    rank: 0,
    title: '',
    description: '',
    domain: null,
    saveCount: null,
    isPromoted: false,
    isIdeaPin: false,
    imageWidth: null,
    imageHeight: null,
    hasTextOverlay: null,
    imageUrl: null,
    pinUrl: 'https://pinterest.com/pin/1/',
    ...overrides,
  };
}

/* ── domains ─────────────────────────────────────────────────────────── */

console.log('domains');
check('accepts pinterest.com', mod.isPinterestUrl('https://www.pinterest.com/search/pins/?q=x'));
check('accepts a regional ccTLD', mod.isPinterestUrl('https://www.pinterest.co.uk/search/pins/?q=x'));
check('accepts a regional ccTLD without www', mod.isPinterestUrl('https://pinterest.de/'));
check('rejects a non-Pinterest host', !mod.isPinterestUrl('https://example.com/search/?q=pinterest.com'));
check('rejects a lookalike host', !mod.isPinterestUrl('https://pinterest.com.evil.example/'));
check('search page recognised', mod.isSearchUrl('https://www.pinterest.com/search/pins/?q=weeknight+dinners'));
check('non-search page rejected', !mod.isSearchUrl('https://www.pinterest.com/'));
check(
  'extracts and lowercases the query',
  mod.searchQueryFrom('https://www.pinterest.com/search/pins/?q=Weeknight+Dinners') === 'weeknight dinners'
);

/* ── outlier engine ──────────────────────────────────────────────────── */

console.log('outlier engine');

const trustedPool = [
  pin({ id: 'a', rank: 0, saveCount: 100 }),
  pin({ id: 'b', rank: 1, saveCount: 200 }),
  pin({ id: 'c', rank: 2, saveCount: 300 }),
  pin({ id: 'd', rank: 3, saveCount: 400 }),
  pin({ id: 'e', rank: 4, saveCount: 500 }),
  pin({ id: 'g', rank: 5, saveCount: 600 }),
  pin({ id: 'f', rank: 6, saveCount: 4000 }), // the outlier
];
const trustedBaseline = mod.computeBaseline(trustedPool);
check('median computed from the readable pool', trustedBaseline.median === 400, trustedBaseline.median);
check('sample size counts only numeric pins', trustedBaseline.sampleSize === 7);
check('a fully-readable set is trustworthy', trustedBaseline.trustworthy === true);

const trustedBadges = mod.computeBadges(trustedPool, trustedBaseline);
check('ratio badge on the outlier', trustedBadges.f.kind === 'ratio' && trustedBadges.f.ratio === 10);
check('ratio badge carries the sample size', trustedBadges.f.sampleSize === 7);
check('a low pin still gets a ratio badge, not a rank', trustedBadges.a.kind === 'ratio' && trustedBadges.a.ratio === 0.25);

const promoted = pin({ id: 'promo', rank: 7, saveCount: 9999, isPromoted: true });
const idea = pin({ id: 'idea', rank: 8, isIdeaPin: true });
const withSpecials = [...trustedPool, promoted, idea];
const specialsBaseline = mod.computeBaseline(withSpecials);
check('promoted pins excluded from the baseline', specialsBaseline.sampleSize === 7);
const specialsBadges = mod.computeBadges(withSpecials, specialsBaseline);
check('promoted pins are labelled, never scored', specialsBadges.promo.kind === 'promoted');
check('idea pins are labelled, never scored', specialsBadges.idea.kind === 'idea-pin');

// Sample-size honesty: most pins expose no number at all.
const sparsePool = [
  pin({ id: 'x1', rank: 0, saveCount: 50 }),
  pin({ id: 'x2', rank: 1, saveCount: 80 }),
  ...Array.from({ length: 8 }, (_, i) => pin({ id: `x${i + 3}`, rank: i + 2 })),
];
const sparseBaseline = mod.computeBaseline(sparsePool);
check(
  'below the usable-fraction threshold, the baseline is not trustworthy',
  sparseBaseline.trustworthy === false,
  `usableFraction=${sparseBaseline.usableFraction}`
);
check('an untrustworthy baseline reports no median', sparseBaseline.median === null);
const sparseBadges = mod.computeBadges(sparsePool, sparseBaseline);
check(
  'badges fall back to rank, never a save count, when the sample can’t be trusted',
  sparsePool.every(p => sparseBadges[p.id].kind === 'rank'),
  JSON.stringify(sparsePool.map(p => sparseBadges[p.id].kind))
);
check('rank badges never carry a ratio field', sparseBadges.x1.ratio === undefined);

// Enough numeric pins, but too few overall pins to trust a median.
const tinyPool = [pin({ id: 't1', rank: 0, saveCount: 10 }), pin({ id: 't2', rank: 1, saveCount: 20 })];
check('too few samples is untrustworthy even at 100% coverage', mod.computeBaseline(tinyPool).trustworthy === false);

check('formatRatio', mod.formatRatio(4.25) === '4.3×', mod.formatRatio(4.25));
check('formatSaveCount under 1000', mod.formatSaveCount(842) === '842');
check('formatSaveCount thousands', mod.formatSaveCount(1200) === '1.2K', mod.formatSaveCount(1200));
check('formatSaveCount millions', mod.formatSaveCount(2_000_000) === '2M', mod.formatSaveCount(2_000_000));

const outliers = mod.outlierPins(trustedPool, trustedBadges, 2);
check('outlierPins picks the ratio-badged pin above the threshold', outliers.length === 1 && outliers[0].id === 'f');

const fallbackOutliers = mod.outlierPins(sparsePool, sparseBadges, 2);
check(
  'outlierPins falls back to the top rank quartile when no ratio badges exist',
  fallbackOutliers.length > 0 && fallbackOutliers.every(p => p.id !== undefined)
);

/* ── keywords ────────────────────────────────────────────────────────── */

console.log('keywords');

check('tokenize lowercases and drops stopwords', mod.tokenize('The Easy Weeknight Dinner').join(' ') === 'easy weeknight dinner');
check('tokenize counts non-Latin tokens without parsing grammar', mod.tokenize('быстрый ужин рецепт').length === 3);
check('tokenize drops single-character noise', !mod.tokenize('a b easy').includes('a'));

const phrases = mod.phrasesOf('easy weeknight dinner');
check('phrasesOf includes 1-, 2- and 3-grams', phrases.has('easy') && phrases.has('easy weeknight') && phrases.has('easy weeknight dinner'));

const outlierPinsForKeywords = [
  pin({ id: 'o1', rank: 0, title: 'Easy weeknight dinner recipes', domain: 'foodblog.com', imageUrl: 'img/1' }),
  pin({ id: 'o2', rank: 1, title: 'Easy weeknight dinner ideas', domain: 'foodblog.com', imageUrl: 'img/2' }),
  pin({ id: 'o3', rank: 2, title: 'Easy weeknight dinner for families', domain: 'otherblog.com', imageUrl: 'img/3' }),
];
const restPinsForKeywords = [
  pin({ id: 'r1', rank: 3, title: 'Slow cooker soup recipes', imageUrl: 'img/4' }),
  pin({ id: 'r2', rank: 4, title: 'Holiday dessert table', imageUrl: 'img/5' }),
];
const keywordStats = mod.computeKeywordStats(outlierPinsForKeywords, restPinsForKeywords);
const topPhrase = keywordStats.find(k => k.phrase === 'easy weeknight dinner');
check('a phrase repeated across outliers is captured', Boolean(topPhrase), keywordStats.slice(0, 5));
check('over-represented phrase has ratio > 1', topPhrase && topPhrase.ratio > 1);
check(
  'a phrase seen only once among outliers is dropped (sample-size honesty)',
  !keywordStats.some(k => k.phrase === 'families')
);

// Repin grouping: the same source image rendered at two different Pinterest
// CDN sizes must normalize to the same key so repins group correctly (PRD §7).
check(
  'normalizeImageUrl strips the size segment from a pinimg.com URL',
  mod.normalizeImageUrl('https://i.pinimg.com/564x/aa/bb/cc/aabbcc112233.jpg') ===
    mod.normalizeImageUrl('https://i.pinimg.com/236x/aa/bb/cc/aabbcc112233.jpg')
);
check(
  'normalizeImageUrl distinguishes different source images',
  mod.normalizeImageUrl('https://i.pinimg.com/564x/aa/bb/cc/one.jpg') !==
    mod.normalizeImageUrl('https://i.pinimg.com/564x/aa/bb/cc/two.jpg')
);
check('normalizeImageUrl handles a missing url', mod.normalizeImageUrl(null) === null);

const normalizedRepins = [
  pin({ id: 'nrep1', rank: 0, imageUrl: 'aa/bb/hash.jpg', saveCount: 500 }),
  pin({ id: 'nrep2', rank: 1, imageUrl: 'aa/bb/hash.jpg', saveCount: 100 }),
];
const normalizedGroups = mod.groupByImage(normalizedRepins);
check('same normalized image URL groups into one', normalizedGroups.length === 1);
const rep = mod.representativeOf(normalizedGroups[0]);
check('the representative of a group is the highest-save pin', rep.id === 'nrep1');

const domainStats = mod.computeDomainStats(outlierPinsForKeywords);
check('domains among outliers are counted', domainStats.find(d => d.domain === 'foodblog.com')?.outlierCount === 2);

const formatFixture = [
  pin({ id: 'f1', imageWidth: 200, imageHeight: 200, hasTextOverlay: true, imageUrl: 'i1' }),
  pin({ id: 'f2', imageWidth: 200, imageHeight: 300, hasTextOverlay: false, imageUrl: 'i2' }),
  pin({ id: 'f3', imageWidth: 200, imageHeight: 500, hasTextOverlay: null, imageUrl: 'i3' }),
];
const formatStats = mod.computeFormatStats(formatFixture);
check('format stats classify a square image', formatStats.aspectBands.some(b => b.label.startsWith('Square') && b.count === 1));
check('format stats classify a very tall image', formatStats.aspectBands.some(b => b.label.startsWith('Very tall') && b.count === 1));
check('text overlay buckets include "Not detected" rather than guessing', formatStats.textOverlay.some(b => b.label === 'Not detected'));
check('format sample size matches the input', formatStats.sampleSize === 3);

/* ── filters ─────────────────────────────────────────────────────────── */

console.log('filters');

const filterPool = [
  pin({ id: 'f1', rank: 0, domain: 'shop.example.com', saveCount: 1000, hasTextOverlay: true }),
  pin({ id: 'f2', rank: 1, domain: 'blog.other.com', saveCount: 100, hasTextOverlay: false }),
  pin({ id: 'f3', rank: 2, domain: 'shop.example.com', saveCount: 50, hasTextOverlay: false }),
];
const filterBadges = mod.computeBadges(filterPool, mod.computeBaseline([...filterPool, ...filterPool, ...filterPool]));

check(
  'lastN keeps only the first N by rank',
  mod.applyFilters(filterPool, filterBadges, { minRatio: null, domain: null, hasTextOverlay: null, lastN: 2 }).length === 2
);
check(
  'domain filter matches by substring, case-insensitively',
  mod.applyFilters(filterPool, filterBadges, { minRatio: null, domain: 'EXAMPLE', hasTextOverlay: null, lastN: null }).length === 2
);
check(
  'text overlay filter is strict (excludes null/unknown)',
  mod.applyFilters(filterPool, filterBadges, { minRatio: null, domain: null, hasTextOverlay: true, lastN: null }).length === 1
);
check(
  'no filters returns everything, sorted by rank',
  mod.applyFilters(filterPool, filterBadges, { minRatio: null, domain: null, hasTextOverlay: null, lastN: null }).map(p => p.id).join(',') ===
    'f1,f2,f3'
);

/* ── formatters (CSV / Markdown / filenames) ────────────────────────── */

console.log('formatters');

const csvPins = [
  pin({ id: 'c1', rank: 0, title: 'Recipes, with a comma', domain: 'a.com', saveCount: 500, pinUrl: 'https://pinterest.com/pin/1/' }),
];
const csvBadges = { c1: { pinId: 'c1', kind: 'ratio', ratio: 3.333, saveCount: 500, sampleSize: 12 } };
const pinsCsv = mod.toPinsCsv(csvPins, csvBadges);
check('CSV header is present', pinsCsv.startsWith('rank,title,domain,badge_kind,badge_value'));
check('CSV escapes a value containing a comma', pinsCsv.includes('"Recipes, with a comma"'));
check('CSV rows are CRLF-terminated', pinsCsv.includes('\r\n'));

const keywordsCsv = mod.toKeywordsCsv(keywordStats);
check('keyword CSV has a header row', keywordsCsv.split('\r\n')[0] === 'phrase,outlier_count,outlier_sample_size,rest_count,rest_sample_size,ratio');

const report = mod.toMarkdownReport({
  query: 'weeknight dinners',
  url: 'https://www.pinterest.com/search/pins/?q=weeknight+dinners',
  generatedAt: '2026-09-02T00:00:00.000Z',
  baseline: trustedBaseline,
  pins: trustedPool,
  badges: trustedBadges,
  keywords: keywordStats,
  domains: domainStats,
  formats: formatStats,
});
check('report opens with a heading that includes the query', report.startsWith('# Pinterest Opportunity Finder — "weeknight dinners"'));
check('report includes the median line when trustworthy', report.includes('Median saves:'));
check('report includes a pins table', report.includes('| Rank | Title | Domain | Badge | Save count |'));
check('report includes the keyword table', report.includes('## Keyword table'));

const untrustworthyReport = mod.toMarkdownReport({
  query: null,
  url: 'https://www.pinterest.com/search/pins/?q=x',
  generatedAt: '2026-09-02T00:00:00.000Z',
  baseline: sparseBaseline,
  pins: sparsePool,
  badges: sparseBadges,
  keywords: [],
  domains: [],
  formats: { aspectBands: [], textOverlay: [], sampleSize: 0 },
});
check('an untrustworthy baseline is stated plainly, never a fabricated median', untrustworthyReport.includes('unreliable for this search'));
check('an empty keyword table says so rather than rendering nothing', untrustworthyReport.includes('Not enough outlier pins'));

const filename = mod.buildFilename('Weeknight: Dinners?', 'pins', 'csv');
check('filename drops filesystem-hostile characters', !/[\\/:*?"<>|]/.test(filename), filename);
check('filename carries the export kind and extension', filename.endsWith('- pins.csv'), filename);

const longFilename = mod.buildFilename('x'.repeat(400), 'report', 'md');
check('filename truncates to 120 characters', longFilename.length <= 120, longFilename.length);
check('truncated filename keeps its extension', longFilename.endsWith('.md'));

fs.rmSync(entry, { force: true });
fs.rmSync(bundlePath, { force: true });

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
