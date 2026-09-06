/**
 * Headless checks for the pure logic: number/text parsing, per-author median
 * baseline (including the runaway-post exclusion), band thresholds, ratio
 * scoring, filters/sort, the two export formats, filenames, and page-mode
 * detection. The DOM-bound half (dom.ts, badges.ts, bar.ts, content.ts
 * wiring) needs a real, logged-in LinkedIn session and is covered by the
 * manual checklist in README.md instead.
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

const entry = path.join(os.tmpdir(), `lpo-selftest-${process.pid}.mjs`);
fs.writeFileSync(
  entry,
  ['outlier.ts', 'text.ts', 'filters.ts', 'formatters.ts']
    .map(file => `export * from ${JSON.stringify(path.join(rootDir, 'src', file).replace(/\\/g, '/'))};`)
    .join('\n')
);

const bundlePath = path.join(os.tmpdir(), `lpo-selftest-bundle-${process.pid}.mjs`);
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

/* ── No network calls anywhere in the source (portfolio-wide legal posture) ─ */

console.log('no network calls');
{
  const forbidden = [
    ['f' + 'etch(', /f[e]tch\(/],
    ['XMLHttpRequest' + '(', /XMLHttpRequest\(/],
    ['.sendBeacon' + '(', /\.sendBeacon\(/],
    ['new WebSocket' + '(', /new WebSocket\(/],
  ];
  const srcDir = path.join(rootDir, 'src');
  const files = fs.readdirSync(srcDir).filter(f => f.endsWith('.ts'));
  let hit = null;
  for (const file of files) {
    const text = fs.readFileSync(path.join(srcDir, file), 'utf8');
    for (const [label, pattern] of forbidden) {
      if (pattern.test(text)) hit = `${label} in ${file}`;
    }
  }
  check('no fetch/XHR/sendBeacon/WebSocket call anywhere in src/', hit === null, hit ?? undefined);
}

/* ── Number / text parsing ──────────────────────────────────────────── */

console.log('parsing');
check('parseCompactNumber parses a plain integer', mod.parseCompactNumber('1234') === 1234);
check('parseCompactNumber parses a K suffix', mod.parseCompactNumber('12.3K') === 12300);
check('parseCompactNumber returns null for garbage', mod.parseCompactNumber('n/a') === null);
check('formatCompact formats thousands compactly', mod.formatCompact(12345) === '12.3K');
check('formatCompact trims a trailing .0', mod.formatCompact(2000) === '2K');

check('parseCount handles a plain integer', mod.parseCount('123') === 123);
check('parseCount handles a thousands separator', mod.parseCount('1,234') === 1234);
check('parseCount handles a K suffix', mod.parseCount('1.2K') === 1200);
check('parseCount handles an M suffix', mod.parseCount('3.4M') === 3400000);
check('parseCount extracts digits from a noisy string', mod.parseCount('1,234 reactions') === 1234);
check('parseCount returns 0 for empty input', mod.parseCount('') === 0);
check('parseCount returns 0 for missing input', mod.parseCount(null) === 0);

const counts = mod.extractCounts('62 reactions · 11 comments · 3 reposts');
check('extractCounts reads reactions', counts.reactions === 62);
check('extractCounts reads comments', counts.comments === 11);
check('extractCounts reads reposts', counts.reposts === 3);
check('extractCounts returns null (not 0) for a field never seen in the block', mod.extractCounts('no numbers here').reactions === null);

const now = Date.UTC(2026, 8, 2);
check('parseRelativeTime handles days', mod.parseRelativeTime('2d', now) === now - 2 * 86400000);
check('parseRelativeTime handles weeks', mod.parseRelativeTime('1w', now) === now - 7 * 86400000);
check('parseRelativeTime handles a label with extra text', mod.parseRelativeTime('Edited • 3mo', now) === now - 3 * 30 * 86400000);
check('parseRelativeTime returns null for an unparseable label', mod.parseRelativeTime('Just now', now) === null);
check('parseRelativeTime returns null for missing input', mod.parseRelativeTime(null, now) === null);

check('truncateText leaves short text alone', mod.truncateText('hello') === 'hello');
check('truncateText collapses whitespace', mod.truncateText('a   b\n\nc') === 'a b c');
check('truncateText caps length with an ellipsis', mod.truncateText('x'.repeat(500), 10).length === 11);

check(
  'normalizeProfileUrl strips query/casing variance to one canonical id',
  mod.normalizeProfileUrl('https://www.linkedin.com/in/JohnDoe/?trk=abc') === 'https://www.linkedin.com/in/JohnDoe'
);
check(
  'normalizeProfileUrl handles a relative href',
  mod.normalizeProfileUrl('/in/janedoe/') === 'https://www.linkedin.com/in/janedoe'
);
check(
  'normalizePostUrl strips tracking query params',
  mod.normalizePostUrl('https://www.linkedin.com/posts/johndoe_abc-activity-123?utm_source=x') ===
    'https://www.linkedin.com/posts/johndoe_abc-activity-123'
);

check('pageModeFor recognizes a profile history page', mod.pageModeFor('/in/johndoe/recent-activity/all/') === 'profile');
check('pageModeFor recognizes a hashtag page', mod.pageModeFor('/feed/hashtag/marketing/') === 'mixed');
check('pageModeFor recognizes a content search page', mod.pageModeFor('/search/results/content/') === 'mixed');
check('pageModeFor rejects the main feed', mod.pageModeFor('/feed/') === 'unsupported');
check('pageModeFor rejects a bare profile page (not its activity tab)', mod.pageModeFor('/in/johndoe/') === 'unsupported');

/* ── Median / robust median (runaway-post exclusion) ──────────────────── */

console.log('median');
check('median of an odd list', mod.median([1, 5, 3]) === 3);
check('median of an even list averages the middle pair', mod.median([1, 2, 3, 4]) === 3);
check('median of an empty list is null', mod.median([]) === null);

{
  const normal = [10, 12, 9, 11, 10, 13, 8];
  const { median: m, excludedCount } = mod.robustMedian(normal);
  check('robustMedian leaves a normal spread untouched', excludedCount === 0);
  check('robustMedian matches a plain median when nothing is excluded', m === mod.median(normal));
}
{
  const withOutlier = [10, 12, 9, 11, 10, 500]; // 500 is a runaway post far past 15x the ~10.5 preliminary median
  const { median: m, excludedCount } = mod.robustMedian(withOutlier);
  check('robustMedian excludes a runaway post from the calculation', excludedCount === 1);
  check('robustMedian result stays close to the non-outlier values', m <= 12, m);
}
{
  const allZero = [0, 0, 0];
  const { median: m, excludedCount } = mod.robustMedian(allZero);
  check('robustMedian never divides by a zero preliminary median', excludedCount === 0 && m === 0);
}
{
  const { median: m, excludedCount } = mod.robustMedian([]);
  check('robustMedian of an empty list is null with nothing excluded', m === null && excludedCount === 0);
}

/* ── Per-author baseline ────────────────────────────────────────────── */

console.log('author baselines');

function rawPost(overrides = {}) {
  return {
    id: 'x',
    authorId: 'https://www.linkedin.com/in/author',
    authorName: 'Author',
    authorHeadline: '',
    postType: 'text',
    isRepost: false,
    pinned: false,
    reactions: null,
    comments: null,
    reposts: null,
    postedAt: null,
    postedAtLabel: '',
    url: '',
    ...overrides,
  };
}

{
  const fivePosts = Array.from({ length: 5 }, (_, i) =>
    rawPost({ id: `p${i}`, reactions: 20 + i, comments: 5, postedAt: i })
  );
  const baselines = mod.computeAuthorBaselines(fivePosts, new Map());
  const baseline = baselines.get('https://www.linkedin.com/in/author');
  check('5 live posts is reliable (the documented floor)', baseline.reliable === true);
  check('baseline source is "live" when the live sample meets the floor', baseline.source === 'live');
}

{
  const fourPosts = Array.from({ length: 4 }, (_, i) => rawPost({ id: `p${i}`, reactions: 20, comments: 5 }));
  const baselines = mod.computeAuthorBaselines(fourPosts, new Map());
  const baseline = baselines.get('https://www.linkedin.com/in/author');
  check('4 live posts (below the floor) is not reliable with no cache to fall back on', baseline.reliable === false);
  check('an unreliable baseline has source "none"', baseline.source === 'none');
}

{
  const twoPosts = [rawPost({ id: 'a', reactions: 20, comments: 5 }), rawPost({ id: 'b', reactions: 30, comments: 5 })];
  const cache = new Map([
    ['https://www.linkedin.com/in/author', { authorId: 'https://www.linkedin.com/in/author', authorName: 'Author', median: 40, sampleSize: 9, computedAt: Date.now() }],
  ]);
  const baselines = mod.computeAuthorBaselines(twoPosts, cache);
  const baseline = baselines.get('https://www.linkedin.com/in/author');
  check('a thin live sample falls back to a cached reliable median', baseline.reliable === true && baseline.source === 'cached');
  check('the cached median value is used, not a guess from the thin live sample', baseline.median === 40);
}

{
  const withPin = [
    ...Array.from({ length: 5 }, (_, i) => rawPost({ id: `p${i}`, reactions: 20, comments: 5 })),
    rawPost({ id: 'pinned', reactions: 5000, comments: 500, pinned: true }),
  ];
  const baselines = mod.computeAuthorBaselines(withPin, new Map());
  const baseline = baselines.get('https://www.linkedin.com/in/author');
  check('a pinned/featured post is excluded from the median calculation', baseline.median === 25);
}

/* ── Bands ───────────────────────────────────────────────────────────── */

console.log('bands');
check('5x is the top fire band', mod.bandFor(5) === 'fire5');
check('2x is the second fire band', mod.bandFor(2) === 'fire2');
check('1.5x is the up band', mod.bandFor(1.5) === 'up');
check('1.49x is flat', mod.bandFor(1.49) === 'flat');
check('fire glyph is used for both fire bands', mod.bandGlyph('fire5') === mod.bandGlyph('fire2'));
check('up band has its own glyph', mod.bandGlyph('up') === '↑');

/* ── Scoring ─────────────────────────────────────────────────────────── */

console.log('scoring');

{
  const baseline = { authorId: 'a', median: 30, sampleSize: 8, excludedAsOutliers: 0, reliable: true, source: 'live', cachedAt: null };
  const scored = mod.scorePost(rawPost({ id: 'v', reactions: 100, comments: 26 }), baseline);
  check('engagement is reactions + comments (unweighted)', scored.engagement === 126);
  check('ratio is engagement over the author median', Math.abs(scored.ratio - 126 / 30) < 1e-9);
  check('4.2x lands in the second fire band (fire5 needs 5x+)', scored.band === 'fire2');
  check('ratio label has no denominator suffix (unlike a views/likes-source engine)', scored.ratioLabel === '4.2×');
}

{
  const capBaseline = { authorId: 'a', median: 10, sampleSize: 8, excludedAsOutliers: 0, reliable: true, source: 'live', cachedAt: null };
  const scored = mod.scorePost(rawPost({ id: 'c', reactions: 400, comments: 50 }), capBaseline);
  check('a 45x outlier is capped for display at 20x+', scored.displayRatio === 20 && scored.ratioCapped === true);
  check('the capped label reads "20×+"', scored.ratioLabel === '20×+');
  check('the true ratio is preserved for sorting/export despite the capped display', scored.ratio > 40);
}

{
  const scored = mod.scorePost(rawPost({ id: 'none', reactions: null, comments: null }), { authorId: 'a', median: 30, sampleSize: 8, excludedAsOutliers: 0, reliable: true, source: 'live', cachedAt: null });
  check('a post with no readable engagement is unrated, never a false zero', scored.engagement === null && scored.band === 'unrated' && scored.ratio === null);
}

{
  const scored = mod.scorePost(rawPost({ id: 'thin', reactions: 50, comments: 5 }), { authorId: 'a', median: null, sampleSize: 2, excludedAsOutliers: 0, reliable: false, source: 'none', cachedAt: null });
  check('an engagement number with no reliable baseline is unrated, not a false ratio', scored.ratio === null && scored.band === 'unrated');
  check('the pending baseline sample size still reaches the badge for a "not enough yet" message', scored.baselineSampleSize === 2);
}

/* ── Filters & sort ──────────────────────────────────────────────────── */

console.log('filters');

const nowMs = 1_000_000_000_000;
const DAY = 24 * 60 * 60 * 1000;
const scoredPosts = [
  { ...rawPost({ id: 'r1', postedAt: nowMs - 5 * DAY }), engagement: 90, ratio: 6, band: 'fire5', ratioLabel: '6.0×', displayRatio: 6, ratioCapped: false, baselineSampleSize: 8, baselineSource: 'live' },
  { ...rawPost({ id: 'p1', postedAt: nowMs - 40 * DAY }), engagement: 40, ratio: 2.5, band: 'fire2', ratioLabel: '2.5×', displayRatio: 2.5, ratioCapped: false, baselineSampleSize: 8, baselineSource: 'live' },
  { ...rawPost({ id: 'p2', postedAt: null }), engagement: null, ratio: null, band: 'unrated', ratioLabel: '', displayRatio: null, ratioCapped: false, baselineSampleSize: 0, baselineSource: 'none' },
];

check('an unknown ratio always passes a ratio filter', mod.matchesFilter(scoredPosts[2], { ratio: '5x', days: null, sort: 'ratio' }, nowMs));
check('a 2.5x post fails a >5x filter', !mod.matchesFilter(scoredPosts[1], { ratio: '5x', days: null, sort: 'ratio' }, nowMs));
check('a 6x post passes a >5x filter', mod.matchesFilter(scoredPosts[0], { ratio: '5x', days: null, sort: 'ratio' }, nowMs));
check('a post older than the window is excluded', !mod.matchesFilter(scoredPosts[1], { ratio: 'all', days: 30, sort: 'ratio' }, nowMs));
check('an unknown date always passes a days filter', mod.matchesFilter(scoredPosts[2], { ratio: 'all', days: 30, sort: 'ratio' }, nowMs));

const sorted = mod.visibleSet(scoredPosts, { ratio: 'all', days: null, sort: 'ratio' }, nowMs);
check('sorting by ratio puts the highest first', sorted[0].id === 'r1');
check('a null ratio sinks to the bottom rather than sorting as zero', sorted[sorted.length - 1].id === 'p2');

const sortedByEngagement = mod.visibleSet(scoredPosts, { ratio: 'all', days: null, sort: 'engagement' }, nowMs);
check('sorting by engagement puts the highest raw number first', sortedByEngagement[0].id === 'r1');

/* ── Export formats ──────────────────────────────────────────────────── */

console.log('exports');

const exportPosts = [
  {
    id: 'a', authorId: 'https://www.linkedin.com/in/alice', authorName: 'Alice', authorHeadline: '', postType: 'text',
    isRepost: false, pinned: false, reactions: 120, comments: 30, reposts: 5, postedAt: Date.UTC(2026, 0, 15), postedAtLabel: '3mo',
    url: 'https://www.linkedin.com/posts/alice_x-activity-1', engagement: 150, ratio: 4.2, displayRatio: 4.2, ratioCapped: false, band: 'fire5', ratioLabel: '4.2×', baselineSampleSize: 8, baselineSource: 'live',
  },
  {
    id: 'b', authorId: 'https://www.linkedin.com/in/bob', authorName: 'Bob, Repost Case', authorHeadline: '', postType: 'document',
    isRepost: true, pinned: false, reactions: 10, comments: 2, reposts: 0, postedAt: Date.UTC(2026, 0, 10), postedAtLabel: '3mo',
    url: 'https://www.linkedin.com/posts/bob_x-activity-2', engagement: 12, ratio: null, displayRatio: null, ratioCapped: false, band: 'unrated', ratioLabel: '', baselineSampleSize: 1, baselineSource: 'none',
  },
];

const csv = mod.toCsv(exportPosts);
const csvLines = csv.trim().split('\r\n');
check(
  'csv header matches the documented columns',
  csvLines[0] === 'author,authorProfileUrl,postUrl,postType,date,reactions,comments,reposts,engagement,ratio,isRepost'
);
check('csv has one row per post', csvLines.length === 1 + exportPosts.length);
check('csv carries the engagement number', csvLines[1].includes('150'));
check('csv marks a repost distinctly', csvLines[2].includes('yes'));
check('a value containing a comma is quoted', csv.includes('"Bob, Repost Case"'));

const md = mod.toMarkdown('alice', 'profile', exportPosts);
check('markdown names the export', md.includes('alice'));
check('markdown includes a table row per post', md.includes('text') && md.includes('document'));
check('markdown mentions the mixed-page caveat only on a mixed page', !md.includes('cached from a profile visit'));

const mdMixed = mod.toMarkdown('marketing', 'mixed', exportPosts);
check('a mixed-mode export explains the pending/cached distinction', mdMixed.includes('cached'));

const filename = mod.buildFilename('johndoe', 'csv', new Date(Date.UTC(2026, 8, 2)));
check('filename follows the {slug}-outliers-{date}.{ext} convention', filename === 'johndoe-outliers-2026-09-02.csv', filename);
check('filename has no path-hostile characters', !/[\\/:*?"<>|]/.test(filename));

const dirtyFilename = mod.buildFilename('weird/../slug*?', 'md', new Date(Date.UTC(2026, 8, 2)));
check('a hostile slug is sanitized rather than passed through', !/[\\/:*?"<>|]/.test(dirtyFilename));

fs.rmSync(entry, { force: true });
fs.rmSync(bundlePath, { force: true });

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
