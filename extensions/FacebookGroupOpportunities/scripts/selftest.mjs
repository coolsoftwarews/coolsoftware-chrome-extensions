/**
 * Headless checks for the pure logic: the rules engine (two-part matching,
 * hit counts, starter packs), dedupe hashing, the CSV/Markdown export layer,
 * and the text-only half of the Facebook DOM extraction (comment-count
 * parsing, permalink detection, name filtering).
 *
 * The rules engine gets the most coverage because it is the whole product —
 * the PRD calls the two-part match/topic check "what keeps the noise down"
 * (§4) and sets a 5 ms/post budget at 50 rules (§6). The DOM-bound half
 * (content.ts, the article-walking parts of extract.ts) needs a real
 * Facebook group and is covered by the manual checklist in the README.
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

const entry = path.join(os.tmpdir(), `fgo-selftest-${process.pid}.mjs`);
fs.writeFileSync(
  entry,
  ['types.ts', 'rules.ts', 'starter-packs.ts', 'dedupe.ts', 'formatters.ts', 'extract.ts']
    .map(file => `export * from ${JSON.stringify(path.join(rootDir, 'src', file).replace(/\\/g, '/'))};`)
    .join('\n')
);

const bundlePath = path.join(os.tmpdir(), `fgo-selftest-bundle-${process.pid}.mjs`);
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

/* ── Rule matching: the two-part check ──────────────────────────────────── */

console.log('rules — two-part matching');

const bookkeeping = {
  id: 'r1',
  name: 'Bookkeeping leads',
  matchPhrases: ['looking for', 'can anyone recommend'],
  topicWords: ['bookkeeper', 'accountant'],
  ignoreWords: ['free', 'intern'],
  enabled: true,
  createdAt: 0,
};

const hit = mod.evaluateRule('Hey all, looking for a good bookkeeper in the Austin area, thanks!', bookkeeping);
check('matches when a phrase AND a topic word are both present', hit !== null);
check('reports which phrase matched', hit?.matchPhrase === 'looking for');
check('reports which topic word matched', hit?.topicWord === 'bookkeeper');
check('reports the rule id and name', hit?.ruleId === 'r1' && hit?.ruleName === 'Bookkeeping leads');

check(
  'phrase alone is not enough — no topic word',
  mod.evaluateRule('looking for a good coffee shop nearby', bookkeeping) === null
);
check(
  'topic alone is not enough — no intent phrase',
  mod.evaluateRule('My bookkeeper just retired, sad day.', bookkeeping) === null
);
check(
  'an ignore word blocks the match even with both parts present',
  mod.evaluateRule('Looking for a FREE bookkeeper, anyone?', bookkeeping) === null
);
check(
  'matching is case-insensitive',
  mod.evaluateRule('LOOKING FOR AN ACCOUNTANT ASAP', bookkeeping) !== null
);
check(
  'matching is whitespace-tolerant',
  mod.evaluateRule('looking   for\na bookkeeper', bookkeeping) !== null
);
check('a disabled rule never matches', mod.evaluateRule('looking for a bookkeeper', { ...bookkeeping, enabled: false }) === null);
check('empty post text never matches', mod.evaluateRule('', bookkeeping) === null);

const developer = {
  id: 'r2',
  name: 'Developer leads',
  matchPhrases: ['does anyone know'],
  topicWords: ['web developer'],
  ignoreWords: [],
  enabled: true,
  createdAt: 0,
};

const post = 'Does anyone know a good web developer? Also looking for a bookkeeper, free consult ideally.';
const multi = mod.evaluatePost(post, [bookkeeping, developer]);
check('evaluatePost runs every enabled rule', multi.length === 1, JSON.stringify(multi));
check('the bookkeeping rule is blocked by "free" even in a multi-rule post', !multi.some(m => m.ruleId === 'r1'));
check('the developer rule still fires', multi.some(m => m.ruleId === 'r2'));

