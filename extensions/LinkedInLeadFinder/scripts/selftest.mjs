/**
 * Headless checks for the pure logic: count/URL parsing, the dedupe/merge
 * that makes "seen on N posts" correct, keyword qualification, and the two
 * export formats. The DOM-bound half (src/linkedin-dom.ts, src/content.ts)
 * needs a real LinkedIn page and is covered by the manual checklist in the
 * README instead — same split as WebHighlighter's anchor.ts/quote.ts.
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

const entry = path.join(os.tmpdir(), `llf-selftest-${process.pid}.mjs`);
fs.writeFileSync(
  entry,
  ['text.ts', 'rules.ts', 'dedupe.ts', 'formatters.ts']
    .map(file => `export * from ${JSON.stringify(path.join(rootDir, 'src', file).replace(/\\/g, '/'))};`)
    .join('\n')
);

const bundlePath = path.join(os.tmpdir(), `llf-selftest-bundle-${process.pid}.mjs`);
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

/* ── text: counts ────────────────────────────────────────────────────── */

console.log('parseCount');
check('plain digits', mod.parseCount('12') === 12);
check('thousands separator', mod.parseCount('1,234') === 1234);
check('K suffix', mod.parseCount('12K') === 12000);
check('decimal K suffix', mod.parseCount('3.4K') === 3400);
check('M suffix', mod.parseCount('1M') === 1000000);
check('empty string is null, not zero', mod.parseCount('') === null);
check('null is null', mod.parseCount(null) === null);
check('non-numeric text is null', mod.parseCount('Like') === null);
check('embedded label is still parsed', mod.parseCount('34 comments') === 34);

/* ── text: profile URL normalization ────────────────────────────────── */

console.log('normalizeProfileUrl');
const canonicalProfile = 'https://www.linkedin.com/in/janedoe';
check(
  'relative /in/ path resolves against linkedin.com',
  mod.normalizeProfileUrl('/in/janedoe/') === canonicalProfile
);
check(
  'trailing slash and tracking query are dropped',
  mod.normalizeProfileUrl('https://www.linkedin.com/in/janedoe/?trk=feed') === canonicalProfile
);
check(
  'case is normalized so the same person always dedupes',
  mod.normalizeProfileUrl('https://www.linkedin.com/in/JaneDoe') === canonicalProfile
);
check(
  'company pages normalize the same way',
  mod.normalizeProfileUrl('/company/acme-inc/') === 'https://www.linkedin.com/company/acme-inc'
);
check('a non-profile path is not a profile', mod.normalizeProfileUrl('/feed/update/urn:li:activity:1/') === null);
check('missing url is null', mod.normalizeProfileUrl(null) === null);
check('isCompanyUrl true for a company page', mod.isCompanyUrl('https://www.linkedin.com/company/acme-inc') === true);
check('isCompanyUrl false for a person', mod.isCompanyUrl(canonicalProfile) === false);
check('isCompanyUrl false for null', mod.isCompanyUrl(null) === false);

console.log('cleanText / truncate');
check('collapses whitespace including nbsp', mod.cleanText('Hi  there\n\n\tfriend') === 'Hi there friend');
check('truncate breaks on a word boundary', mod.truncate('one two three four five', 12) === 'one two…');
check('truncate leaves short text alone', mod.truncate('short', 50) === 'short');

/* ── rules: qualification ────────────────────────────────────────────── */

console.log('evaluateLead');
const rules = [
  { id: 'r1', keyword: 'founder', enabled: true },
  { id: 'r2', keyword: 'hiring', enabled: false },
];

const founderLead = { headline: 'Founder & CEO at Acme', captures: [] };
const hiringLead = { headline: 'Product manager', captures: [{ commentText: 'We are hiring right now!' }] };
const plainLead = { headline: 'Software engineer', captures: [{ commentText: 'Great post.' }] };

check('matches a keyword in the headline', mod.evaluateLead(founderLead, rules).qualified === true);
check('reports which keyword matched', mod.evaluateLead(founderLead, rules).matchedKeywords.includes('founder'));
check('a disabled rule never matches', mod.evaluateLead(hiringLead, rules).qualified === false);
check('no match leaves a lead unqualified', mod.evaluateLead(plainLead, rules).qualified === false);
check(
  'user-defined non-Latin keywords work — matching is plain substring, not English-only',
  mod.evaluateLead(
    { headline: '', captures: [{ commentText: 'Wir suchen einen Gründer' }] },
    [{ id: 'r3', keyword: 'gründer', enabled: true }]
  ).qualified === true
);

/* ── dedupe / merge ──────────────────────────────────────────────────── */

