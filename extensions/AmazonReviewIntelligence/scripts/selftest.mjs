/**
 * Headless checks for the pure logic: tokenizing/stemming, language
 * bucketing, the theme clusterer (the actual "intelligence" in this
 * product), text parsing helpers, filtering/analysis and the two export
 * formats. The DOM-bound half (content.ts's review scraping) needs a real
 * Amazon page and is covered by the manual checklist in README.md instead —
 * same split as WebHighlighter's quote.ts/anchor.ts.
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

const entry = path.join(os.tmpdir(), `ari-selftest-${process.pid}.mjs`);
fs.writeFileSync(
  entry,
  ['text.ts', 'language.ts', 'cluster.ts', 'parse.ts', 'analyze.ts', 'formatters.ts']
    .map(file => `export * from ${JSON.stringify(path.join(rootDir, 'src', file).replace(/\\/g, '/'))};`)
    .join('\n')
);

const bundlePath = path.join(os.tmpdir(), `ari-selftest-bundle-${process.pid}.mjs`);
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

/* ── Tokenizing & stemming ───────────────────────────────────────────── */

console.log('text');
check('splits on whitespace and punctuation', mod.tokenizeRaw("battery's dead, ugh!").join(',') === 'battery,dead,ugh');
check('lowercases', mod.tokenizeRaw('BATTERY').join('') === 'battery');
check('collapses plural to singular stem', mod.stem('batteries') === mod.stem('battery'), `${mod.stem('batteries')} vs ${mod.stem('battery')}`);
check('collapses "dies" onto "die"', mod.stem('dies') === mod.stem('die'));
check(
  'collapses a silent-e base onto its -ing/-ed/-es forms',
  mod.stem('charge') === mod.stem('charging') && mod.stem('charge') === mod.stem('charged') && mod.stem('charge') === mod.stem('charges'),
  `${mod.stem('charge')} / ${mod.stem('charging')} / ${mod.stem('charged')} / ${mod.stem('charges')}`
);
check('Amazon noise words are recognised as stopwords', mod.isStopword('amazon') && mod.isStopword('product') && mod.isStopword('item'));
check('ordinary stopwords are recognised', mod.isStopword('the') && mod.isStopword('and'));
check('a real content word is not a stopword', !mod.isStopword('battery'));
check('weak modifiers are flagged', mod.isWeakModifier('too') && mod.isWeakModifier('very'));
check(
  'filterTokens drops stopwords and noise but keeps content words',
  mod.filterTokens(mod.tokenize('the battery from amazon just dies')).map(t => t.raw).join(' ') === 'battery dies'
);

/* ── Language bucketing ──────────────────────────────────────────────── */

console.log('language');
check('detects Latin/English text', mod.detectLanguageBucket('This battery dies fast.') === 'latin');
check('detects Cyrillic text', mod.detectLanguageBucket('Батарея быстро разряжается') === 'cyrillic');
check('detects CJK text', mod.detectLanguageBucket('電池がすぐ切れます') === 'cjk');
check('detects Arabic text', mod.detectLanguageBucket('البطارية تموت بسرعة') === 'arabic');
check('empty text defaults to latin rather than throwing', mod.detectLanguageBucket('') === 'latin');

/* ── Clustering — the core "intelligence" ────────────────────────────── */

console.log('cluster');

function review(id, text) {
  return { id, text };
}

// Mirrors the PRD §4 worked example almost exactly: 47 negative reviews,
// four recurring complaints at 18 / 12 / 9 / 7 mentions, plus noise words
// that must never surface as a theme. Each cluster cycles several differently
// worded templates so only the target words repeat at the full cluster
// count — incidental filler words repeat at most a handful of times each,
// same as real reviews, so they can never out-rank the real theme when the
// top representative terms are chosen.
function fromTemplates(idPrefix, count, templates) {
  return Array.from({ length: count }, (_, i) => review(`${idPrefix}${i}`, templates[i % templates.length]));
}

