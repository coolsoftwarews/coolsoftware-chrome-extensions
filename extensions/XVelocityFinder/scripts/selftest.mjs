/**
 * Headless checks for the pure logic: count parsing, velocity math, badge
 * thresholds, filtering, sorting, the thread heuristic, and the two export
 * formats. Everything DOM-bound (selectors.ts, scan.ts, content.ts) needs a
 * real browser and is covered by the manual checklist in README.md instead.
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

const entry = path.join(os.tmpdir(), `xvf-selftest-${process.pid}.mjs`);
fs.writeFileSync(
  entry,
  ['velocity.ts', 'export.ts']
    .map(file => `export * from ${JSON.stringify(path.join(rootDir, 'src', file).replace(/\\/g, '/'))};`)
    .join('\n')
);

const bundlePath = path.join(os.tmpdir(), `xvf-selftest-bundle-${process.pid}.mjs`);
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

/* ── Count parsing (PRD §7: round-trip abbreviated counts honestly) ────── */

console.log('parseCount');
check('parses a bare integer', mod.parseCount('42')?.value === 42);
check('bare integer is exact, not approx', mod.parseCount('42')?.approx === false);
check('parses thousands separators', mod.parseCount('1,234')?.value === 1234);
check('parses "1.2K"', mod.parseCount('1.2K')?.value === 1200);
check('"1.2K" is flagged approximate', mod.parseCount('1.2K')?.approx === true);
check('parses "3.4M"', mod.parseCount('3.4M')?.value === 3400000);
check('parses "1B"', mod.parseCount('1B')?.value === 1000000000);
check('is case-insensitive', mod.parseCount('2K')?.value === 2000);
check('empty string is null', mod.parseCount('') === null);
check('null input is null', mod.parseCount(null) === null);
check('garbage is null', mod.parseCount('a lot') === null);
check('"0" parses to zero, not null', mod.parseCount('0')?.value === 0);

/* ── Median ──────────────────────────────────────────────────────────── */

console.log('median');
check('median of an odd list', mod.median([1, 5, 3]) === 3);
check('median of an even list', mod.median([1, 2, 3, 4]) === 2.5);
check('median of an empty list is null', mod.median([]) === null);
check('median of a single value', mod.median([7]) === 7);

/* ── Velocity derivation ─────────────────────────────────────────────── */

console.log('deriveMetrics');

const now = Date.parse('2026-09-02T12:00:00Z');
const count = (value, approx = false) => ({ value, approx });

function post(overrides = {}) {
  return {
    id: '1',
    url: 'https://x.com/user/status/1',
    authorHandle: 'user',
    authorName: 'User',
    textPreview: 'hello',
    likes: count(100),
    reposts: count(50),
    replies: count(70),
    publishedAt: now - 2 * 60 * 60 * 1000, // 2h ago
    isAd: false,
    isQuote: false,
    ...overrides,
  };
}

const twoHourOld = mod.deriveMetrics(post(), undefined, now);
check('engagement sums likes + reposts + replies', twoHourOld.engagement === 220);
check('velocity is engagement ÷ hours since posting', twoHourOld.velocityPerHour === 110);
check('age is computed in ms', twoHourOld.ageMs === 2 * 60 * 60 * 1000);
check('no baseline means no ratio', twoHourOld.outlierRatio === null);
check('not flagged too new', twoHourOld.tooNew === false);

const brandNew = mod.deriveMetrics(post({ publishedAt: now - 60 * 1000 }), undefined, now);
check('a 1-minute-old post is too new', brandNew.tooNew === true);
check('too-new posts get no velocity number', brandNew.velocityPerHour === null);

const noTimestamp = mod.deriveMetrics(post({ publishedAt: null }), undefined, now);
check('missing timestamp leaves age null', noTimestamp.ageMs === null);
check('missing timestamp leaves velocity null', noTimestamp.velocityPerHour === null);

const missingCount = mod.deriveMetrics(post({ replies: null }), undefined, now);
check('a missing count leaves engagement null rather than guessing', missingCount.engagement === null);
check('a missing count leaves velocity null', missingCount.velocityPerHour === null);

const zeroEngagement = mod.deriveMetrics(post({ likes: count(0), reposts: count(0), replies: count(0) }), undefined, now);
check('all-zero counts still produce a real (zero) velocity, not null', zeroEngagement.velocityPerHour === 0);

const approxPost = mod.deriveMetrics(post({ likes: count(1200, true) }), undefined, now);
check('an approximate input count marks the whole post approximate', approxPost.approx === true);
check('an exact input count is not approximate', twoHourOld.approx === false);

console.log('updateBaseline / ratio');
let baseline;
for (const v of [80, 90, 100, 110, 120]) baseline = mod.updateBaseline(baseline, 'user', v, now);
check('baseline keeps every sample under the cap', baseline.samples.length === 5);
const withBaseline = mod.deriveMetrics(post(), baseline, now); // velocity 110, median 100
check('ratio is velocity ÷ author median', withBaseline.outlierRatio === 1.1, withBaseline.outlierRatio);

const thinBaseline = mod.updateBaseline(undefined, 'user', 100, now);
const withThinBaseline = mod.deriveMetrics(post(), thinBaseline, now);
check(
  'fewer than MIN_BASELINE_SAMPLES yields no ratio (sample-size honesty)',
  withThinBaseline.outlierRatio === null
);

let capped;
for (let i = 0; i < 30; i++) capped = mod.updateBaseline(capped, 'user', i, now);
check('baseline never grows past its cap', capped.samples.length === 20);
check('the cap keeps the most recent samples', capped.samples[capped.samples.length - 1] === 29);

