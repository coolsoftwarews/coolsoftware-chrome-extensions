/**
 * Headless checks for the pure logic: the classify.ts decision module (the
 * only thing in this extension that doesn't need a live LinkedIn DOM), plus
 * a static grep guarding the PRD's "no network requests, anywhere in the
 * codebase" privacy claim (§6). See README.md's manual test checklist for
 * the LinkedIn-DOM-bound half (src/content.ts), which needs a real browser
 * and a real feed.
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

const entry = path.join(os.tmpdir(), `liff-selftest-${process.pid}.mjs`);
fs.writeFileSync(
  entry,
  ['classify.ts']
    .map(file => `export * from ${JSON.stringify(path.join(rootDir, 'src', file).replace(/\\/g, '/'))};`)
    .join('\n')
);

const bundlePath = path.join(os.tmpdir(), `liff-selftest-bundle-${process.pid}.mjs`);
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

/* ── isPromotedLabel ─────────────────────────────────────────────────── */

console.log('isPromotedLabel');
check('exact "Promoted"', mod.isPromotedLabel('Promoted') === true);
check('lowercase, padded', mod.isPromotedLabel('  promoted  ') === true);
check('"Ad"', mod.isPromotedLabel('Ad') === true);
check('"Sponsored"', mod.isPromotedLabel('Sponsored') === true);
check('"Promoted content"', mod.isPromotedLabel('Promoted content') === true);
check('"Promoted post"', mod.isPromotedLabel('Promoted post') === true);
check('a real timestamp label is not promoted', mod.isPromotedLabel('2h') === false);
check('a real timestamp with edited marker is not promoted', mod.isPromotedLabel('Edited • 3d') === false);
check(
  'a real post whose text mentions the word is not misclassified (length guard)',
  mod.isPromotedLabel('I promoted my friend to manager today, so proud of her') === false
);
check('empty string is not promoted', mod.isPromotedLabel('') === false);

/* ── isSuggestionHeading ─────────────────────────────────────────────── */

console.log('isSuggestionHeading');
check('exact "People you may know"', mod.isSuggestionHeading('People you may know') === true);
check('"Add to your feed"', mod.isSuggestionHeading('Add to your feed') === true);
check('trailing detail still matches (starts with the phrase)', mod.isSuggestionHeading('People you may know from Acme Corp') === true);
check(
  'a real, unrelated heading is not matched',
  mod.isSuggestionHeading('Notifications') === false
);
check(
  'a long sentence that only contains the phrase mid-way is not matched (no bare substring match)',
  mod.isSuggestionHeading(
    'I was looking through people you may know today and found an old colleague, small world honestly'
  ) === false
);

/* ── isTrendingHeading ───────────────────────────────────────────────── */

console.log('isTrendingHeading');
check('"LinkedIn News"', mod.isTrendingHeading('LinkedIn News') === true);
check('"Trending now"', mod.isTrendingHeading('Trending now') === true);
check('a post title is not matched', mod.isTrendingHeading('My thoughts on trending now in fintech') === false);

/* ── isAlgorithmicSignal ─────────────────────────────────────────────── */

console.log('isAlgorithmicSignal');
check('"Suggested"', mod.isAlgorithmicSignal('Suggested') === true);
check('"2h • Suggested"', mod.isAlgorithmicSignal('2h • Suggested') === true);
check('"3d • Because you follow Jane Doe"', mod.isAlgorithmicSignal('3d • Because you follow Jane Doe') === true);
check('a plain timestamp is not algorithmic', mod.isAlgorithmicSignal('5h') === false);
check('an edited-post timestamp is not algorithmic', mod.isAlgorithmicSignal('Edited • 1w') === false);

/* ── shouldHideByFeature — toggle gating ─────────────────────────────── */

