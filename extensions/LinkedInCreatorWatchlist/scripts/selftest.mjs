/**
 * Headless checks for the pure logic: count/date parsing, the outlier engine,
 * and CSV/Markdown export. This is everything that does not need a DOM — see
 * README.md's manual test checklist for the LinkedIn-DOM-bound half
 * (src/content.ts), which needs a real browser and a real feed.
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

const entry = path.join(os.tmpdir(), `lcw-selftest-${process.pid}.mjs`);
fs.writeFileSync(
  entry,
  ['text.ts', 'outliers.ts', 'export.ts']
    .map(file => `export * from ${JSON.stringify(path.join(rootDir, 'src', file).replace(/\\/g, '/'))};`)
    .join('\n')
);

const bundlePath = path.join(os.tmpdir(), `lcw-selftest-bundle-${process.pid}.mjs`);
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

/* ── Count parsing ───────────────────────────────────────────────────── */

console.log('parseCount');
check('plain integer', mod.parseCount('12') === 12);
check('thousands separator', mod.parseCount('1,234') === 1234);
check('K suffix', mod.parseCount('1.2K') === 1200);
check('lowercase k suffix', mod.parseCount('3k') === 3000);
check('M suffix', mod.parseCount('3.4M') === 3400000);
check('empty string is zero', mod.parseCount('') === 0);
check('null is zero', mod.parseCount(null) === 0);
check('digits inside noisy text', mod.parseCount('45 reactions') === 45, mod.parseCount('45 reactions'));
check('unparseable text is zero', mod.parseCount('reacted') === 0);

console.log('extractCounts');
const counts = mod.extractCounts('1,234 reactions  ·  56 comments  ·  7 reposts');
check('reactions extracted', counts.reactions === 1234);
check('comments extracted', counts.comments === 56);
check('reposts extracted', counts.reposts === 7);
const partial = mod.extractCounts('900 likes');
check('missing counts default to zero', partial.reactions === 900 && partial.comments === 0 && partial.reposts === 0);
const kCounts = mod.extractCounts('1.5K reactions 200 comments');
check('K-suffixed reactions in a sentence', kCounts.reactions === 1500);

/* ── Relative time parsing ──────────────────────────────────────────── */

console.log('parseRelativeTime');
const now = new Date('2026-09-02T00:00:00.000Z').getTime();
check('days ago', mod.parseRelativeTime('2d', now) === now - 2 * 86_400_000);
check('weeks ago', mod.parseRelativeTime('1w •', now) === now - 7 * 86_400_000);
check('months ago with edited prefix', mod.parseRelativeTime('Edited • 3mo', now) === now - 3 * 30 * 86_400_000);
check('hours ago', mod.parseRelativeTime('5h', now) === now - 5 * 3_600_000);
check('unparseable label is null', mod.parseRelativeTime('Just now', now) === null);
check('empty label is null', mod.parseRelativeTime('', now) === null);

/* ── Text helpers ────────────────────────────────────────────────────── */

console.log('truncateText / previewFor');
check('short text is untouched', mod.truncateText('hello world') === 'hello world');
const long = mod.truncateText('a'.repeat(500), 400);
check('long text is capped', long.length === 401, `${long.length}`); // 400 chars + ellipsis
check('long text ends with an ellipsis', long.endsWith('…'));
check('whitespace collapses', mod.truncateText('a\n\n  b   c') === 'a b c');

check('text post keeps empty preview as empty', mod.previewFor('', 'text') === '');
check('document post without text gets a label', mod.previewFor('', 'document').includes('Document'));
check('post with real text ignores the fallback', mod.previewFor('  hello  ', 'video') === 'hello');
// Non-English text must survive untouched (PRD §7).
check('non-English text is preserved', mod.previewFor('こんにちは、世界', 'text') === 'こんにちは、世界');

console.log('URL normalization');
check(
  'profile URL drops query and trailing slash',
  mod.normalizeProfileUrl('https://www.linkedin.com/in/janedoe/?trk=abc') === 'https://www.linkedin.com/in/janedoe'
);
check('relative profile path resolves', mod.normalizeProfileUrl('/in/johndoe') === 'https://www.linkedin.com/in/johndoe');
check(
  'post URL drops query and fragment',
  mod.normalizePostUrl('https://www.linkedin.com/feed/update/urn:li:activity:123/?utm=x#comments') ===
    'https://www.linkedin.com/feed/update/urn:li:activity:123'
);

/* ── Outlier engine ──────────────────────────────────────────────────── */

console.log('outliers');
check('median of odd list', mod.median([1, 5, 3]) === 3);
check('median of even list', mod.median([1, 2, 3, 4]) === 2.5);
check('median of empty list is zero', mod.median([]) === 0);
check('engagement sums the three counts', mod.engagement({ reactions: 10, comments: 2, reposts: 1 }) === 13);

const makePost = (personId, reactions, comments = 0, reposts = 0) => ({
  id: `${personId}-${reactions}-${Math.random()}`,
  personId,
  postType: 'text',
  text: 'x',
  reactions,
  comments,
  reposts,
  seenAsRepost: false,
  url: '',
  postedAt: now,
  postedAtLabel: '1d',
  firstSeenAt: now,
  countsUpdatedAt: now,
  note: '',
});