check(
  'reason chip is the PRD-shaped sentence',
  mod.formatReasonChip(hit) === '\u{1F4A1} opportunity — "looking for" + "bookkeeper"',
  mod.formatReasonChip(hit)
);

// Performance budget: PRD §6, < 5ms per post at 50 rules.
const manyRules = Array.from({ length: 50 }, (_, i) => ({
  ...bookkeeping,
  id: `r${i}`,
  matchPhrases: [`phrase ${i}`, 'looking for'],
  topicWords: [`topic ${i}`, 'bookkeeper'],
}));
const longPost = 'looking for a bookkeeper. '.repeat(50);
const started = process.hrtime.bigint();
mod.evaluatePost(longPost, manyRules);
const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
check('evaluatePost stays under the 5ms/post budget at 50 rules', elapsedMs < 5, `${elapsedMs.toFixed(2)}ms`);

/* ── Validation and token parsing ────────────────────────────────────────── */

console.log('rules — validation');

check('a rule with both a phrase and a topic is usable', mod.isUsableRule({ matchPhrases: ['looking for'], topicWords: ['bookkeeper'] }));
check('a rule missing a topic word is not usable', !mod.isUsableRule({ matchPhrases: ['looking for'], topicWords: [] }));
check('a rule missing a match phrase is not usable', !mod.isUsableRule({ matchPhrases: [], topicWords: ['bookkeeper'] }));
check('whitespace-only tokens do not count as usable', !mod.isUsableRule({ matchPhrases: ['   '], topicWords: ['bookkeeper'] }));

const tokens = mod.parseTokenList('looking for, can anyone recommend\ndoes anyone know,,  \nLooking For');
check('splits on commas and newlines', tokens.includes('can anyone recommend'));
check('drops empty entries', !tokens.includes(''));
check('dedupes case-insensitively, keeping first casing', tokens.filter(t => t.toLowerCase() === 'looking for').length === 1);

/* ── Hit counts ──────────────────────────────────────────────────────────── */

console.log('rules — hit counts');

const now = Date.parse('2026-09-02T12:00:00Z');
const dayMs = 24 * 60 * 60 * 1000;
const items = [
  { matches: [{ ruleId: 'r1' }], capturedAt: now - 1 * dayMs },
  { matches: [{ ruleId: 'r1' }], capturedAt: now - 3 * dayMs },
  { matches: [{ ruleId: 'r1' }], capturedAt: now - 10 * dayMs },
  { matches: [{ ruleId: 'r2' }], capturedAt: now - 1 * dayMs },
];

const summary = mod.summarizeHits(
  [
    { id: 'r1', name: 'Bookkeeping leads' },
    { id: 'r2', name: 'Developer leads' },
    { id: 'r3', name: 'Unused rule' },
  ],
  items,
  now
);

const r1 = summary.find(s => s.ruleId === 'r1');
check('counts total hits per rule', r1.total === 3, r1.total);
check('counts only the trailing 7 days for the weekly figure', r1.last7Days === 2, r1.last7Days);
check('a rule with no hits reports zero, not undefined', summary.find(s => s.ruleId === 'r3').total === 0);
check(
  'weekly sentence matches the PRD phrasing',
  mod.describeWeeklyHits(r1) === 'Seen 2 similar posts this week',
  mod.describeWeeklyHits(r1)
);
check(
  'zero this week reads as "no matches", not "seen 0"',
  mod.describeWeeklyHits(summary.find(s => s.ruleId === 'r3')) === 'No matches this week yet'
);

/* ── Starter packs ───────────────────────────────────────────────────────── */

console.log('starter packs');

check('ships at least the four professions the PRD names', mod.STARTER_PACKS.length >= 4);
for (const pack of mod.STARTER_PACKS) {
  check(`"${pack.label}" starter pack is a usable rule out of the box`, mod.isUsableRule(pack.rule));
}
check(
  'agency, bookkeeper, developer and photographer packs all exist',
  ['agency', 'bookkeeper', 'developer', 'photographer'].every(id => mod.STARTER_PACKS.some(p => p.id === id))
);

