/**
 * Headless checks for the pure logic: the matching engine (case sensitivity,
 * whole-word vs. substring, regex mode, hit counting via the too-broad
 * detector), hashtag extraction, and the starter packs.
 *
 * The matching engine gets the most coverage because it is the whole
 * product — the PRD sets a 5 ms/post budget at 100 rules (§6) and names
 * unicode/emoji handling and invalid-regex safety as explicit edge cases
 * (§7). The DOM-bound half (content.ts, the article-walking parts of
 * extract.ts) needs a real X page and is covered by the manual checklist in
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

const entry = path.join(os.tmpdir(), `xkm-selftest-${process.pid}.mjs`);
fs.writeFileSync(
  entry,
  ['types.ts', 'rules.ts', 'starter-packs.ts', 'extract.ts']
    .map(file => `export * from ${JSON.stringify(path.join(rootDir, 'src', file).replace(/\\/g, '/'))};`)
    .join('\n')
);

const bundlePath = path.join(os.tmpdir(), `xkm-selftest-bundle-${process.pid}.mjs`);
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

function rule(overrides) {
  return {
    id: 'r1',
    value: 'crypto airdrop',
    label: '',
    mode: 'substring',
    caseSensitive: false,
    enabled: true,
    createdAt: 0,
    hitCount: 0,
    ...overrides,
  };
}

/* ── Validation ──────────────────────────────────────────────────────────── */

console.log('rules — validation');

check('a rule with a value is usable', mod.isUsableRule({ value: 'spoiler' }));
check('an empty value is not usable', !mod.isUsableRule({ value: '' }));
check('a whitespace-only value is not usable', !mod.isUsableRule({ value: '   ' }));

/* ── Substring matching ─────────────────────────────────────────────────── */

console.log('rules — substring mode');

const substringRule = rule({ value: 'crypto airdrop', mode: 'substring' });
check(
  'matches a substring anywhere in the haystack',
  mod.compileRule(substringRule).test('Huge crypto airdrop happening now')
);
check(
  'matches inside a longer word (substring is not word-bounded)',
  mod.compileRule(rule({ value: 'spam', mode: 'substring' })).test('this is spammy content')
);
check(
  'is case-insensitive by default',
  mod.compileRule(substringRule).test('CRYPTO AIRDROP incoming')
);
check(
  'a disabled rule compiles to no matcher at all',
  mod.compileRule(rule({ enabled: false })) === null
);
check(
  'an empty value compiles to no matcher',
  mod.compileRule(rule({ value: '   ' })) === null
);

/* ── Whole-word matching ────────────────────────────────────────────────── */

console.log('rules — whole-word mode');

const wholeWordRule = rule({ value: 'spam', mode: 'whole-word' });
check('matches the word on its own', mod.compileRule(wholeWordRule).test('this post is spam'));
check(
  'does NOT match inside a longer word',
  !mod.compileRule(wholeWordRule).test('this is spammy content')
);
check(
  'matches at a punctuation boundary',
  mod.compileRule(wholeWordRule).test('spam, spam, and more spam!')
);
check(
  'whole-word handles unicode letters as word characters (PRD §7)',
  !mod.compileRule(rule({ value: 'café', mode: 'whole-word' })).test('cafécafé is not a match')
);
check(
  'whole-word still matches a standalone unicode word',
  mod.compileRule(rule({ value: 'café', mode: 'whole-word' })).test('let us get café today')
);
check(
  'whole-word matches a rule value containing an emoji as a literal unit',
  mod.compileRule(rule({ value: '🧵', mode: 'whole-word' })).test('new thread 🧵 below')
);

/* ── Case sensitivity ────────────────────────────────────────────────────── */

console.log('rules — case sensitivity');

const caseSensitiveRule = rule({ value: 'NFT', mode: 'substring', caseSensitive: true });
check('case-sensitive rule matches exact case', mod.compileRule(caseSensitiveRule).test('grab this NFT now'));
check(
  'case-sensitive rule does not match a different case',
  !mod.compileRule(caseSensitiveRule).test('grab this nft now')
);
check(
  'case-insensitive rule (default) matches either case',
  mod.compileRule(rule({ value: 'NFT', mode: 'substring', caseSensitive: false })).test('grab this nft now')
);

/* ── Regex mode ──────────────────────────────────────────────────────────── */

console.log('rules — regex mode');

const regexRule = rule({ value: '\\bnfts?\\b', mode: 'regex' });
check('a valid regex rule compiles and matches', mod.compileRule(regexRule).test('are NFTs still a thing'));
check('a valid regex rule respects its own non-match', !mod.compileRule(regexRule).test('nftfoo is not a match'));

const invalidRegexRule = rule({ value: '(unterminated', mode: 'regex' });
check('an invalid regex compiles to no matcher, not a throw', mod.compileRule(invalidRegexRule) === null);
check('isValidPattern reports the same invalid regex as invalid', !mod.isValidPattern(invalidRegexRule));
check('isValidPattern reports a valid regex as valid', mod.isValidPattern(regexRule));

/* ── Haystack + hashtags ─────────────────────────────────────────────────── */

console.log('haystack + hashtags');

const haystack = mod.buildHaystack({ text: 'Big news today', author: 'Jane Doe', hashtags: ['#crypto'] });
check('haystack combines text, author and hashtags', haystack === 'Big news today Jane Doe #crypto');
check(
  'a rule can match against the author name',
  mod.matchPost({ text: 'hello world', author: 'CryptoBot9000', hashtags: [] }, [
    rule({ value: 'cryptobot', mode: 'substring' }),
  ]) !== null
);

