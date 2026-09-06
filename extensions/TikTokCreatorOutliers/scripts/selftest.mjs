/**
 * Headless checks for the pure logic: text parsing, the outlier engine
 * (median/ratio/sample-size honesty), filters/sort, hook-panel observations,
 * and the CSV/Markdown export layer. The DOM-bound half (scan.ts,
 * selectors.ts, badges.ts, panel.ts) needs a real TikTok profile and is
 * covered by the manual checklist in the README.
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

const entry = path.join(os.tmpdir(), `tco-selftest-${process.pid}.mjs`);
fs.writeFileSync(
  entry,
  ['parse.ts', 'outlier.ts', 'filters.ts', 'hooks.ts', 'export.ts', 'types.ts']
    .map(file => `export * from ${JSON.stringify(path.join(rootDir, 'src', file).replace(/\\/g, '/'))};`)
    .join('\n')
);

const bundlePath = path.join(os.tmpdir(), `tco-selftest-bundle-${process.pid}.mjs`);
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
check('parses "24.5K" as 24500', mod.parseCompactNumber('24.5K') === 24500);
check('parses "1.2M" as 1200000', mod.parseCompactNumber('1.2M') === 1200000);
check('parses "3,402" as 3402', mod.parseCompactNumber('3,402') === 3402);
check('parses "274K views" as 274000', mod.parseCompactNumber('274K views') === 274000, mod.parseCompactNumber('274K views'));
check('parses "1.1B" as 1100000000', mod.parseCompactNumber('1.1B') === 1_100_000_000);
check('unreadable text returns null', mod.parseCompactNumber('Pinned') === null);
check('empty input returns null', mod.parseCompactNumber('') === null);

check('parses "0:45" as 45 seconds', mod.parseDurationLabel('0:45') === 45);
check('parses "1:03:20" as 3800 seconds', mod.parseDurationLabel('1:03:20') === 3800);
check('garbage duration returns null', mod.parseDurationLabel('live') === null);

check('parses a video id', mod.parseVideoId('/@creator/video/7123456789012345678') === '7123456789012345678');
check('parses a photo id', mod.parseVideoId('/@creator/photo/7000000000000000001') === '7000000000000000001');
check('href with neither returns null', mod.parseVideoId('/@creator') === null);

check('parses a profile id and lowercases it', mod.parseProfileId('/@Creator.Name') === '@creator.name');
check('no handle returns null', mod.parseProfileId('/foryou') === null);

check('takes the first line of a caption', mod.firstLine('Line one\nLine two') === 'Line one');
check('trims whitespace', mod.firstLine('  spaced  \nrest') === 'spaced');
check('null caption returns null', mod.firstLine(null) === null);
const longCaption = 'x'.repeat(200);
check('truncates a long single-line caption to 140 chars', mod.firstLine(longCaption).length === 140);
check('truncated caption ends with an ellipsis', mod.firstLine(longCaption).endsWith('…'));

check(
  'extracts hashtags, deduplicated and lowercased',
  JSON.stringify(mod.extractHashtags('#FYP great clip #fyp #outlier')) === JSON.stringify(['#fyp', '#outlier'])
);
check('extracts non-Latin hashtags', mod.extractHashtags('本当に #おすすめ です').includes('#おすすめ'));
check('no hashtags returns an empty array', mod.extractHashtags('plain caption').length === 0);

check('a line ending in "?" looks like a question', mod.looksLikeQuestion('Why does this happen?') === true);
check('a line without "?" does not', mod.looksLikeQuestion('This is a statement.') === false);
check('a line starting with a digit looks like a number opener', mod.looksLikeNumberOpener('3 things nobody tells you') === true);
check('a line starting with a letter does not', mod.looksLikeNumberOpener('Three things') === false);

/* ── Outlier engine ──────────────────────────────────────────────────── */

console.log('outlier engine');
check('median of an odd-length list', mod.median([1, 3, 2]) === 2);
check('median of an even-length list', mod.median([1, 2, 3, 4]) === 2.5);
check('median of an empty list is null', mod.median([]) === null);

function video(overrides) {
  return {
    id: overrides.id ?? String(Math.random()),
    href: `/@creator/video/${overrides.id ?? '1'}`,
    views: null,
    captionFirstLine: null,
    hashtags: [],
    durationSeconds: null,
    postedAt: null,
    pinned: false,
    isPhoto: false,
    ...overrides,
  };
}

