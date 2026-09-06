/**
 * Headless checks for the pure logic: the truncation-point calculation,
 * search/filter, and CSV/Markdown export formatting. These are the modules
 * PRD-35's build instructions specifically call out for real test weight.
 * The DOM-bound half (linkedin-dom.ts, content.ts) needs a live LinkedIn page
 * and is covered by the manual checklist in the README instead, same split
 * as this portfolio's other LinkedIn/Reddit extensions.
 *
 * Also enforces this extension's "no network requests anywhere" claim
 * (PRD-35 §6 / PRIVACY.md) by grepping every source file for the APIs that
 * would make one.
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
const srcDir = path.join(rootDir, 'src');

const entry = path.join(os.tmpdir(), `pdb-selftest-${process.pid}.mjs`);
fs.writeFileSync(
  entry,
  ['truncation.ts', 'search.ts', 'exporters.ts', 'text.ts']
    .map(file => `export * from ${JSON.stringify(path.join(srcDir, file).replace(/\\/g, '/'))};`)
    .join('\n')
);

const bundlePath = path.join(os.tmpdir(), `pdb-selftest-bundle-${process.pid}.mjs`);
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

/* ── Truncation ──────────────────────────────────────────────────────── */

console.log('truncation');

const short = 'A short post that easily fits inside the budget.';
const shortResult = mod.analyzeTruncation(short, 'desktop');
check('short text is not truncated', shortResult.truncated === false);
check('visible text equals the whole post when it fits', shortResult.visibleText === short);
check('hidden text is empty when nothing is cut', shortResult.hiddenText === '');

const exactlyAtBudget = 'x'.repeat(mod.DESKTOP_LIMITS.charBudget);
check(
  'a post exactly at the character budget is not truncated',
  mod.analyzeTruncation(exactlyAtBudget, 'desktop').truncated === false
);

const oneOver = 'x'.repeat(mod.DESKTOP_LIMITS.charBudget + 1);
const overResult = mod.analyzeTruncation(oneOver, 'desktop');
check('one character past the budget is truncated', overResult.truncated === true);
check(
  'the cut lands exactly at the budget',
  overResult.cutIndex === mod.DESKTOP_LIMITS.charBudget,
  `cutIndex=${overResult.cutIndex}`
);
check(
  'visible text is exactly the budgeted prefix',
  overResult.visibleText.length === mod.DESKTOP_LIMITS.charBudget
);
check(
  'visible + hidden reconstructs the original text',
  overResult.visibleText + overResult.hiddenText === oneOver
);

check(
  'mobile budget is smaller than desktop',
  mod.MOBILE_LIMITS.charBudget < mod.DESKTOP_LIMITS.charBudget
);

const plainLong = 'x'.repeat(150);
const withEarlyBreaks = 'x'.repeat(20) + '\n'.repeat(6) + 'x'.repeat(124); // same 150 chars, but with 6 newlines
check(
  'a post fits when written as one line at 150 characters',
  mod.analyzeTruncation(plainLong, 'desktop').truncated === false
);
check(
  'the same character count with several early line breaks can truncate sooner',
  mod.analyzeTruncation(withEarlyBreaks, 'desktop').truncated === true
);

const notTruncatedSummary = mod.truncationSummary(mod.analyzeTruncation(short, 'desktop'));
check('the overlay copy always hedges with "approximate"', notTruncatedSummary.toLowerCase().includes('approximate'));
const truncatedSummary = mod.truncationSummary(overResult);
check(
  'the overlay copy names the device when truncated',
  truncatedSummary.includes('desktop')
);

/* ── Search ──────────────────────────────────────────────────────────── */

console.log('search');

const items = [
  { id: '1', kind: 'draft', text: 'A post about hiring your first engineer', tags: ['hiring', 'startups'] },
  { id: '2', kind: 'template', text: 'Hook: ask a question, then answer it yourself', tags: ['hooks'] },
  { id: '3', kind: 'published', text: 'We shipped a new feature this week', tags: ['product'] },
];

check('empty query returns everything', mod.searchItems(items, {}).length === 3);
check(
  'text search is case-insensitive',
  mod.searchItems(items, { query: 'HIRING' }).map(i => i.id).join(',') === '1'
);
check(
  'tag search matches items whose tags include the query',
  mod.searchItems(items, { query: 'hooks' }).map(i => i.id).join(',') === '2'
);
check(
  'kind filter narrows the result set',
  mod.searchItems(items, { kind: 'template' }).map(i => i.id).join(',') === '2'
);
check(
  'exact tag filter only matches that tag',
  mod.searchItems(items, { tag: 'product' }).map(i => i.id).join(',') === '3'
);
check(
  'kind and query combine as AND, not OR',
  mod.searchItems(items, { kind: 'draft', query: 'hook' }).length === 0
);

