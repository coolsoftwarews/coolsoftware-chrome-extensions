/**
 * Headless checks for the pure logic: number parsing, the median baseline,
 * band thresholds, ratio scoring, filters/sort, the two export formats,
 * filenames, and the embedded-JSON signal scanner. The DOM-bound half
 * (selectors, scan, badges, bar, content script wiring) needs a real,
 * logged-in Instagram session and is covered by the manual checklist in
 * README.md instead.
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

const entry = path.join(os.tmpdir(), `iof-selftest-${process.pid}.mjs`);
fs.writeFileSync(
  entry,
  ['outlier.ts', 'signals.ts', 'filters.ts', 'formatters.ts', 'selectors.ts']
    .map(file => `export * from ${JSON.stringify(path.join(rootDir, 'src', file).replace(/\\/g, '/'))};`)
    .join('\n')
);

const bundlePath = path.join(os.tmpdir(), `iof-selftest-bundle-${process.pid}.mjs`);
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

/* ── Number parsing ──────────────────────────────────────────────────── */

console.log('parsing');
check('parses a plain integer', mod.parseCompactNumber('1234') === 1234);
check('parses a thousands separator', mod.parseCompactNumber('12,345') === 12345);
check('parses a K suffix', mod.parseCompactNumber('12.3K') === 12300);
check('parses an M suffix', mod.parseCompactNumber('3.1M views') === 3100000);
check('parses a B suffix', mod.parseCompactNumber('1.2B') === 1200000000);
check('is case-insensitive on the suffix', mod.parseCompactNumber('4.5k') === 4500);
check('returns null for garbage', mod.parseCompactNumber('n/a') === null);
check('returns null for empty input', mod.parseCompactNumber('') === null);
check('returns null for missing input', mod.parseCompactNumber(null) === null);

check('formats thousands compactly', mod.formatCompact(12345) === '12.3K');
check('formats millions compactly', mod.formatCompact(1500000) === '1.5M');
check('leaves small numbers alone', mod.formatCompact(999) === '999');
check('trims a trailing .0', mod.formatCompact(2000) === '2K');

/* ── Median ──────────────────────────────────────────────────────────── */

console.log('median');
check('median of an odd list', mod.median([1, 5, 3]) === 3);
check('median of an even list averages the middle pair', mod.median([1, 2, 3, 4]) === 3);
check('median of an empty list is null', mod.median([]) === null);
check('median is order-independent', mod.median([9, 1, 5]) === mod.median([1, 5, 9]));

/* ── Profile baseline ────────────────────────────────────────────────── */

console.log('profile stats');

function post(overrides = {}) {
  return { id: 'x', url: 'https://instagram.com/p/x/', kind: 'post', pinned: false, views: null, likes: null, comments: null, takenAt: null, ...overrides };
}

const twelvePosts = Array.from({ length: 12 }, (_, i) => post({ id: `p${i}`, views: 10000 + i * 1000, takenAt: i }));
const statsReliable = mod.computeProfileStats(twelvePosts);
check('12 loaded posts is reliable', statsReliable.reliable === true);
check('sample size matches the loaded count', statsReliable.viewsSampleSize === 12);

const elevenPosts = twelvePosts.slice(0, 11);
const statsUnreliable = mod.computeProfileStats(elevenPosts);
check('11 loaded posts is not yet reliable', statsUnreliable.reliable === false);

const withPin = [
  ...twelvePosts,
  post({ id: 'pinned', views: 5_000_000, pinned: true, takenAt: -500 }),
];
const statsWithPin = mod.computeProfileStats(withPin);
check('a pinned post is excluded from the median', statsWithPin.viewsMedian === statsReliable.viewsMedian);
check('a pinned post still counts toward totalLoaded', statsWithPin.totalLoaded === 13);
check('a pinned post is excluded from the sample size', statsWithPin.viewsSampleSize === 12);

const dateRangePosts = [post({ id: 'a', takenAt: 1000 }), post({ id: 'b', takenAt: 5000 }), post({ id: 'c', takenAt: 3000 })];
const dateStats = mod.computeProfileStats(dateRangePosts);
check('date range start is the earliest post', dateStats.dateRangeStart === 1000);
check('date range end is the latest post', dateStats.dateRangeEnd === 5000);

/* ── Bands ───────────────────────────────────────────────────────────── */

console.log('bands');
check('5x is the top fire band', mod.bandFor(5) === 'fire5');
check('4.99x is the second fire band', mod.bandFor(4.99) === 'fire2');
check('2x is the second fire band', mod.bandFor(2) === 'fire2');
check('1.99x is the up band', mod.bandFor(1.99) === 'up');
check('1.5x is the up band', mod.bandFor(1.5) === 'up');
check('1.49x is flat', mod.bandFor(1.49) === 'flat');
check('0x is flat', mod.bandFor(0) === 'flat');
check('fire glyph is used for both fire bands', mod.bandGlyph('fire5') === mod.bandGlyph('fire2'));
check('up band has its own glyph', mod.bandGlyph('up') === '↑');
check('flat band renders a dash', mod.bandGlyph('flat') === '—');

