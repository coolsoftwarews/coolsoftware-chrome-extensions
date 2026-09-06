/**
 * Headless checks for the pure logic: text parsing, relative-time formatting,
 * fuzzy-key matching, and CSV export. This is everything that does not need a
 * DOM — see README.md's manual test checklist for the LinkedIn-DOM-bound half
 * (src/content.ts), which needs a real browser and a real profile page.
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

const entry = path.join(os.tmpdir(), `lpn-selftest-${process.pid}.mjs`);
fs.writeFileSync(
  entry,
  ['text.ts', 'export.ts']
    .map(file => `export * from ${JSON.stringify(path.join(rootDir, 'src', file).replace(/\\/g, '/'))};`)
    .join('\n')
);

const bundlePath = path.join(os.tmpdir(), `lpn-selftest-bundle-${process.pid}.mjs`);
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

/* ── Text helpers ────────────────────────────────────────────────────── */

console.log('truncateText');
check('short text is untouched', mod.truncateText('hello world') === 'hello world');
const long = mod.truncateText('a'.repeat(500), 300);
check('long text is capped', long.length === 301, `${long.length}`); // 300 chars + ellipsis
check('long text ends with an ellipsis', long.endsWith('…'));
check('whitespace collapses', mod.truncateText('a\n\n  b   c') === 'a b c');
// Non-English text must survive untouched (PRD §7 — headlines/notes in any language).
check('non-English text is preserved', mod.truncateText('こんにちは、世界') === 'こんにちは、世界');

console.log('normalizeProfileUrl');
check(
  'profile URL drops query and trailing slash',
  mod.normalizeProfileUrl('https://www.linkedin.com/in/janedoe/?trk=abc') === 'https://www.linkedin.com/in/janedoe'
);
check('relative profile path resolves', mod.normalizeProfileUrl('/in/johndoe') === 'https://www.linkedin.com/in/johndoe');
check(
  'a vanity slug with unicode decodes cleanly',
  mod.normalizeProfileUrl('https://www.linkedin.com/in/jos%C3%A9-garc%C3%ADa/') ===
    'https://www.linkedin.com/in/josé-garcía'
);

console.log('fuzzyKey');
check(
  'same name+headline, different casing and spacing, match',
  mod.fuzzyKey('Jane Doe', 'Head of Sales') === mod.fuzzyKey('  jane   doe ', 'HEAD OF SALES')
);
check(
  'punctuation differences still match',
  mod.fuzzyKey('Jane Doe', 'Head of Sales, Acme') === mod.fuzzyKey('Jane Doe.', 'Head of Sales — Acme')
);
check('different names do not match', mod.fuzzyKey('Jane Doe', 'Sales') !== mod.fuzzyKey('John Doe', 'Sales'));
check('accented characters normalize the same as their plain form', mod.fuzzyKey('José García', '') === mod.fuzzyKey('Jose Garcia', ''));

console.log('formatRelativeTime');
const now = new Date('2026-09-02T00:00:00.000Z').getTime();
check('just now', mod.formatRelativeTime(now - 10_000, now) === 'just now');
check('minutes ago', mod.formatRelativeTime(now - 5 * 60_000, now) === '5 minutes ago');
check('one hour ago is singular', mod.formatRelativeTime(now - 60 * 60_000, now) === '1 hour ago');
check('days ago', mod.formatRelativeTime(now - 3 * 86_400_000, now) === '3 days ago');
check('months ago', mod.formatRelativeTime(now - 90 * 86_400_000, now) === '3 months ago');
check('years ago', mod.formatRelativeTime(now - 400 * 86_400_000, now) === '1 year ago');
check('never negative for a future timestamp', mod.formatRelativeTime(now + 10_000, now) === 'just now');

/* ── Export ──────────────────────────────────────────────────────────── */

console.log('toCsv');
const notes = [
  {
    id: 'https://www.linkedin.com/in/janedoe',
    name: 'Jane "The Closer" Doe',
    headline: 'Head of Sales, Acme',
    avatarUrl: '',
    text: 'Met at the conference, discussing a senior AE role',
    tag: 'candidate',
    firstNotedAt: now - 5 * 86_400_000,
    lastNotedAt: now,
  },
  {
    id: 'https://www.linkedin.com/in/johnsmith',
    name: 'John Smith, Jr',
    headline: '',
    avatarUrl: '',
    text: 'Multi\nline note',
    tag: '',
    firstNotedAt: now,
    lastNotedAt: now,
  },
];
const csv = mod.toCsv(notes);
const lines = csv.trim().split('\r\n');
check('header row matches PRD §4 columns', lines[0] === 'name,headline,tag,note,profile_url,first_noted,last_noted');
check('a name with quotes is escaped', lines[1].includes('"Jane ""The Closer"" Doe"'));
check('a comma in a name is quoted', lines[2].includes('"John Smith, Jr"'));
check('a newline in note text is quoted', csv.includes('"Multi\nline note"'));
check('tag is included by default', lines[1].includes(',candidate,'));
check('an empty tag leaves an empty cell, not a missing one', lines[2].startsWith('"John Smith, Jr",,,"Multi'));

console.log('buildFilename');
check('csv filename has the right shape', /^linkedin-profile-notes-\d{4}-\d{2}-\d{2}\.csv$/.test(mod.buildFilename('csv')));

fs.rmSync(entry, { force: true });
fs.rmSync(bundlePath, { force: true });

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