// 101 identical entries at exactly 10,000 views — the median engine folds the
// "outlier"/"moderate"/"flat"/"one-hit" videos below into this same baseline
// (they're loaded videos too, same as the PRD's own median definition), so a
// large uniform block keeps the median pinned at a known value regardless of
// where those four extremes land once sorted, making the downstream ratios
// (11.4x, 1.9x, 0.6x, 500x) exact rather than approximate.
const baselineViews = Array.from({ length: 101 }, () => 10_000);
const videos = baselineViews.map((views, i) => video({ id: `base-${i}`, views }));
videos.push(video({ id: 'pinned', views: 500_000, pinned: true }));
videos.push(video({ id: 'outlier', views: 114_000 }));
videos.push(video({ id: 'moderate', views: 19_000 }));
videos.push(video({ id: 'flat', views: 6_000 }));
videos.push(video({ id: 'one-hit', views: 5_000_000 }));
videos.push(video({ id: 'no-views', views: null }));

const snapshot = mod.computeSnapshot('@creator', videos);
check('median excludes the pinned video', snapshot.median === 10_000, snapshot.median);
check('sample size excludes the pinned video and the null-view video', snapshot.sampleSize === 105, snapshot.sampleSize);
check('loadedCount counts every tile', snapshot.loadedCount === videos.length);
check('sample of 105 is not flagged low', snapshot.lowSample === false);

const smallSnapshot = mod.computeSnapshot('@small', videos.slice(0, 10));
check('under-12 sample is flagged low', smallSnapshot.lowSample === true, smallSnapshot.sampleSize);

const byId = id => snapshot.videos.find(v => v.id === id);
check('a ~11.4x video badges as fire', byId('outlier').band === 'fire', byId('outlier').ratio);
check('a ~1.9x video badges as up', byId('moderate').band === 'up', byId('moderate').ratio);
check('a ~0.6x video badges as flat', byId('flat').band === 'flat', byId('flat').ratio);
check('a video with no view count badges as unknown', byId('no-views').band === 'unknown');
check('a pinned video still gets a badge of its own', byId('pinned').band === 'fire');

const oneHit = byId('one-hit');
check('a 500x video is capped for display', oneHit.ratioCapped === true, oneHit.ratio);
check('the capped display ratio is exactly the cap', oneHit.displayRatio === 20);
check('formatRatio shows the cap with a plus', mod.formatRatio(oneHit) === '20×+');
check('formatRatio shows one decimal normally', mod.formatRatio(byId('outlier')) === '11.4×');
check('badgeGlyph fire is the fire emoji', mod.badgeGlyph('fire') === '🔥');
check('badgeGlyph flat is a dash', mod.badgeGlyph('flat') === '—');

const emptyMedianSnapshot = mod.computeSnapshot('@empty', [video({ id: 'x', pinned: true, views: 10 })]);
check('a profile with only pinned videos has no median', emptyMedianSnapshot.median === null);

/* ── Filters & sort ──────────────────────────────────────────────────── */

console.log('filters');
const now = Date.parse('2026-09-01T00:00:00Z');
const recent = { ...byId('outlier'), postedAt: now - 5 * 24 * 60 * 60 * 1000, durationSeconds: 12 };
const old = { ...byId('moderate'), postedAt: now - 200 * 24 * 60 * 60 * 1000, durationSeconds: 45 };
const undated = { ...byId('flat'), postedAt: null, durationSeconds: null };

check('>2x filter keeps a 11.4x video', mod.matchesFilters(recent, { ratio: '2x', date: 'all', length: 'all', sort: 'ratio' }, now));
check('>5x filter drops a 1.9x video', !mod.matchesFilters({ ...old, ratio: 1.9 }, { ratio: '5x', date: 'all', length: 'all', sort: 'ratio' }, now));
check('30d filter keeps a video from 5 days ago', mod.matchesFilters(recent, { ratio: 'all', date: '30d', length: 'all', sort: 'ratio' }, now));
check('30d filter drops a video from 200 days ago', !mod.matchesFilters(old, { ratio: 'all', date: '30d', length: 'all', sort: 'ratio' }, now));
check(
  'date filter never excludes a video with an unreadable date',
  mod.matchesFilters(undated, { ratio: 'all', date: '30d', length: 'all', sort: 'ratio' }, now)
);
check('length filter matches the right band', mod.matchesFilters(recent, { ratio: 'all', date: 'all', length: 'under15', sort: 'ratio' }, now));
check('length filter excludes an unreadable duration once active', !mod.matchesFilters(undated, { ratio: 'all', date: 'all', length: 'under15', sort: 'ratio' }, now));
check('lengthBandOf classifies bands', mod.lengthBandOf(10) === 'under15' && mod.lengthBandOf(45) === '30to60' && mod.lengthBandOf(90) === 'over60');

const toSort = [
  video({ id: 'a', views: 100 }),
  video({ id: 'b', views: 300 }),
  video({ id: 'c', views: 200 }),
].map(v => ({ ...v, ratio: v.views / 100 }));
const sortedByViews = mod.sortVideos(toSort, 'views');
check('sortVideos sorts descending by views', sortedByViews.map(v => v.id).join(',') === 'b,c,a');

