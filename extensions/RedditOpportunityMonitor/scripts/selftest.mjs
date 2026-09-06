/**
 * Headless checks for the pure logic: the rules engine (two-part intent+
 * topic matching, hit counts, the subreddit read), the CSV/Markdown export
 * layer, and the text-only half of DOM extraction. This is the part of the
 * product most worth unit-testing — it's exactly what the PRD's non-
 * functional requirement (§6: "< 5 ms per post at 50 rules") is protecting,
 * and it's where a portfolio-wide module (README's "Rules engine" row) earns
 * its keep by being tested once, thoroughly. The DOM-bound halves (content
 * script, both Reddit front-ends' markup) need a real browser and are
 * covered by the manual checklist in README.md instead.
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

const entry = path.join(os.tmpdir(), `rom-selftest-${process.pid}.mjs`);
fs.writeFileSync(
  entry,
  ['rules.ts', 'export.ts', 'extract.ts', 'starter-packs.ts']
    .map(file => `export * from ${JSON.stringify(path.join(rootDir, 'src', file).replace(/\\/g, '/'))};`)
    .join('\n')
);

const bundlePath = path.join(os.tmpdir(), `rom-selftest-bundle-${process.pid}.mjs`);
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

function makeRule(overrides = {}) {
  return {
    id: overrides.id ?? 'r1',
    name: overrides.name ?? 'Test rule',
    matchPhrases: overrides.matchPhrases ?? ['looking for', 'recommend'],
    topicWords: overrides.topicWords ?? ['invoicing', 'time tracking'],
    ignoreWords: overrides.ignoreWords ?? ['free only'],
    enabled: overrides.enabled ?? true,
    createdAt: overrides.createdAt ?? Date.now(),
  };
}

/* ── Rule evaluation: the two-part match ────────────────────────────────── */

console.log('rules — two-part matching');

const rule = makeRule();

check(
  'matches when intent AND topic are both present',
  mod.evaluateRule('Looking for a good invoicing tool, any ideas?', rule)?.matchPhrase === 'looking for'
);
check(
  'reports which topic word hit',
  mod.evaluateRule('Looking for a good invoicing tool', rule)?.topicWord === 'invoicing'
);
check('intent alone is not enough', mod.evaluateRule('Looking for a good coffee shop', rule) === null);
check('topic alone is not enough', mod.evaluateRule('My invoicing is a mess today', rule) === null);
check(
  'the ignore list blocks an otherwise-good match',
  mod.evaluateRule('Looking for a free only invoicing tool', rule) === null
);
check('a disabled rule never matches', mod.evaluateRule('Looking for invoicing help', makeRule({ enabled: false })) === null);
check(
  'matching is case-insensitive',
  mod.evaluateRule('LOOKING FOR AN INVOICING APP', rule)?.matchPhrase === 'looking for'
);
check(
  'whitespace is collapsed so a line-wrapped phrase still matches',
  mod.evaluateRule('Looking   for\nan invoicing tool', rule) !== null
);
check('empty post text never matches', mod.evaluateRule('', rule) === null);

const twoRules = [rule, makeRule({ id: 'r2', name: 'Time tracking', topicWords: ['time tracking'] })];
const bothHit = mod.evaluatePost('Looking for a time tracking app with invoicing built in', twoRules);
check('a post can fire more than one rule', bothHit.length === 2);
check('hits report the firing rule', bothHit.map(h => h.ruleId).sort().join(',') === 'r1,r2');

check(
  'the reason chip matches the PRD format',
  mod.formatReasonChip({ ruleId: 'r1', ruleName: 'x', matchPhrase: 'looking for', topicWord: 'invoicing' }) ===
    '\u{1F4A1} "looking for" + "invoicing"'
);

/* ── Hit counts ──────────────────────────────────────────────────────────── */

console.log('rules — hit counts');

const now = Date.now();
const DAY = 24 * 60 * 60 * 1000;
function opp(overrides = {}) {
  return {
    id: overrides.id ?? `t3_${Math.random().toString(36).slice(2)}`,
    subreddit: overrides.subreddit ?? 'freelance',
    title: overrides.title ?? 'Looking for an invoicing tool',
    snippet: overrides.snippet ?? '',
    permalink: 'https://reddit.com/r/freelance/comments/abc/',
    score: overrides.score ?? 10,
    numComments: overrides.numComments ?? 5,
    postedAtLabel: null,
    createdAtMs: null,
    capturedAt: overrides.capturedAt ?? now,
    matches: overrides.matches ?? [{ ruleId: 'r1', ruleName: 'Test rule', matchPhrase: 'looking for', topicWord: 'invoicing' }],
    status: overrides.status ?? 'new',
    note: overrides.note ?? '',
    frontend: 'new',
  };
}