/* ── Dedupe ──────────────────────────────────────────────────────────────── */

console.log('dedupe');

const idA = mod.opportunityId('Bookkeepers of Texas', 'Jane Doe', 'Looking for a bookkeeper, any recs?');
const idA2 = mod.opportunityId('Bookkeepers of Texas', 'Jane Doe', 'Looking for a bookkeeper, any recs?');
check('the same post produces the same id', idA === idA2);

// The id only hashes the first 160 characters (dedupe.ts), so a base long
// enough to fill that window plus an edit appended after it must hash the same.
const longBase =
  'Looking for a bookkeeper in the Austin area, ideally someone who has worked with small ' +
  'service businesses before and can start within the next few weeks if possible, thanks!!';
check('the test fixture actually exceeds the id window', longBase.length > 160, longBase.length);
const idLongBase = mod.opportunityId('Bookkeepers of Texas', 'Jane Doe', longBase);
const idEditedTail = mod.opportunityId(
  'Bookkeepers of Texas',
  'Jane Doe',
  longBase + ' Edit: found one, thanks all so much for the replies!!'
);
check('an edit appended well past the id window does not change the id', idLongBase === idEditedTail);

const idEditedHead = mod.opportunityId('Bookkeepers of Texas', 'Jane Doe', 'Edit: ' + longBase);
check('an edit inside the id window does change the id', idLongBase !== idEditedHead);

const idDifferentAuthor = mod.opportunityId('Bookkeepers of Texas', 'John Smith', 'Looking for a bookkeeper, any recs?');
check('a different author produces a different id', idA !== idDifferentAuthor);

const idDifferentGroup = mod.opportunityId('Other Group', 'Jane Doe', 'Looking for a bookkeeper, any recs?');
check('a different group produces a different id', idA !== idDifferentGroup);

check('ids are stable strings safe to use as storage keys', /^fgo_[a-z0-9]+$/.test(idA), idA);

/* ── Export: CSV ─────────────────────────────────────────────────────────── */

console.log('export — csv');

const sampleItems = [
  {
    id: 'fgo_1',
    groupName: 'Bookkeepers of Texas',
    groupUrl: 'https://www.facebook.com/groups/123',
    author: 'Jane Doe',
    postText: 'Looking for a bookkeeper, "urgent", any recs?\nSecond line.',
    postUrl: 'https://www.facebook.com/groups/123/posts/456',
    commentCount: 4,
    postedAt: '3h',
    capturedAt: Date.parse('2026-09-01T00:00:00Z'),
    matches: [{ ruleId: 'r1', ruleName: 'Bookkeeping leads', matchPhrase: 'looking for', topicWord: 'bookkeeper' }],
    status: 'new',
    note: '',
  },
  {
    id: 'fgo_2',
    groupName: 'Dev Hangout',
    groupUrl: null,
    author: 'Anonymous member',
    postText: 'Does anyone know a good web developer?',
    postUrl: null,
    commentCount: null,
    postedAt: null,
    capturedAt: Date.parse('2026-09-02T00:00:00Z'),
    matches: [{ ruleId: 'r2', ruleName: 'Developer leads', matchPhrase: 'does anyone know', topicWord: 'web developer' }],
    status: 'replied',
    note: 'Sent them a DM',
  },
];

const csv = mod.toCsv(sampleItems);
const csvLines = csv.trim().split('\r\n');
check('csv has a header row plus one row per item', csvLines.length === sampleItems.length + 1, csvLines.length);
check('header names the columns', csvLines[0].startsWith('Status,Group,Author'));
check('a cell containing a quote and a comma is quoted and escaped', csvLines[1].includes('""urgent""'));
check('a post with an embedded newline stays inside one logical row', csv.split('\r\n').length === 3 + 1);
check('empty csv still has a header', mod.toCsv([]).trim() === CSV_HEADER());

function CSV_HEADER() {
  return mod.toCsv([]).trim();
}