const batteryReviews = fromTemplates('bat', 18, [
  "This amazon battery dies so fast, it won't charge overnight, real letdown from this seller.",
  'Battery just dies after one day and takes forever to charge, disappointing purchase overall.',
  'My battery dies constantly, charging takes way too long for daily use honestly.',
  'The battery dies within hours, charge time is way too slow for a modern device.',
  'Batteries die too quickly here, and charging never seems to fully complete properly.',
]);
const strapReviews = fromTemplates('strap', 12, [
  'The strap broke after a single week and then it snapped clean off during a walk.',
  'My strap broke almost immediately, cheap material, it snapped the very first day.',
  'Strap broke on the bus ride home, snapped right at the buckle, very flimsy.',
  'This strap broke twice already and snapped again this morning, returning it now.',
]);
const instructionReviews = fromTemplates('man', 9, [
  'Instructions were unclear and the manual reads like a bad translation, very confusing.',
  'The manual is unclear on setup and instructions skip several important steps entirely.',
  'Honestly the instructions and manual together were unclear about the wiring diagram.',
]);
const sizingReviews = fromTemplates('size', 7, [
  "Sizing runs small, honestly it's too small for anyone with average hands.",
  'The sizing chart is wrong, mine arrived too small compared to the listing photos.',
]);
const fillerNegative = [review('filler0', 'Just did not like this overall, would not buy again from this seller.')];

const negativeReviews = [...batteryReviews, ...strapReviews, ...instructionReviews, ...sizingReviews, ...fillerNegative];
check('fixture matches the PRD worked example size', negativeReviews.length === 47, negativeReviews.length);

const negativeThemes = mod.extractThemes(negativeReviews);

check('produces at least the four expected themes', negativeThemes.length >= 4, negativeThemes.map(t => t.label).join(' | '));
check(
  'battery/charge/dies is the top theme with 18 mentions',
  negativeThemes[0]?.count === 18,
  JSON.stringify(negativeThemes.map(t => ({ label: t.label, count: t.count })))
);
check('battery theme label mentions battery', /batter/i.test(negativeThemes[0]?.label ?? ''));
check(
  'themes are sorted by count, descending',
  negativeThemes.every((t, i) => i === 0 || negativeThemes[i - 1].count >= t.count)
);
check(
  'strap/broke/snapped theme has 12 mentions',
  negativeThemes.some(t => t.count === 12 && /strap/i.test(t.label))
);
check(
  'instructions/manual theme has 9 mentions',
  negativeThemes.some(t => t.count === 9 && /(instruction|manual)/i.test(t.label))
);
check(
  'sizing/too small theme has 7 mentions and groups the unigram with the bigram',
  negativeThemes.some(t => t.count === 7 && /sizing/i.test(t.label) && /small/i.test(t.label)),
  JSON.stringify(negativeThemes.map(t => t.label))
);
check(
  'noise words never become a theme',
  !negativeThemes.some(t => /\b(amazon|product|item|order)\b/i.test(t.label))
);
check(
  'the one-off filler review never becomes a theme',
  !negativeThemes.some(t => t.count === 1)
);
check('every theme carries its evidence review ids', negativeThemes.every(t => t.reviewIds.length === t.count));
check('theme count never exceeds the review count it was built from', negativeThemes.every(t => t.count <= negativeReviews.length));

// Re-running the exact same input must produce the exact same clusters —
// "correct or visibly wrong" only means something if it's also stable.
const rerun = mod.extractThemes(negativeReviews);
check(
  'clustering is deterministic across runs',
  JSON.stringify(rerun.map(t => [t.label, t.count])) === JSON.stringify(negativeThemes.map(t => [t.label, t.count]))
);

// A very long review must count once, not once per occurrence (PRD §7).
const weightFixture = [
  review('long', `${'amazing '.repeat(60)} quality build.`),
  review('r2', 'Amazing quality build overall.'),
  review('r3', 'Amazing quality build overall.'),
  review('r4', 'Amazing quality build overall.'),
];
const weightThemes = mod.extractThemes(weightFixture);
const amazingTheme = weightThemes.find(t => /amazing/i.test(t.label));
check('a long review is weighted once, not once per word', amazingTheme?.count === 4, amazingTheme?.count);

// Words separated by only a couple of stopwords may form a phrase; words
// separated by a run of several must not — a stop-word-heavy sentence should
// not glue two unrelated ideas together (PRD §7).
const closeGap = mod.extractThemes([review('r1', 'alpha the beta value here')], { minMentionsFloor: 1 });
check(
  'words separated by one stopword can form a phrase',
  closeGap.some(t => t.terms.some(term => term === 'alpha beta')),
  JSON.stringify(closeGap.map(t => t.terms))
);
const farGap = mod.extractThemes([review('r2', 'alpha and the this for beta value here')], { minMentionsFloor: 1 });
check(
  'words separated by a run of several stopwords do not glue into one phrase',
  !farGap.some(t => t.terms.some(term => term === 'alpha beta')),
  JSON.stringify(farGap.map(t => t.terms))
);

console.log('cluster:insufficient');
check('below the review-count constant, callers should not cluster', mod.MIN_REVIEWS_TO_CLUSTER === 20);

/* ── Text parsing ─────────────────────────────────────────────────────── */

