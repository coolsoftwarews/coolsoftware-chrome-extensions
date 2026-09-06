/**
 * Headless checks for the pure logic: capture-card creation and dedupe,
 * theme assignment, the three export formats, filenames and import
 * merge-by-id semantics. The DOM-bound half (reddit-extract.ts, content.ts,
 * panel.ts) needs a real browser and Reddit's live markup, and is covered by
 * the manual checklist in the README instead — same split WebHighlighter
 * uses for its anchoring vs. DOM code.
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

const entry = path.join(os.tmpdir(), `rvoc-selftest-${process.pid}.mjs`);
fs.writeFileSync(
  entry,
  ['dedupe.ts', 'backup.ts', 'formatters.ts', 'url.ts', 'types.ts']
    .map(file => `export * from ${JSON.stringify(path.join(rootDir, 'src', file).replace(/\\/g, '/'))};`)
    .join('\n')
);

const bundlePath = path.join(os.tmpdir(), `rvoc-selftest-bundle-${process.pid}.mjs`);
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
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/* ── URL support ─────────────────────────────────────────────────────── */

console.log('urls');
check('accepts www.reddit.com', mod.isSupportedUrl('https://www.reddit.com/r/freelance/'));
check('accepts old.reddit.com', mod.isSupportedUrl('https://old.reddit.com/r/freelance/comments/abc/title/'));
check('accepts a reddit subdomain', mod.isSupportedUrl('https://np.reddit.com/r/x'));
check('rejects a different site', mod.isSupportedUrl('https://reddit.com.evil.example/') === false);
check('rejects chrome pages', mod.isSupportedUrl('chrome://extensions') === false);
check('rejects undefined', mod.isSupportedUrl(undefined) === false);

/* ── Capture-card creation + dedupe ──────────────────────────────────── */

console.log('dedupe');