/* ── Export: Markdown ────────────────────────────────────────────────────── */

console.log('export — markdown');

const md = mod.toMarkdown(sampleItems);
check('opens with a title', md.startsWith('# Facebook group opportunities'));
check('one heading per group + author', md.includes('## Bookkeepers of Texas — Jane Doe'));
check('shows the matched phrase + topic', md.includes('"looking for" + "bookkeeper"'));
check('quotes the post text as a blockquote', md.includes('> Looking for a bookkeeper'));
check('carries the reply note through', md.includes('Sent them a DM'));
check('status is rendered as a readable label, not the raw enum', md.includes('**Status:** Replied'));
check('an empty export says so rather than emitting a bare heading', mod.toMarkdown([]).includes('No matched posts yet'));

/* ── Filenames ───────────────────────────────────────────────────────────── */

console.log('filenames');

const filename = mod.buildFilename('csv', 'all', new Date('2026-09-02T00:00:00Z'));
check('follows the facebook-group-opportunities-{scope}-{date}.{ext} shape', filename === 'facebook-group-opportunities-all-2026-09-02.csv', filename);
const scoped = mod.buildFilename('md', 'Bookkeeping leads', new Date('2026-09-02T00:00:00Z'));
check('scope is slugified', scoped === 'facebook-group-opportunities-bookkeeping-leads-2026-09-02.md', scoped);

/* ── Extraction: text-only helpers ───────────────────────────────────────── */

console.log('extraction — text helpers');

check('parses "12 comments"', mod.parseCommentCount('12 comments') === 12);
check('parses "1 Comment" (singular, capitalized)', mod.parseCommentCount('1 Comment') === 1);
check('parses thousands separators', mod.parseCommentCount('1,204 comments') === 1204);
check('returns null when there is no comment count', mod.parseCommentCount('Like Share') === null);

check('recognizes a /posts/ permalink', mod.isPermalinkHref('https://www.facebook.com/groups/123/posts/456/'));
check('recognizes a /permalink/ url', mod.isPermalinkHref('https://www.facebook.com/groups/123/permalink/456/'));
check('recognizes a story_fbid link', mod.isPermalinkHref('https://www.facebook.com/groups/123?story_fbid=456&id=789'));
check('rejects a bare group url', !mod.isPermalinkHref('https://www.facebook.com/groups/123/'));
check('rejects an unrelated site', !mod.isPermalinkHref('https://example.com/posts/456'));

check('strips the " | Facebook" suffix from a document title', mod.cleanGroupName('Bookkeepers of Texas | Facebook') === 'Bookkeepers of Texas');
check('strips a " - Facebook" suffix too', mod.cleanGroupName('Bookkeepers of Texas - Facebook') === 'Bookkeepers of Texas');
check('leaves a title with no suffix alone', mod.cleanGroupName('Bookkeepers of Texas') === 'Bookkeepers of Texas');

check('accepts a plausible name', mod.looksLikeAuthorName('Jane Doe'));
check('rejects reaction-bar chrome text', !mod.looksLikeAuthorName('Like'));
check('rejects a bare number', !mod.looksLikeAuthorName('42'));
check('rejects an empty string', !mod.looksLikeAuthorName(''));

const longText = 'a'.repeat(700);
const truncated = mod.truncateForCard(longText, 600);
check('truncates long text for the card', truncated.length <= 601, truncated.length);
check('truncation marks itself with an ellipsis', truncated.endsWith('…'));
const shortText = 'Looking for a bookkeeper in Austin.';
check('short text is returned untouched', mod.truncateForCard(shortText, 600) === shortText);
const wordBoundaryText = 'word '.repeat(200); // well past 600 chars, all short words
const wbTruncated = mod.truncateForCard(wordBoundaryText, 600);
check('truncation prefers a word boundary over a mid-word cut', !wbTruncated.slice(0, -1).endsWith('wor'));

fs.rmSync(entry, { force: true });
fs.rmSync(bundlePath, { force: true });

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