console.log('parse');
check('parses "X out of 5 stars"', mod.parseRatingText('4.0 out of 5 stars') === 4);
check('rounds to the nearest whole star', mod.parseRatingText('4.6 out of 5 stars') === 5);
check('parses a German decimal-comma rating', mod.parseRatingText('4,0 von 5 Sternen') === 4);
check('clamps to 1-5', mod.parseRatingText('0.2 out of 5 stars') === 1);
check('returns null for unreadable text', mod.parseRatingText('no rating here') === null);

check('parses a digit helpful-votes statement', mod.parseHelpfulVotes('12 people found this helpful') === 12);
check('parses the singular "One person" case', mod.parseHelpfulVotes('One person found this helpful') === 1);
check('defaults to 0 when there is nothing to parse', mod.parseHelpfulVotes('') === 0);

const parsedDate = mod.parseReviewDate('Reviewed in the United States on January 5, 2024');
check('parses a US-style review date to ISO', parsedDate.iso === '2024-01-05', parsedDate.iso);
check('captures the review country', parsedDate.country === 'the United States', parsedDate.country);
const ukDate = mod.parseReviewDate('Reviewed in the United Kingdom on 5 January 2024');
check('parses a UK-style day-first date', ukDate.iso === '2024-01-05', ukDate.iso);
check('an unparsable date yields a null iso, not a throw', mod.parseReviewDate('Reviewed in Germany on 5. Januar 2024').iso === null);

check('parses an ASIN from a /dp/ URL', mod.parseAsin('https://www.amazon.com/Some-Title/dp/B08N5WRWNW/ref=sr_1_1') === 'B08N5WRWNW');
check('parses an ASIN from a /product-reviews/ URL', mod.parseAsin('https://www.amazon.co.uk/product-reviews/B08N5WRWNW') === 'B08N5WRWNW');
check('returns null when there is no ASIN in the URL', mod.parseAsin('https://www.amazon.com/gp/cart/view.html') === null);

check('hashId is stable for the same input', mod.hashId('a|b|c') === mod.hashId('a|b|c'));
check('hashId differs for different input', mod.hashId('a|b|c') !== mod.hashId('a|b|d'));