const tags = mod.extractHashtags('Loving the #NFTdrop and the #spoilers thread, avoid #spoilers though');
check('extracts every hashtag', tags.includes('#NFTdrop') && tags.includes('#spoilers'));
check('dedupes repeated hashtags', tags.filter(t => t === '#spoilers').length === 1);
check('no hashtags in plain text returns an empty array', mod.extractHashtags('just a normal post').length === 0);

/* ── matchPost + placeholder ─────────────────────────────────────────────── */

console.log('matchPost + placeholder');

const rules = [
  rule({ id: 'r1', value: 'spoiler', mode: 'whole-word' }),
  rule({ id: 'r2', value: 'crypto airdrop', mode: 'substring' }),
];

const spoilerMatch = mod.matchPost({ text: 'huge spoiler in this episode', author: '', hashtags: [] }, rules);
check('matchPost returns the first firing rule', spoilerMatch?.ruleId === 'r1', JSON.stringify(spoilerMatch));
check(
  'matchPost returns null when nothing fires',
  mod.matchPost({ text: 'a totally unrelated post', author: 'Someone', hashtags: [] }, rules) === null
);
check(
  'a disabled rule never fires even if its value is present',
  mod.matchPost({ text: 'huge spoiler here', author: '', hashtags: [] }, [rule({ id: 'r1', value: 'spoiler', mode: 'whole-word', enabled: false })]) ===
    null
);
check(
  'the placeholder uses the rule label when set, else the raw value',
  mod.formatPlaceholder({ ruleId: 'r1', label: 'crypto airdrop' }) === 'Hidden by filter: "crypto airdrop"'
);

const labeledRule = rule({ id: 'r3', value: '\\bnfts?\\b', mode: 'regex', label: 'NFT spam' });
const labeledMatch = mod.matchPost({ text: 'are NFTs still a thing', author: '', hashtags: [] }, [labeledRule]);
check('matchPost prefers the rule label over the raw value', labeledMatch?.label === 'NFT spam');

/* ── Too-broad detector ──────────────────────────────────────────────────── */

console.log('too-broad detector');

check('does not flag before the minimum sample size', !mod.isRuleTooBroad(15, 15));
check('does not flag a rule under the ratio threshold', !mod.isRuleTooBroad(9, 20));
check('flags a rule clearly over the ratio threshold', mod.isRuleTooBroad(15, 20));
check('a rule matching literally everything is flagged', mod.isRuleTooBroad(50, 50));
check('a rule matching almost nothing is never flagged', !mod.isRuleTooBroad(1, 500));

/* ── Token parsing (starter-pack / bulk-add helper) ──────────────────────── */

console.log('token parsing');

const tokens = mod.parseTokenList('spoiler, airdrop\nNFT,,  \nSpoiler');
check('splits on commas and newlines', tokens.includes('airdrop'));
check('drops empty entries', !tokens.includes(''));
check('dedupes case-insensitively, keeping first casing', tokens.filter(t => t.toLowerCase() === 'spoiler').length === 1);

/* ── Starter packs ───────────────────────────────────────────────────────── */

console.log('starter packs');

check('ships at least the four packs the PRD names', mod.STARTER_PACKS.length >= 4);
check(
  'spoilers, politics, crypto-spam and engagement-bait packs all exist',
  ['spoilers', 'politics', 'crypto-spam', 'engagement-bait'].every(id => mod.STARTER_PACKS.some(p => p.id === id))
);
for (const pack of mod.STARTER_PACKS) {
  check(`"${pack.label}" starter pack has at least one rule`, pack.rules.length > 0);
  for (const packRule of pack.rules) {
    check(
      `"${pack.label}" rule "${packRule.value}" is usable and compiles cleanly`,
      mod.isUsableRule(packRule) && mod.isValidPattern(packRule)
    );
  }
}

/* ── Performance budget: PRD §6, < 5ms per post at 100 rules ─────────────── */

console.log('performance');

const manyRules = Array.from({ length: 100 }, (_, i) =>
  rule({ id: `r${i}`, value: `needle ${i}`, mode: i % 3 === 0 ? 'regex' : i % 3 === 1 ? 'whole-word' : 'substring' })
);
const longPost = {
  text: 'a perfectly ordinary post about nothing in particular, scrolled past very quickly. '.repeat(20),
  author: 'Someone Ordinary',
  hashtags: ['#nothingtoseehere'],
};
// The budget (PRD §6) is the steady-state per-post cost on a fast-scrolling
// timeline, where the same 100 rules are evaluated against post after post —
// not the one-time cost of compiling a rule the first time it's used. Warm
// the per-rule matcher cache (see rules.ts's `compileCache`) with one post
// first, exactly as the content script's first scan of a session would, then
// measure the next post the same way every subsequent one is measured.
mod.matchPost(longPost, manyRules);
const started = process.hrtime.bigint();
mod.matchPost(longPost, manyRules);
const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
check('matchPost stays under the 5ms/post budget at 100 rules (steady state)', elapsedMs < 5, `${elapsedMs.toFixed(2)}ms`);

fs.rmSync(entry, { force: true });
fs.rmSync(bundlePath, { force: true });

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