const tooFew = mod.rateByAuthor([makePost('p1', 10), makePost('p1', 500)]);
check('fewer than 3 posts never gets a ratio (sample-size honesty)', tooFew.every(p => p.ratio === null));

const enough = mod.rateByAuthor([makePost('p1', 10), makePost('p1', 10), makePost('p1', 10), makePost('p1', 100)]);
const outlier = enough.find(p => p.reactions === 100);
check('a clear outlier gets a ratio near 10x', outlier.ratio !== null && Math.abs(outlier.ratio - 10) < 0.01, outlier.ratio);
const baseline = enough.find(p => p.reactions === 10);
check('a baseline post gets a ratio near 1x', baseline.ratio !== null && Math.abs(baseline.ratio - 1) < 0.01);

const zeroBaseline = mod.rateByAuthor([makePost('p2', 0), makePost('p2', 0), makePost('p2', 5)]);
check('a zero-engagement baseline never produces an infinite ratio', zeroBaseline.every(p => p.ratio === null));

const twoAuthors = mod.rateByAuthor([
  makePost('a', 10), makePost('a', 10), makePost('a', 100),
  makePost('b', 1), makePost('b', 1), makePost('b', 1),
]);
check(
  'each author is rated against their own median, not a global one',
  twoAuthors.filter(p => p.personId === 'b').every(p => p.ratio !== null && Math.abs(p.ratio - 1) < 0.01)
);

/* ── Export ──────────────────────────────────────────────────────────── */

console.log('daysSinceLastPost');
const recent = [{ ...makePost('p1', 1), postedAt: now - 2 * 86_400_000, firstSeenAt: now }];
check('recent post is not quiet', mod.daysSinceLastPost(recent, now) === 2);
const quiet = [{ ...makePost('p1', 1), postedAt: now - 45 * 86_400_000, firstSeenAt: now - 45 * 86_400_000 }];
check('old post reports its age in days', mod.daysSinceLastPost(quiet, now) === 45);
check('no posts means no verdict', mod.daysSinceLastPost([], now) === null);

console.log('toCsv');
const person = { id: 'p1', name: 'Jane "The Closer" Doe', headline: 'Sells things', avatarUrl: '', note: 'sharp hooks', watchedAt: now };
const peopleMap = new Map([['p1', person]]);
const ratedPost = { ...makePost('p1', 10, 2, 1), text: 'Contains, a comma', note: 'good one', url: 'https://example.com/post', ratio: 3.456, postedAt: now };
const csv = mod.toCsv(peopleMap, [ratedPost], { includeNotes: true });
const lines = csv.trim().split('\r\n');
check('header row matches PRD §4 columns', lines[0] === 'person,post,reactions,comments,reposts,ratio,date,link,note');
check('a name with quotes is escaped', lines[1].includes('"Jane ""The Closer"" Doe"'));
check('a comma in the text is quoted', lines[1].includes('"Contains, a comma"'));
check('ratio is formatted with an x', lines[1].includes('3.5x'));
const csvNoNotes = mod.toCsv(peopleMap, [ratedPost], { includeNotes: false });
check('notes can be excluded', csvNoNotes.trim().endsWith(','));

console.log('toMarkdown');
const md = mod.toMarkdown([person], new Map([['p1', [ratedPost]]]), { includeNotes: true });
check('one heading per person', md.includes('## Jane "The Closer" Doe'));
check('post count summary line', md.includes("Collected from 1 post you've seen."));
check('person note included', md.includes('sharp hooks'));
check('post note included', md.includes('good one'));
check('post link included', md.includes('https://example.com/post'));
const mdNoNotes = mod.toMarkdown([person], new Map([['p1', [ratedPost]]]), { includeNotes: false });
check('notes can be excluded from markdown', !mdNoNotes.includes('sharp hooks') && !mdNoNotes.includes('good one'));

const quietPerson = { ...person, id: 'p2', name: 'Quiet Creator' };
const quietMd = mod.toMarkdown([quietPerson], new Map([['p2', quiet.map(p => ({ ...p, ratio: null, personId: 'p2' }))]]), {
  includeNotes: true,
});
check('a quiet person is called out (PRD §7)', /No posts seen in \d+ days/.test(quietMd));

const emptyMd = mod.toMarkdown([], new Map(), { includeNotes: true });
check('no one watched exports without throwing', emptyMd.includes('No one is being watched yet'));

const noPostsMd = mod.toMarkdown([person], new Map(), { includeNotes: true });
check('a watched person with nothing collected still gets a section', noPostsMd.includes('## Jane'));
check('empty collection says so', noPostsMd.includes('No posts collected yet'));

console.log('buildFilename');
check('csv filename has the right shape', /^linkedin-watchlist-\d{4}-\d{2}-\d{2}\.csv$/.test(mod.buildFilename('csv')));
check('md filename has the right extension', mod.buildFilename('md').endsWith('.md'));

fs.rmSync(entry, { force: true });
fs.rmSync(bundlePath, { force: true });

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