/* ── Scoring ─────────────────────────────────────────────────────────── */

console.log('scoring');

const stats = { totalLoaded: 20, viewsSampleSize: 20, viewsMedian: 18000, likesSampleSize: 20, likesMedian: 900, reliable: true, dateRangeStart: 0, dateRangeEnd: 1 };

const viewsPost = post({ id: 'v', views: 156600, likes: 4000 });
const scoredViews = mod.scorePost(viewsPost, stats);
check('prefers views over likes when both are present', scoredViews.metricSource === 'views');
check('computes the ratio against the views median', Math.abs(scoredViews.ratio - 156600 / 18000) < 1e-9);
check('8.7x lands in the top fire band', scoredViews.band === 'fire5');
check('ratio label has no "likes" suffix for a views-based post', !scoredViews.ratioLabel.includes('likes'));

const likesOnlyPost = post({ id: 'l', views: null, likes: 7830 });
const scoredLikes = mod.scorePost(likesOnlyPost, stats);
check('falls back to likes when views are missing', scoredLikes.metricSource === 'likes');
check('the fallback ratio is computed against the likes median, not the views median', Math.abs(scoredLikes.ratio - 7830 / 900) < 1e-9);
check('the like-based badge says so, distinctly', scoredLikes.ratioLabel.endsWith('likes'));

const capPost = post({ id: 'c', views: 18000 * 45 });
const scoredCap = mod.scorePost(capPost, stats);
check('a 45x outlier is capped for display at 20x+', scoredCap.displayRatio === 20 && scoredCap.ratioCapped === true);
check('the capped label reads "20×+"', scoredCap.ratioLabel === '20×+');
check('the true ratio is preserved for sorting/export despite the capped display', scoredCap.ratio > 40);

const noMedianStats = { totalLoaded: 3, viewsSampleSize: 0, viewsMedian: null, likesSampleSize: 0, likesMedian: null, reliable: false, dateRangeStart: null, dateRangeEnd: null };
const unrated = mod.scorePost(post({ id: 'u', views: 500 }), noMedianStats);
check('a post scored with no median at all is unrated, not a false zero', unrated.band === 'unrated' && unrated.ratio === null);

/* ── Filters & sort ──────────────────────────────────────────────────── */

console.log('filters');

const now = 1_000_000_000;
const DAY = 24 * 60 * 60 * 1000;
const scoredPosts = [
  { ...post({ id: 'r1', kind: 'reel', takenAt: now - 5 * DAY }), ratio: 6, band: 'fire5', metricSource: 'views', ratioLabel: '6.0×', displayRatio: 6, ratioCapped: false, views: 60000 },
  { ...post({ id: 'p1', kind: 'post', takenAt: now - 40 * DAY }), ratio: 2.5, band: 'fire2', metricSource: 'views', ratioLabel: '2.5×', displayRatio: 2.5, ratioCapped: false, views: 25000 },
  { ...post({ id: 'p2', kind: 'post', takenAt: null }), ratio: null, band: 'unrated', metricSource: 'unknown', ratioLabel: '', displayRatio: null, ratioCapped: false, views: null },
];

check('an unknown ratio always passes a ratio filter', mod.matchesFilter(scoredPosts[2], { ratio: '5x', kind: 'all', days: null, sort: 'ratio' }, now));
check('a 2.5x post fails a >5x filter', !mod.matchesFilter(scoredPosts[1], { ratio: '5x', kind: 'all', days: null, sort: 'ratio' }, now));
check('a 6x post passes a >5x filter', mod.matchesFilter(scoredPosts[0], { ratio: '5x', kind: 'all', days: null, sort: 'ratio' }, now));
check('the reels filter excludes posts', !mod.matchesFilter(scoredPosts[1], { ratio: 'all', kind: 'reels', days: null, sort: 'ratio' }, now));
check('a post older than the window is excluded', !mod.matchesFilter(scoredPosts[1], { ratio: 'all', kind: 'all', days: 30, sort: 'ratio' }, now));
check('an unknown date always passes a days filter', mod.matchesFilter(scoredPosts[2], { ratio: 'all', kind: 'all', days: 30, sort: 'ratio' }, now));

const sorted = mod.visibleSet(scoredPosts, { ratio: 'all', kind: 'all', days: null, sort: 'ratio' }, now);
check('sorting by ratio puts the highest first', sorted[0].id === 'r1');
check('a null ratio sinks to the bottom rather than sorting as zero', sorted[sorted.length - 1].id === 'p2');

/* ── Export formats ──────────────────────────────────────────────────── */

console.log('exports');

const exportPosts = [
  { id: 'a', url: 'https://www.instagram.com/reel/a/', kind: 'reel', pinned: false, views: 156600, likes: 4200, comments: 88, takenAt: Date.UTC(2026, 0, 15), ratio: 8.7, displayRatio: 8.7, ratioCapped: false, band: 'fire5', metricSource: 'views', ratioLabel: '8.7×' },
  { id: 'b', url: 'https://www.instagram.com/p/b/', kind: 'post', pinned: false, views: null, likes: 900, comments: 10, takenAt: Date.UTC(2026, 0, 10), ratio: 3.2, displayRatio: 3.2, ratioCapped: false, band: 'fire2', metricSource: 'likes', ratioLabel: '3.2× likes' },
];