console.log('dedupe + merge');
const raw1 = {
  name: 'Jane Doe',
  headline: 'Founder at Acme',
  profileUrl: '/in/janedoe/',
  isCompany: false,
  isAnonymized: false,
  commentText: 'Would love to learn more.',
  reactionCount: 3,
  commentDate: '2d',
  postUrl: 'https://www.linkedin.com/feed/update/urn:li:activity:1/',
  postLabel: 'Post about pricing',
};
const raw2 = {
  ...raw1,
  profileUrl: 'https://www.linkedin.com/in/JaneDoe?trk=x',
  commentText: 'Following up here too.',
  reactionCount: 5,
  commentDate: '1d',
  postUrl: 'https://www.linkedin.com/feed/update/urn:li:activity:2/',
  postLabel: 'Post about hiring',
};

const now = Date.now();
const first = mod.mergeCapture(undefined, raw1, now);
check('creates a lead on first capture', first.captures.length === 1);
check('dedupe key comes from the normalized profile url', first.id === 'https://www.linkedin.com/in/janedoe');

const merged = mod.mergeCapture(first, raw2, now + 1000);
check(
  'same person, different casing/query, same dedupe key',
  mod.dedupeKey(raw1) === mod.dedupeKey(raw2)
);
check('a second post appends a second capture', merged.captures.length === 2);
check('seen-on count reflects distinct posts', mod.seenOnCount(merged) === 2);

const sameThreadAgain = mod.mergeCapture(merged, { ...raw2, reactionCount: 9 }, now + 2000);
check(
  're-collecting the same post updates in place rather than duplicating',
  sameThreadAgain.captures.length === 2
);
check(
  'the updated capture carries the fresh reaction count',
  sameThreadAgain.captures.find(c => c.postUrl === raw2.postUrl)?.reactionCount === 9
);

const anonRaw = {
  name: '',
  headline: '',
  profileUrl: null,
  isCompany: false,
  isAnonymized: true,
  commentText: 'Interesting take.',
  reactionCount: null,
  commentDate: '3h',
  postUrl: 'https://www.linkedin.com/feed/update/urn:li:activity:3/',
  postLabel: 'Post about hiring',
};
const anonLead = mod.mergeCapture(undefined, anonRaw, now);
check('an anonymized commenter still gets captured', anonLead.name === 'LinkedIn Member');
check('an anonymized commenter is flagged, not dropped', anonLead.isAnonymized === true);
check('an anonymized commenter has no profile url', anonLead.profileUrl === null);

const companyRaw = { ...raw1, profileUrl: '/company/acme-inc/', name: 'Acme Inc' };
const companyLead = mod.mergeCapture(undefined, companyRaw, now);
check('a company page comment is flagged, not dropped', companyLead.isCompany === true);

/* ── CSV export ──────────────────────────────────────────────────────── */

console.log('CSV');
check('plain field is not quoted', mod.csvCell('Jane Doe') === 'Jane Doe');
check('a comma forces quoting', mod.csvCell('Acme, Inc') === '"Acme, Inc"');
check('internal quotes are doubled', mod.csvCell('She said "hi"') === '"She said ""hi"""');
check('a newline forces quoting', mod.csvCell('line one\nline two') === '"line one\nline two"');
check('null becomes an empty cell', mod.csvCell(null) === '');

const csvLeads = [merged, anonLead, companyLead];
const csv = mod.toCsv(csvLeads, rules);
const csvLines = csv.trim().split('\r\n');
check('one header row plus one row per lead', csvLines.length === csvLeads.length + 1);
check('header names the deliverable columns', csvLines[0].startsWith('Name,Headline,Profile URL,Type,Status'));
check('qualified column reflects the rule match', csv.includes('Founder at Acme') && csv.includes(',Yes,'));
check('company rows are typed as Company', csv.includes(',Company,'));
check('anonymized rows are typed as Anonymized', csv.includes(',Anonymized,'));
check('seen-on count is present in the row', new RegExp(`,${mod.seenOnCount(merged)},`).test(csv));

/* ── Markdown export ─────────────────────────────────────────────────── */

console.log('Markdown');
const md = mod.toMarkdown(csvLeads, rules);
check('starts with a heading', md.startsWith('# LinkedIn leads'));
check('qualified leads get a star', md.includes('⭐ Jane Doe'));
check('each capture is quoted', md.includes('> Would love to learn more.'));
check('seen-on count is called out', md.includes('Seen on 2 posts'));
check('an empty list exports without throwing', mod.toMarkdown([], rules).includes('Nothing collected yet'));

/* ── Filenames ───────────────────────────────────────────────────────── */

console.log('filenames');
const when = new Date('2026-09-02T00:00:00Z');
const filename = mod.buildFilename('linkedin-leads', 'csv', when);
check('follows the {prefix} {date}.{ext} convention', filename === 'linkedin-leads 2026-09-02.csv', filename);
check('drops filesystem-hostile characters', !/[\\/:*?"<>|]/.test(mod.buildFilename('a/b:c*d', 'csv', when)));

const longName = mod.buildFilename('x'.repeat(400), 'csv', when);
check('truncates to 120 characters', longName.length <= 120, `${longName.length} chars`);
check('keeps the extension after truncation', longName.endsWith('.csv'));

fs.rmSync(entry, { force: true });
fs.rmSync(bundlePath, { force: true });

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