check(
  'buildFilename follows the {asin} - {title}.{ext} convention',
  mod.buildFilename('Great Widget', 'B08N5WRWNW', 'csv') === 'B08N5WRWNW - Great Widget.csv'
);
check('buildFilename strips filesystem-hostile characters', !/[\\/:*?"<>|]/.test(mod.buildFilename('A/B: "Test"', 'B08N5WRWNW', 'md')));
const longName = mod.buildFilename('x'.repeat(400), 'B08N5WRWNW', 'csv');
check('buildFilename truncates to 120 characters', longName.length <= 120, longName.length);

/* ── Filtering & analysis ─────────────────────────────────────────────── */

console.log('analyze');

function fakeReview(overrides) {
  return {
    id: overrides.id ?? 'r',
    rating: 5,
    title: '',
    text: 'Fine.',
    dateRaw: '',
    dateIso: null,
    verified: true,
    variation: '',
    language: 'latin',
    mediaOnly: false,
    helpfulVotes: 0,
    ...overrides,
  };
}

const filterFixture = [
  fakeReview({ id: 'a', rating: 1, verified: true, dateIso: '2024-01-01', text: 'battery dies' }),
  fakeReview({ id: 'b', rating: 5, verified: false, dateIso: '2024-06-01', text: 'great battery' }),
  fakeReview({ id: 'c', rating: 3, verified: true, dateIso: '2024-03-01', text: 'ok product' }),
];

check(
  'star band filter keeps only that band',
  mod.applyFilters(filterFixture, { starBand: 1, verifiedOnly: false, keyword: '', dateFrom: '', dateTo: '' }).length === 1
);
check(
  'verifiedOnly drops unverified reviews',
  mod.applyFilters(filterFixture, { starBand: 0, verifiedOnly: true, keyword: '', dateFrom: '', dateTo: '' }).length === 2
);
check(
  'keyword filter matches review text case-insensitively',
  mod.applyFilters(filterFixture, { starBand: 0, verifiedOnly: false, keyword: 'BATTERY', dateFrom: '', dateTo: '' }).length === 2
);
check(
  'date range filter excludes reviews outside it',
  mod.applyFilters(filterFixture, { starBand: 0, verifiedOnly: false, keyword: '', dateFrom: '2024-02-01', dateTo: '2024-12-31' }).length === 2
);

const summary = mod.summarize(filterFixture);
check('summarize counts negative (1-2*) reviews', summary.negativeCount === 1);
check('summarize counts positive (4-5*) reviews', summary.positiveCount === 1);
check('summarize counts neutral (3*) reviews', summary.neutralCount === 1);
check('summarize buckets by language', summary.languages.latin === 3);

const mediaOnly = fakeReview({ id: 'm', rating: 1, text: '', mediaOnly: true });
const withMedia = [...filterFixture, mediaOnly];
const mediaSummary = mod.summarize(withMedia);
check('a media-only review still counts toward the totals', mediaSummary.totalReviews === 4 && mediaSummary.negativeCount === 2);

// A review with no text (image/video only, PRD §7) must never contribute
// evidence to a theme, however common its id might otherwise look.
const textlessThemes = mod.extractThemes([...batteryReviews, review('m', '')], { minMentionsFloor: 1 });
check(
  'a review with empty text is skipped by the clusterer entirely',
  !textlessThemes.some(t => t.reviewIds.includes('m'))
);

const tinyBand = mod.analyze(Array.from({ length: 10 }, (_, i) => fakeReview({ id: `t${i}`, rating: 1, text: 'meh' })));
check('a band under 20 reviews is marked insufficient rather than clustered', tinyBand.every(r => r.band !== 'negative' || r.insufficient));

/* ── Exports ──────────────────────────────────────────────────────────── */

console.log('formatters');

const themeA = { id: 't1', label: 'battery / charge / dies', terms: ['battery', 'charg', 'die'], count: 18, reviewIds: ['bat0'] };
const themeB = { id: 't2', label: 'easy setup', terms: ['easy', 'setup'], count: 20, reviewIds: ['p0'] };
const reviewsById = new Map([
  ['bat0', fakeReview({ id: 'bat0', rating: 1, text: 'The battery just dies constantly, super frustrating for the price.' })],
  ['p0', fakeReview({ id: 'p0', rating: 5, text: 'Setup was so easy, took two minutes flat.' })],
]);

const results = [
  { language: 'latin', band: 'negative', reviewsInBand: 47, themes: [themeA], insufficient: false },
  { language: 'latin', band: 'praise', reviewsInBand: 25, themes: [themeB], insufficient: false },
];

const csv = mod.toCsv(results, reviewsById);
check('csv has the required header row', csv.startsWith('theme,count,star band,example review'));
check('csv includes a negative row with the 1-2* band', csv.includes('battery / charge / dies,18,1-2★'));
check('csv includes a praise row with the 4-5* band', csv.includes('easy setup,20,4-5★'));
check('csv quotes a field containing a comma', mod.toCsv(
  [{ language: 'latin', band: 'negative', reviewsInBand: 20, insufficient: false, themes: [{ ...themeA, label: 'a, b' }] }],
  reviewsById
).includes('"a, b"'));

const md = mod.toMarkdown({
  asin: 'B08N5WRWNW',
  productTitle: 'Great Widget',
  productUrl: 'https://www.amazon.com/dp/B08N5WRWNW',
  domain: 'amazon.com',
  totalReviews: 72,
  negativeCount: 47,
  positiveCount: 25,
  hasMorePages: true,
  note: 'Worth a closer look at the strap supplier.',
  results,
  reviewsById,
  previousSnapshot: { date: '2024-01-01', totalReviews: 40, negativeCount: 30, themeCounts: { [mod.themeKey(themeA)]: 12 } },
  generatedAt: '2024-02-01',
});
check('markdown opens with a teardown heading', md.startsWith('# Review teardown'));
check('markdown carries the ASIN', md.includes('B08N5WRWNW'));
check('markdown states more pages are available', md.includes('scroll or open more pages'));
check('markdown carries the user note', md.includes('Worth a closer look at the strap supplier.'));
check('markdown shows the delta since the previous snapshot', md.includes('up from 12 to 18'));
check('markdown includes evidence under each theme', md.includes('battery just dies'));

check('themeKey ignores term order', mod.themeKey({ terms: ['b', 'a'] }) === mod.themeKey({ terms: ['a', 'b'] }));

const insufficientResults = [{ language: 'latin', band: 'negative', reviewsInBand: 5, themes: [], insufficient: true }];
const insufficientMd = mod.toMarkdown({
  asin: 'B0X', productTitle: 'Tiny', productUrl: '', domain: '', totalReviews: 5, negativeCount: 5, positiveCount: 0,
  hasMorePages: false, note: '', results: insufficientResults, reviewsById: new Map(), previousSnapshot: null, generatedAt: '2024-02-01',
});
check('markdown says plainly when there is not enough to cluster', /not enough/i.test(insufficientMd));

fs.rmSync(entry, { force: true });
fs.rmSync(bundlePath, { force: true });

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