const csv = mod.toCsv(exportPosts);
const csvLines = csv.trim().split('\r\n');
check('csv header matches the PRD columns', csvLines[0] === 'url,type,date,views,likes,comments,ratio');
check('csv has one row per post', csvLines.length === 1 + exportPosts.length);
check('csv carries the views count', csvLines[1].includes('156600'));
check('csv labels the likes-based ratio distinctly', csvLines[2].includes('likes'));

const commaPost = { ...exportPosts[0], id: 'c', url: 'https://www.instagram.com/reel/c/', kind: 'reel, edited' };
const csvWithComma = mod.toCsv([commaPost]);
check('a value containing a comma is quoted', csvWithComma.includes('"reel, edited"'));

const md = mod.toMarkdown('somecreator', exportPosts, { totalLoaded: 20, viewsSampleSize: 18, viewsMedian: 18000, likesSampleSize: 20, likesMedian: 900, reliable: true, dateRangeStart: Date.UTC(2026, 0, 1), dateRangeEnd: Date.UTC(2026, 0, 20) });
check('markdown names the profile', md.includes('@somecreator'));
check('markdown states the median and its sample size', md.includes('18K views') && md.includes('18 loaded posts'));
check('markdown includes a table row per post', md.includes('reel') && md.includes('post'));
check('markdown does not show the reliability warning when reliable', !md.includes('Keep scrolling'));

const mdUnreliable = mod.toMarkdown('somecreator', [], { totalLoaded: 5, viewsSampleSize: 5, viewsMedian: 4000, likesSampleSize: 0, likesMedian: null, reliable: false, dateRangeStart: null, dateRangeEnd: null });
check('markdown shows the reliability warning below 12 posts', mdUnreliable.includes('Keep scrolling'));

const filename = mod.buildFilename('Some.Creator_99', 'csv', new Date(Date.UTC(2026, 8, 2)));
check('filename follows the {handle}-outliers-{date}.{ext} convention', filename === 'Some.Creator_99-outliers-2026-09-02.csv', filename);
check('filename has no path-hostile characters', !/[\\/:*?"<>|]/.test(filename));

const dirtyFilename = mod.buildFilename('weird/../handle*?', 'md', new Date(Date.UTC(2026, 8, 2)));
check('a hostile handle is sanitized rather than passed through', !/[\\/:*?"<>|]/.test(dirtyFilename));

/* ── Embedded-JSON signal scanner ────────────────────────────────────── */

console.log('json signals');

const scriptA = `window.__data = {"items":[{"shortcode":"ABC123","taken_at_timestamp":1700000000,"video_view_count":156600,"edge_media_preview_like":{"count":4200},"edge_media_to_comment":{"count":88},"is_video":true,"pinned_for_users":[]}]};`;
const signalsA = mod.extractJsonSignals([scriptA]);
const abc = signalsA.get('ABC123');
check('finds a shortcode embedded in a JS assignment', Boolean(abc));
check('reads the view count near the shortcode', abc.views === 156600);
check('reads the like count near the shortcode', abc.likes === 4200);
check('reads the comment count near the shortcode', abc.comments === 88);
check('converts a seconds timestamp to epoch milliseconds', abc.takenAt === 1700000000000);
check('an empty pinned_for_users array reads as not pinned', abc.pinned === false);

const scriptPinned = `{"shortcode":"PIN001","pinned_for_users":[123456]}`;
check('a non-empty pinned_for_users array reads as pinned', mod.extractJsonSignals([scriptPinned]).get('PIN001').pinned === true);

check('an unrelated script yields no signals', mod.extractJsonSignals(['var x = 1;']).size === 0);
check('garbage input never throws', (() => {
  try {
    mod.extractJsonSignals(['{{{ not json at all', null, '']);
    return true;
  } catch {
    return false;
  }
})());

// A shortcode split across two script tags: the second fills in what the first left null.
const scriptViewsOnly = `{"shortcode":"MRG01","video_view_count":9000}`;
const scriptLikesOnly = `{"shortcode":"MRG01","edge_media_preview_like":{"count":300}}`;
const merged = mod.extractJsonSignals([scriptViewsOnly, scriptLikesOnly]).get('MRG01');
check('signals for the same shortcode merge across script tags', merged.views === 9000 && merged.likes === 300);

/* ── Profile path detection ──────────────────────────────────────────── */

console.log('profile paths');
check('a bare handle is a profile path', mod.isProfilePath('/somecreator/'));
check('a permalink is not a profile path', !mod.isProfilePath('/somecreator/p/ABC123/'));
check('/explore/ is never a profile path', !mod.isProfilePath('/explore/'));
check('/reels/ is never a profile path', !mod.isProfilePath('/reels/'));
check('the profile handle is the first path segment', mod.profileHandle('/somecreator/') === 'somecreator');
check('a reserved root has no profile handle', mod.profileHandle('/direct/inbox/') === null);

fs.rmSync(entry, { force: true });
fs.rmSync(bundlePath, { force: true });

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