check(
  'uniqueTags is sorted and deduplicated',
  mod.uniqueTags(items).join(',') === 'hiring,hooks,product,startups'
);

check(
  'parseTags trims, drops empties, and dedupes case-insensitively',
  mod.parseTags(' Hooks, hooks ,, carousels ').join(',') === 'Hooks,carousels'
);

/* ── Export formats ──────────────────────────────────────────────────── */

console.log('exports');

const libraryItems = [
  {
    id: 'a',
    kind: 'draft',
    text: 'Line one\nLine two',
    tags: ['hiring'],
    createdAt: Date.parse('2026-08-01'),
    updatedAt: Date.parse('2026-08-02'),
  },
  {
    id: 'b',
    kind: 'template',
    text: 'A hook, with a comma, and a "quote"',
    tags: ['hooks'],
    createdAt: Date.parse('2026-08-03'),
    updatedAt: Date.parse('2026-08-03'),
  },
  {
    id: 'c',
    kind: 'published',
    text: 'Already live',
    tags: [],
    postUrl: 'https://www.linkedin.com/feed/update/urn:li:activity:1/',
    publishedAtLabel: '2d',
    createdAt: Date.parse('2026-08-04'),
    updatedAt: Date.parse('2026-08-04'),
  },
];

const csv = mod.toCsv(libraryItems);
const csvLines = csv.trim().split('\r\n');
check('CSV has a header plus one row per item', csvLines.length === libraryItems.length + 1);
check('CSV header names the columns', csvLines[0] === 'Type,Text,Tags,Post URL,Published,Created,Updated');
check(
  'a comma-and-quote field is RFC 4180 quoted',
  csvLines[2].includes('"A hook, with a comma, and a ""quote"""')
);
check('a multi-line field is quoted rather than breaking the row', csvLines[1].startsWith('Draft,"Line one'));
check('published rows carry their post URL', csvLines[3].includes('https://www.linkedin.com/feed/update'));

const md = mod.toMarkdown(libraryItems);
check('markdown starts with the product title', md.startsWith('# LinkedIn Post Draft Bank'));
check('markdown labels each item by kind', md.includes('## Draft') && md.includes('## Template') && md.includes('## Published'));
check('markdown quotes multi-line text line by line', md.includes('> Line one\n> Line two'));
check('an empty library exports without throwing', mod.toMarkdown([]).includes('Nothing saved yet'));

const filename = mod.buildFilename('linkedin-post-draft-bank', 'csv', new Date('2026-09-02T00:00:00Z'));
check('filename follows the {prefix} {date}.{ext} convention', filename === 'linkedin-post-draft-bank 2026-09-02.csv', filename);
check('filename drops filesystem-hostile characters', !/[\\/:*?"<>|]/.test(filename));

const longName = mod.buildFilename('x'.repeat(400), 'md', new Date('2026-09-02T00:00:00Z'));
check('long filenames are capped at 120 characters', longName.length <= 120, `${longName.length} chars`);
check('truncated filenames keep their extension', longName.endsWith('.md'));

/* ── Text helpers ────────────────────────────────────────────────────── */

console.log('text');

check(
  'cleanComposerText preserves intentional line breaks',
  mod.cleanComposerText('First line   \n\n\n  Second line') === 'First line\n\nSecond line'
);
check('cleanComposerText collapses horizontal whitespace within a line', mod.cleanComposerText('a    b') === 'a b');
check('cleanText flattens every line break', mod.cleanText('a\nb\nc') === 'a b c');
check('snippet leaves short text alone', mod.snippet('short') === 'short');
check(
  'snippet truncates long text with an ellipsis',
  mod.snippet('x'.repeat(200), 90) === `${'x'.repeat(90)}…`
);

/* ── "No network requests anywhere" claim, enforced ─────────────────── */

console.log('privacy posture');

const NETWORK_PATTERNS = [/fetch\(/, /XMLHttpRequest\(/, /\.sendBeacon\(/, /new WebSocket\(/];
const sourceFiles = fs.readdirSync(srcDir).filter(f => f.endsWith('.ts'));
let networkCallFound = false;
for (const file of sourceFiles) {
  const contents = fs.readFileSync(path.join(srcDir, file), 'utf8');
  for (const pattern of NETWORK_PATTERNS) {
    if (pattern.test(contents)) {
      networkCallFound = true;
      console.log(`  FAIL found ${pattern} in src/${file}`);
    }
  }
}
check('no source file makes a network call of any kind', !networkCallFound);

fs.rmSync(entry, { force: true });
fs.rmSync(bundlePath, { force: true });

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