console.log('shouldHideByFeature');
const allOn = {
  hidePromoted: true,
  hideSuggestions: true,
  hideTrending: true,
  hideAlgorithmic: true,
  hideReactionCounts: true,
  focusMode: false,
};
const allOff = {
  hidePromoted: false,
  hideSuggestions: false,
  hideTrending: false,
  hideAlgorithmic: false,
  hideReactionCounts: false,
  focusMode: false,
};

check('promoted post hidden when toggle on and label matches', mod.shouldHideByFeature('promoted', 'Promoted', allOn) === true);
check('promoted post never hidden when its own toggle is off', mod.shouldHideByFeature('promoted', 'Promoted', allOff) === false);
check(
  'a toggle being on does not hide content that does not match the feature',
  mod.shouldHideByFeature('promoted', '2h', allOn) === false
);
check(
  'each toggle only gates its own feature, not the others',
  mod.shouldHideByFeature('trending', 'Promoted', allOn) === false
);
check('reactionCounts hides purely on its own toggle (no label to classify)', mod.shouldHideByFeature('reactionCounts', '', allOn) === true);
check('reactionCounts respects its toggle being off', mod.shouldHideByFeature('reactionCounts', '', allOff) === false);

/* ── DEFAULT_TOGGLES / TOGGLE_ORDER / mergeToggles ──────────────────── */

console.log('DEFAULT_TOGGLES');
check('declutter toggles default on', mod.DEFAULT_TOGGLES.hidePromoted && mod.DEFAULT_TOGGLES.hideSuggestions && mod.DEFAULT_TOGGLES.hideTrending && mod.DEFAULT_TOGGLES.hideAlgorithmic);
check('reaction counts default off (PRD §4)', mod.DEFAULT_TOGGLES.hideReactionCounts === false);
check('focus mode defaults off (PRD §4)', mod.DEFAULT_TOGGLES.focusMode === false);
check('TOGGLE_ORDER lists exactly the six keys once each', mod.TOGGLE_ORDER.length === 6 && new Set(mod.TOGGLE_ORDER).size === 6);
check(
  'every key in TOGGLE_ORDER exists on DEFAULT_TOGGLES',
  mod.TOGGLE_ORDER.every(key => Object.prototype.hasOwnProperty.call(mod.DEFAULT_TOGGLES, key))
);

console.log('mergeToggles');
check('null stored value falls back to defaults', JSON.stringify(mod.mergeToggles(null)) === JSON.stringify(mod.DEFAULT_TOGGLES));
check('undefined stored value falls back to defaults', JSON.stringify(mod.mergeToggles(undefined)) === JSON.stringify(mod.DEFAULT_TOGGLES));
const partial = mod.mergeToggles({ hidePromoted: false });
check('a partial stored value only overrides what it sets', partial.hidePromoted === false && partial.hideSuggestions === true);

fs.rmSync(entry, { force: true });
fs.rmSync(bundlePath, { force: true });

/* ── Static privacy guard: no network APIs anywhere in src/ ────────────
 * PRD §6: "No network requests, anywhere in the codebase — verifiable in
 * devtools and by reading the source." Enforced here, not just claimed in
 * docs, so a future change can't silently violate it. Deliberately does not
 * spell out the exact substrings being checked for inside this comment (the
 * grep would then flag this file itself).
 */

console.log('privacy guard');
const forbidden = [['fe', 'tch('].join(''), 'XMLHttpRequest(', ['sendB', 'eacon('].join(''), 'new WebSocket('];
const srcDir = path.join(rootDir, 'src');
const srcFiles = fs.readdirSync(srcDir).filter(f => f.endsWith('.ts'));
let networkCallFound = false;
for (const file of srcFiles) {
  const contents = fs.readFileSync(path.join(srcDir, file), 'utf8');
  for (const needle of forbidden) {
    if (contents.includes(needle)) {
      networkCallFound = true;
      console.log(`  FAIL   found "${needle}" in ${file}`);
    }
  }
}
check('no network-request API appears anywhere in src/*.ts', !networkCallFound);

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