const ties = [
  { id: 'first', views: 100, ratio: 1 },
  { id: 'second', views: 100, ratio: 1 },
];
check('sortVideos is stable on ties', mod.sortVideos(ties, 'views').map(v => v.id).join(',') === 'first,second');

/* ── Hook panel ──────────────────────────────────────────────────────── */

console.log('hook panel');
const tooFew = mod.computeHookInsights(snapshot.videos.slice(0, 3).map(v => ({ ...v, band: 'fire' })), snapshot.videos);
check('fewer than 8 outliers reports insufficient data', tooFew.sufficientData === false);
check('insufficient data reports the minimum required', tooFew.minimumRequired === mod.MIN_HOOK_SAMPLE);

function outlierVideo(id, caption, hashtags) {
  return video({ id, views: 100_000, captionFirstLine: caption, hashtags: hashtags ?? [] });
}

const outlierSet = [
  outlierVideo('h1', 'Why does nobody talk about this?', ['#outlierhook']),
  outlierVideo('h2', 'How is this still a secret?', ['#outlierhook']),
  outlierVideo('h3', '5 things I wish I knew sooner', ['#outlierhook']),
  outlierVideo('h4', 'This changed everything for me', ['#outlierhook']),
  outlierVideo('h5', 'Wait for it...', ['#outlierhook']),
  outlierVideo('h6', 'You will not believe this', ['#outlierhook']),
  outlierVideo('h7', 'The truth about this trend', ['#outlierhook']),
  outlierVideo('h8', 'Is this even legal?', ['#outlierhook']),
];
const baselineSet = Array.from({ length: 20 }, (_, i) => video({ id: `bl-${i}`, views: 10_000, hashtags: [] }));

const insights = mod.computeHookInsights(outlierSet, baselineSet);
check('8 outliers is sufficient data', insights.sufficientData === true);
check(
  'counts the question-opener pattern honestly',
  insights.observations.some(line => /3 of 8 outliers open with a question/.test(line)),
  insights.observations.join(' | ')
);
check(
  'counts the number-opener pattern',
  insights.observations.some(line => /1 of 8 outliers open with a number/.test(line)),
  insights.observations.join(' | ')
);
check(
  'flags a hashtag common in outliers but rare in the baseline',
  insights.sharedHashtags.some(tag => tag.tag === '#outlierhook' && tag.outlierCount === 8),
  JSON.stringify(insights.sharedHashtags)
);
check('observations are counts, never advice', !insights.observations.some(line => /^(post|try|use|do)\b/i.test(line)));

/* ── Export ──────────────────────────────────────────────────────────── */

console.log('export');
const exportSet = [
  { ...outlierVideo('e1', 'A caption, with a comma', []), views: 274_000, ratio: 11.4, displayRatio: 11.4, ratioCapped: false, band: 'fire', postedAt: Date.parse('2026-08-01') },
  { ...outlierVideo('e2', 'Plain hook', []), views: 46_000, ratio: 1.9, displayRatio: 1.9, ratioCapped: false, band: 'up', postedAt: null },
];

const csv = mod.toCsv(exportSet);
check('csv has a header row', csv.startsWith('Rank,Ratio,Views,Posted,Duration (s),Pinned,Hook,URL'));
check('csv quotes a field containing a comma', csv.includes('"A caption, with a comma"'));
check('csv includes both rows', csv.trimEnd().split('\r\n').length === 3, csv);

const md = mod.toMarkdown('@creator', 24_000, 36, exportSet);
check('markdown opens with the profile heading', md.startsWith('# TikTok outliers — @creator'));
check('markdown carries the median line from PRD §4\'s example shape', md.includes('Median: 24,000 views (of 36 loaded)'));
check('markdown includes a hook column', md.includes('Plain hook'));
check('markdown links back to the source video', md.includes('[↗](/@creator/video/e1)'));

const emptyMd = mod.toMarkdown('@creator', null, 0, []);
check('an empty export never throws and says so', emptyMd.includes('No videos match the current filters.'));

const filename = mod.buildFilename('@creator', 'csv', new Date('2026-09-02T00:00:00Z'));
check('follows the {profile} - tiktok-outliers - {date}.{ext} convention', filename === '@creator - tiktok-outliers - 2026-09-02.csv', filename);
check('drops filesystem-hostile characters', !/[\\/:*?"<>|]/.test(mod.buildFilename('@cre/ator', 'csv')));

const longName = mod.buildFilename('@' + 'x'.repeat(400), 'md');
check('truncates to 120 characters', longName.length <= 120, `${longName.length} chars`);
check('keeps the extension after truncation', longName.endsWith('.md'));

fs.rmSync(entry, { force: true });
fs.rmSync(bundlePath, { force: true });

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