function newQuoteInput(overrides = {}) {
  return {
    quote: 'This is genuinely the hardest part of freelancing.',
    context: 'Full comment body goes here.',
    author: 'throwaway123',
    anonymized: false,
    subreddit: 'r/freelance',
    threadTitle: 'How do you handle scope creep?',
    threadUrl: 'https://www.reddit.com/r/freelance/comments/abc/scope_creep/',
    permalink: 'https://www.reddit.com/r/freelance/comments/abc/scope_creep/comment/xyz/',
    score: 42,
    postedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

const firstSave = mod.mergeQuote([], newQuoteInput());
check('a new quote is saved', firstSave.outcome.status === 'saved');
check('a new quote gets an id', firstSave.outcome.quote.id.startsWith('q_'), firstSave.outcome.quote.id);
check('a new quote defaults to no theme', firstSave.outcome.quote.themeId === '');
check('a new quote defaults to no note', firstSave.outcome.quote.note === '');
check('quote text is trimmed', firstSave.outcome.quote.quote === newQuoteInput().quote);

const afterFirst = firstSave.quotes;

const exactDuplicate = mod.mergeQuote(afterFirst, newQuoteInput());
check('saving the exact same text again is a duplicate', exactDuplicate.outcome.status === 'duplicate');
check('a duplicate does not grow the list', exactDuplicate.quotes.length === afterFirst.length);

const shorterSpan = mod.mergeQuote(afterFirst, newQuoteInput({ quote: 'the hardest part of freelancing' }));
check('a shorter span of an existing quote is a duplicate', shorterSpan.outcome.status === 'duplicate');
check('the shorter save keeps the existing, longer quote', shorterSpan.outcome.quote.quote === newQuoteInput().quote);

const withNote = mod.setNote(afterFirst, firstSave.outcome.quote.id, 'Use this in the landing page hero.');
const withTheme = mod.assignTheme(withNote, firstSave.outcome.quote.id, 'pain');

const widerSpan = mod.mergeQuote(
  withTheme,
  newQuoteInput({ quote: 'This is genuinely the hardest part of freelancing. Full stop.' })
);
check('a wider span replaces the existing quote', widerSpan.outcome.status === 'replaced');
check('the replacement keeps the same id', widerSpan.outcome.quote.id === firstSave.outcome.quote.id);
check('the replacement keeps the note', widerSpan.outcome.quote.note === 'Use this in the landing page hero.');
check('the replacement keeps the theme', widerSpan.outcome.quote.themeId === 'pain');
check('the replacement does not grow the list', widerSpan.quotes.length === withTheme.length);

const differentComment = mod.mergeQuote(afterFirst, newQuoteInput({ permalink: 'https://www.reddit.com/r/freelance/comments/abc/scope_creep/comment/other/' }));
check('the same text from a different comment is not deduped', differentComment.outcome.status === 'saved');
check('two distinct comments both end up saved', differentComment.quotes.length === 2);

console.log('theme / note / author edits');
const quotesForEdits = mod.mergeQuote([], newQuoteInput()).quotes;
const id = quotesForEdits[0].id;
check('assignTheme updates only the target quote', mod.assignTheme(quotesForEdits, id, 'objections')[0].themeId === 'objections');
check('setNote updates the note', mod.setNote(quotesForEdits, id, 'hello')[0].note === 'hello');
const hidden = mod.hideAuthor(quotesForEdits, id)[0];
check('hideAuthor clears the author', hidden.author === '');
check('hideAuthor marks anonymized', hidden.anonymized === true);
check('removeQuote drops the quote', mod.removeQuote(quotesForEdits, id).length === 0);

const themeRemoval = mod.removeTheme(mod.DEFAULT_THEMES, mod.assignTheme(quotesForEdits, id, 'pain'), 'pain');
check('removeTheme drops the theme', !themeRemoval.themes.some(t => t.id === 'pain'));
check('removeTheme reassigns its quotes to Uncategorized', themeRemoval.quotes[0].themeId === '');
check('renameTheme changes only the target', mod.renameTheme(mod.DEFAULT_THEMES, 'pain', 'Frustrations').find(t => t.id === 'pain').name === 'Frustrations');

/* ── Import merge-by-id ──────────────────────────────────────────────── */

console.log('import');

const backup = mod.buildBackup(afterFirst, mod.DEFAULT_THEMES, '2026-08-15T00:00:00.000Z');
check('buildBackup carries the format tag', backup.format === 'reddit-voice-of-customer');
check('buildBackup carries the version', backup.version === 1);

let threw = false;
try {
  mod.mergeImport([], [], { format: 'something-else', quotes: [] });
} catch {
  threw = true;
}
check('an unrecognised file is rejected', threw);

const firstImport = mod.mergeImport([], [], backup);
check('a fresh import inserts every quote', firstImport.quotes.length === afterFirst.length);
check('a fresh import inserts every theme', firstImport.themes.length === mod.DEFAULT_THEMES.length);
check('a fresh import reports what changed', firstImport.result.quotes === afterFirst.length);

const secondImport = mod.mergeImport(firstImport.quotes, firstImport.themes, backup);
check('importing the same file twice does not duplicate quotes', secondImport.quotes.length === afterFirst.length);
check('importing the same file twice reports nothing new', secondImport.result.quotes === 0);

const editedBackup = mod.buildBackup(
  [{ ...afterFirst[0], note: 'Overwritten by import.' }],
  mod.DEFAULT_THEMES
);
const overwritten = mod.mergeImport(firstImport.quotes, firstImport.themes, editedBackup);
check(
  'a re-import with a known id overwrites the stored record',
  overwritten.quotes.find(q => q.id === afterFirst[0].id).note === 'Overwritten by import.'
);

/* ── Export formats ──────────────────────────────────────────────────── */

console.log('exports');

const themes = [
  { id: 'pain', name: 'Pain' },
  { id: 'objections', name: 'Objections' },
];

const quoteA = {
  id: 'q1',
  quote: 'Invoicing clients is a nightmare.',
  context: 'full context',
  author: 'alice',
  anonymized: false,
  subreddit: 'r/freelance',
  threadTitle: 'Billing pain points',
  threadUrl: 'https://www.reddit.com/r/freelance/comments/1/',
  permalink: 'https://www.reddit.com/r/freelance/comments/1/comment/a/',
  score: 12,
  postedAt: '2026-01-01T00:00:00.000Z',
  note: 'Great hero copy.',
  themeId: 'pain',
  createdAt: 1,
};

const quoteB = {
  id: 'q2',
  quote: 'I just use a spreadsheet, works fine',
  context: 'full context',
  author: '',
  anonymized: true,
  subreddit: 'r/smallbusiness',
  threadTitle: 'Alternatives to invoicing software',
  threadUrl: 'https://www.reddit.com/r/smallbusiness/comments/2/',
  permalink: 'https://www.reddit.com/r/smallbusiness/comments/2/comment/b/',
  score: null,
  postedAt: '',
  note: '',
  themeId: 'unknown-theme-id',
  createdAt: 2,
};

const quoteWithCsvSpecials = {
  ...quoteA,
  id: 'q3',
  quote: 'They said, "just raise your rates" — easy for them to say, with a comma.',
  createdAt: 3,
};

const allQuotes = [quoteA, quoteB, quoteWithCsvSpecials];

const grouped = mod.groupByTheme(allQuotes, themes);
check('groupByTheme buckets by known theme', grouped.find(g => g.theme.id === 'pain').quotes.length === 2);
check('groupByTheme puts unknown themes under Uncategorized', grouped.find(g => g.theme.id === '').quotes.length === 1);
check('groupByTheme drops empty themes', !grouped.some(g => g.theme.id === 'objections'));

const themeStats = mod.statsByTheme(allQuotes, themes);
check('statsByTheme reports per-theme counts', themeStats.find(s => s.id === 'pain').count === 2);

const subredditStats = mod.statsBySubreddit(allQuotes);
check('statsBySubreddit sorts by count descending', subredditStats[0].subreddit === 'r/freelance' && subredditStats[0].count === 2);

const md = mod.toMarkdown(allQuotes, themes);
check('markdown groups by theme with a heading', md.includes('## Pain (2)'));
check('markdown quotes as blockquotes', md.includes('> Invoicing clients is a nightmare.'));
check('markdown includes a citation with the permalink', md.includes('[Billing pain points](https://www.reddit.com/r/freelance/comments/1/comment/a/)'));
check('markdown includes the note', md.includes('Great hero copy.'));
check('markdown credits an anonymized quote as anonymous', md.includes('anonymous in r/smallbusiness'));
check('markdown places unknown-theme quotes under Uncategorized', md.includes('## Uncategorized (1)'));

const emptyMd = mod.toMarkdown([], themes);
check('an empty library exports without throwing', emptyMd.includes('No quotes saved yet'));

const csv = mod.toCsv(allQuotes, themes);
const csvLines = csv.trim().split('\r\n');
check('csv has a header row plus one row per quote', csvLines.length === allQuotes.length + 1);
check('csv header matches the documented columns', csvLines[0] === 'theme,quote,note,author,subreddit,thread_title,permalink,thread_url,score,posted_at,saved_at');
check('csv quotes a field containing a comma and double-quotes it', csv.includes('"They said, ""just raise your rates"" — easy for them to say, with a comma."'));
check('csv leaves a null score blank', csvLines.some(line => line.startsWith('Uncategorized,') && line.includes(',,')));

const json = mod.toJson(allQuotes, themes, '2026-08-15T00:00:00.000Z');
const parsedBackup = JSON.parse(json);
check('json export is a valid backup', parsedBackup.format === 'reddit-voice-of-customer' && parsedBackup.version === 1);
check('json export round-trips through import without loss', mod.mergeImport([], [], parsedBackup).quotes.length === allQuotes.length);

/* ── Filenames ───────────────────────────────────────────────────────── */

console.log('filenames');
const fixedDate = new Date('2026-09-02T12:00:00.000Z');
check('md filename follows the dated convention', mod.buildFilename('md', fixedDate) === 'reddit-voice-of-customer-2026-09-02.md');
check('csv filename uses the same convention', mod.buildFilename('csv', fixedDate) === 'reddit-voice-of-customer-2026-09-02.csv');
check('json filename uses the same convention', mod.buildFilename('json', fixedDate) === 'reddit-voice-of-customer-2026-09-02.json');

fs.rmSync(entry, { force: true });
fs.rmSync(bundlePath, { force: true });

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