const items = [
  opp({ capturedAt: now - 1 * DAY }),
  opp({ capturedAt: now - 5 * DAY }),
  opp({ capturedAt: now - 40 * DAY }), // outside the 30-day window
  opp({ capturedAt: now - 2 * DAY, matches: [{ ruleId: 'r1', ruleName: 'Test rule', matchPhrase: 'recommend', topicWord: 'time tracking' }] }),
];

const ruleSummaries = mod.summarizeRuleHits([rule], items, 30, now);
check('rule total counts every capture', ruleSummaries[0].total === 4);
check('rule "recent" excludes captures outside the window', ruleSummaries[0].recent === 3);

const topicSummaries = mod.summarizeTopicHits(items, 30, now);
const invoicing = topicSummaries.find(t => t.topicWord === 'invoicing');
check('topic hit counts are grouped by topic word, not rule', invoicing?.count === 2, JSON.stringify(topicSummaries));
check(
  'the described sentence matches the PRD example shape',
  mod.describeTopicHit({ topicWord: 'invoicing', ruleNames: ['x'], count: 11 }, 30) ===
    '"invoicing" matched 11 times in 30 days'
);
check('a single match uses the singular "time"', mod.describeTopicHit({ topicWord: 'x', ruleNames: [], count: 1 }, 30).includes(' 1 time '));

/* ── Subreddit read ──────────────────────────────────────────────────────── */

console.log('rules — subreddit read');

const posts = [
  { subreddit: 'freelance', score: 10, text: 'Looking for an invoicing tool' },
  { subreddit: 'freelance', score: 30, text: 'Recommend a good time tracking app' },
  { subreddit: 'freelance', score: 20, text: 'Just sharing a win today' },
  { subreddit: 'other', score: 999, text: 'Unrelated subreddit, must not leak in' },
];
const summary = mod.summarizeSubreddit('freelance', posts, mod.allIntentPhrases([rule]));
check('post volume counts only the target subreddit', summary.postsScanned === 3);
check('median score is computed correctly', summary.medianScore === 20, summary.medianScore);
check(
  'common intent phrases are ranked by frequency',
  summary.topIntentPhrases[0]?.phrase === 'looking for' || summary.topIntentPhrases[0]?.phrase === 'recommend'
);
check('an empty subreddit reports a null median rather than 0', mod.summarizeSubreddit('nothing-here', [], []).medianScore === null);

check('median of an empty list is null', mod.median([]) === null);
check('median of an odd list is the middle value', mod.median([1, 3, 2]) === 2);
check('median of an even list is the rounded midpoint', mod.median([10, 20]) === 15);

check(
  'allIntentPhrases skips disabled rules',
  !mod.allIntentPhrases([makeRule({ enabled: false })]).includes('looking for')
);

/* ── Validation ──────────────────────────────────────────────────────────── */

console.log('rules — validation');

check('a rule with both parts is usable', mod.isUsableRule({ matchPhrases: ['x'], topicWords: ['y'] }));
check('a rule missing a topic is not usable', !mod.isUsableRule({ matchPhrases: ['x'], topicWords: [] }));
check('a rule with only whitespace phrases is not usable', !mod.isUsableRule({ matchPhrases: ['   '], topicWords: ['y'] }));

check(
  'parseTokenList splits on commas and newlines',
  mod.parseTokenList('looking for, recommend\nany alternative to').join('|') === 'looking for|recommend|any alternative to'
);
check('parseTokenList dedupes case-insensitively', mod.parseTokenList('Invoicing, invoicing, INVOICING').length === 1);
check('parseTokenList drops empty entries', mod.parseTokenList('a,,  ,b').join('|') === 'a|b');

check(`ships a starter pack per PRD target user`, mod.STARTER_PACKS.length === 4);
for (const pack of mod.STARTER_PACKS) {
  for (const packRule of pack.rules) {
    check(`starter pack "${pack.id}" rule "${packRule.name}" is usable`, mod.isUsableRule(packRule));
  }
}

/* ── Export: CSV ─────────────────────────────────────────────────────────── */

console.log('export — csv');