/* ── Badge text (PRD §4: the exact shape) ───────────────────────────── */

console.log('formatBadge');
check(
  'matches the PRD shape: bolt, velocity, ratio, age',
  mod.formatBadge(withBaseline) === '⚡ 110/h · 1.1× · 2h old',
  mod.formatBadge(withBaseline)
);
check('omits the ratio segment with no baseline', mod.formatBadge(twoHourOld) === '⚡ 110/h · 2h old', mod.formatBadge(twoHourOld));
check('too-new posts say so instead of a wild number', mod.formatBadge(brandNew).startsWith('⚡ too new'));
check('approximate velocity is prefixed with a tilde', mod.formatBadge(approxPost).includes('~'));
check('missing age shows "age unknown" rather than throwing', mod.formatBadge(noTimestamp) === '⚡ age unknown');
check('the formula is stated in the tooltip, not hidden', mod.badgeExplainer(twoHourOld).includes('likes + reposts + replies'));

console.log('ageLabel');
check('minutes', mod.ageLabel(45 * 60 * 1000) === '45m old');
check('hours', mod.ageLabel(2 * 60 * 60 * 1000) === '2h old');
check('days', mod.ageLabel(3 * 24 * 60 * 60 * 1000) === '3d old');
check('just now', mod.ageLabel(1000) === 'just now');

/* ── Filtering ───────────────────────────────────────────────────────── */

console.log('matchesFilters');
const filters = value => ({ minVelocity: null, minRatio: null, ageBand: 'any', mode: 'dim', ...value });

check('no filters matches everything', mod.matchesFilters(twoHourOld, filters()) === true);
check('a velocity floor excludes a slower post', mod.matchesFilters(twoHourOld, filters({ minVelocity: 200 })) === false);
check('a velocity floor keeps a faster post', mod.matchesFilters(twoHourOld, filters({ minVelocity: 50 })) === true);
check(
  'an unknown velocity never satisfies a floor',
  mod.matchesFilters(noTimestamp, filters({ minVelocity: 1 })) === false
);
check('a ratio floor excludes a post below it', mod.matchesFilters(withBaseline, filters({ minRatio: 5 })) === false);
check('an age band excludes an older post', mod.matchesFilters(twoHourOld, filters({ ageBand: '1h' })) === false);
check('an age band keeps a post inside the window', mod.matchesFilters(twoHourOld, filters({ ageBand: '6h' })) === true);
check('hasActiveFilters is false for the defaults', mod.hasActiveFilters(filters()) === false);
check('hasActiveFilters is true once one bound is set', mod.hasActiveFilters(filters({ minVelocity: 1 })) === true);

console.log('compareByVelocity / isThreadContinuation');
const fast = { ...twoHourOld, velocityPerHour: 500 };
const slow = { ...twoHourOld, velocityPerHour: 10 };
const unknown = { ...twoHourOld, velocityPerHour: null };
check('faster sorts first', mod.compareByVelocity(fast, slow) < 0);
check('unknown velocity sinks to the bottom', mod.compareByVelocity(unknown, slow) > 0);
check('a fresh timeline (no previous author) is never a continuation', mod.isThreadContinuation(null, 'alice') === false);
check('same author back-to-back is a thread continuation', mod.isThreadContinuation('alice', 'alice') === true);
check('a different author is not a continuation', mod.isThreadContinuation('alice', 'bob') === false);

/* ── Export ──────────────────────────────────────────────────────────── */

console.log('toCsv / toMarkdown');
const posts = [twoHourOld, withBaseline];

const csv = mod.toCsv(posts);
const csvLines = csv.trim().split('\r\n');
check('csv has a header row plus one row per post', csvLines.length === posts.length + 1);
check('csv header names every PRD-required column', mod.toCsv([]).startsWith('author,text,likes,reposts,replies,velocity_per_hour,outlier_ratio,age,link'));
check('csv rows carry the author handle', csvLines[1].includes('@user'));
check('csv quotes a field containing a comma', mod.toCsv([{ ...twoHourOld, textPreview: 'hello, world' }]).includes('"hello, world"'));

const md = mod.toMarkdown(posts);
check('markdown states the formula up top', md.includes('likes + reposts + replies'));
check('markdown is a table with one row per post', md.split('\n').filter(line => line.startsWith('| @')).length === posts.length);
check('markdown links back to the post', md.includes('[link](https://x.com/user/status/1)'));
check('an empty export still produces a valid document', mod.toMarkdown([]).includes('0 posts'));

console.log('buildFilename');
const filename = mod.buildFilename('timeline', 'csv', new Date('2026-09-02T00:00:00Z'));
check('follows the x-velocity-{scope}-{date}.{ext} convention', filename === 'x-velocity-timeline-2026-09-02.csv', filename);
check('search scope', mod.buildFilename('search', 'md', new Date('2026-09-02T00:00:00Z')) === 'x-velocity-search-2026-09-02.md');

console.log('toDataUrl');
const dataUrl = mod.toDataUrl('a,b\r\n1,2\r\n', 'text/csv');
check('produces a base64 data url with the right mime type', dataUrl.startsWith('data:text/csv;charset=utf-8;base64,'));
const decoded = Buffer.from(dataUrl.split(',')[1], 'base64').toString('utf-8');
check('round-trips the exact text', decoded === 'a,b\r\n1,2\r\n');

fs.rmSync(entry, { force: true });
fs.rmSync(bundlePath, { force: true });

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