const csvItems = [
  opp({ title: 'Needs, a comma', note: 'Has a "quote" in it', status: 'replied' }),
  opp({ title: 'Second row', matches: [] }),
];
const csv = mod.toCsv(csvItems);
const csvLines = csv.trim().split('\r\n');
check('csv has a header row plus one row per item', csvLines.length === 1 + csvItems.length);
check('csv header lists the expected columns', csvLines[0].startsWith('Status,Subreddit,Title'));
check('a comma in a field is quoted', csvLines[1].includes('"Needs, a comma"'));
check('a quote in a field is escaped by doubling', csvLines[1].includes('""quote""'));
check('an item with no matches still exports', csvLines[2] !== undefined);

/* ── Export: Markdown ────────────────────────────────────────────────────── */

console.log('export — markdown');

check('an empty export says so rather than emitting a blank document', mod.toMarkdown([]).includes('No matched threads yet'));
const md = mod.toMarkdown(csvItems);
check('markdown opens with a top-level heading', md.startsWith('# Reddit opportunities'));
check('each item becomes its own subheading with the subreddit', md.includes('## r/freelance — Needs, a comma'));
check('matched phrases appear as quoted pairs', md.includes('"looking for" + "invoicing"'));
check('the note is carried through', md.includes('Has a "quote" in it'));

/* ── Filenames ───────────────────────────────────────────────────────────── */

console.log('export — filenames');

const filename = mod.buildFilename('csv', 'freelance');
check('follows the reddit-opportunities-{scope}-{date}.{ext} convention', /^reddit-opportunities-freelance-\d{4}-\d{2}-\d{2}\.csv$/.test(filename), filename);
check('an empty scope collapses to the base name', mod.buildFilename('md', '') === `reddit-opportunities-${new Date().toISOString().slice(0, 10)}.md`);
check(
  'scope text is slugified',
  mod.buildFilename('csv', 'New Reddit! Freelance').includes('new-reddit-freelance')
);

/* ── Extraction: pure text helpers ──────────────────────────────────────── */

console.log('extract — text helpers');

check('parses a plural comment count', mod.parseCommentCountLabel('34 comments') === 34);
check('parses a singular comment count', mod.parseCommentCountLabel('1 comment') === 1);
check('parses a comment count with thousands separators', mod.parseCommentCountLabel('1,234 comments') === 1234);
check('returns null when there is no comment count in the text', mod.parseCommentCountLabel('no numbers here') === null);

check('strips a leading r/ from a subreddit label', mod.stripSubredditPrefix('r/freelance') === 'freelance');
check('leaves a bare subreddit name alone', mod.stripSubredditPrefix('freelance') === 'freelance');

check('parses a plain integer score', mod.parseScoreLabel('34') === 34);
check('parses a "k" suffixed score', mod.parseScoreLabel('1.2k') === 1200);
check('parses an "m" suffixed score', mod.parseScoreLabel('2m') === 2000000);
check('a hidden score renders as null, not zero', mod.parseScoreLabel('•') === null);
check('a bare hyphen renders as null', mod.parseScoreLabel('-') === null);

check('short snippets are returned unchanged', mod.truncateSnippet('short text') === 'short text');
const longSnippet = 'word '.repeat(200).trim();
const truncated = mod.truncateSnippet(longSnippet, 50);
check('long snippets are truncated with an ellipsis', truncated.endsWith('…') && truncated.length <= 51, truncated.length);
check('truncation breaks on a word boundary, not mid-word', !truncated.slice(0, -1).endsWith(' '));

check('old.reddit.com is detected as the old front-end', mod.detectFrontend('old.reddit.com') === 'old');
check('www.reddit.com is detected as the new front-end', mod.detectFrontend('www.reddit.com') === 'new');
check('a bare reddit.com host defaults to the new front-end', mod.detectFrontend('reddit.com') === 'new');

check('reads the subreddit from a listing path', mod.subredditFromPath('/r/freelance/') === 'freelance');
check('reads the subreddit from a sort path', mod.subredditFromPath('/r/freelance/hot/') === 'freelance');
check('reads the subreddit from a post permalink path', mod.subredditFromPath('/r/freelance/comments/abc123/title/') === 'freelance');
check('the home feed has no single subreddit', mod.subredditFromPath('/') === null);
check('r/all is not treated as a single community', mod.subredditFromPath('/r/all/') === null);
check('r/popular is not treated as a single community', mod.subredditFromPath('/r/popular/') === null);
check('a user profile path has no subreddit', mod.subredditFromPath('/user/someone/') === null);

fs.rmSync(entry, { force: true });
fs.rmSync(bundlePath, { force: true });

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
