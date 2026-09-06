/**
 * Headless checks for the pure logic: script detection + count/date
 * formatting (text.ts), word-wrapping and card geometry (layout.ts — the
 * module this build puts the most weight on, since it's the only part of
 * the canvas rendering pipeline that can be tested without a real canvas),
 * templates, avatar URL handling, and filenames.
 *
 * render.ts, scrape.ts and content.ts are DOM/canvas-bound and covered by
 * the manual checklist in README.md instead — same split every DOM-scraping
 * extension in this portfolio uses (WebHighlighter's anchor.ts/quote.ts,
 * Etsy's extract.ts/stats.ts, etc.).
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

let failures = 0;
function check(name, condition, detail) {
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${detail !== undefined ? ` — ${detail}` : ''}`);
  }
}

/* ── Structural check: no network calls anywhere in src/ ───────────────
 * PRD-28 §6/§9 and PRIVACY.md both state plainly that this extension makes
 * zero network requests of its own. Enforce it, not just document it. The
 * patterns below are deliberately never typed with a trailing "(" in any
 * comment in this file, so this check can't false-positive on itself. */
console.log('network posture');
{
  const forbidden = ['fetch' + '(', 'XMLHttpRequest' + '(', '.sendBeacon' + '(', 'new WebSocket' + '('];
  const offenders = [];
  for (const file of fs.readdirSync(srcDir)) {
    if (!file.endsWith('.ts')) continue;
    const contents = fs.readFileSync(path.join(srcDir, file), 'utf8');
    for (const pattern of forbidden) {
      if (contents.includes(pattern)) offenders.push(`${file}: ${pattern}`);
    }
  }
  check('no network-call patterns in src/*.ts', offenders.length === 0, offenders.join(', '));
}

/* ── Bundle the pure modules for headless import ────────────────────── */

const entry = path.join(os.tmpdir(), `xce-selftest-${process.pid}.mjs`);
fs.writeFileSync(
  entry,
  ['text.ts', 'layout.ts', 'templates.ts', 'avatar.ts', 'filenames.ts']
    .map(file => `export * from ${JSON.stringify(path.join(srcDir, file).replace(/\\/g, '/'))};`)
    .join('\n')
);

const bundlePath = path.join(os.tmpdir(), `xce-selftest-bundle-${process.pid}.mjs`);
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

/* ── text.ts ─────────────────────────────────────────────────────────── */

console.log('text');
check('plain ASCII is ltr', mod.detectDirection('Hello world') === 'ltr');
check('Arabic text is rtl', mod.detectDirection('مرحبا') === 'rtl');
check('Hebrew text is rtl', mod.detectDirection('שלום') === 'rtl');
check('CJK text has no-space script', mod.hasNoSpaceScript('中文测试') === true);
check('Japanese text has no-space script', mod.hasNoSpaceScript('こんにちは') === true);
check('Korean text has no-space script', mod.hasNoSpaceScript('안녕하세요') === true);
check('plain English has no no-space script', mod.hasNoSpaceScript('a normal sentence') === false);

check('cleanText collapses whitespace', mod.cleanText('a   b\n\n c') === 'a b c');
check('cleanText trims', mod.cleanText('  hi  ') === 'hi');

check('formatCount under 1000 is exact', mod.formatCount(999) === '999');
check('formatCount does not round 999 up to a K', mod.formatCount(999) !== '1.0K');
check('formatCount thousands', mod.formatCount(1234) === '1.2K', mod.formatCount(1234));
check('formatCount drops trailing .0', mod.formatCount(2000) === '2K', mod.formatCount(2000));
check('formatCount millions', mod.formatCount(4_500_000) === '4.5M', mod.formatCount(4_500_000));
check('formatCount handles null', mod.formatCount(null) === '0');
check('formatCount handles negative as 0', mod.formatCount(-5) === '0');

check('formatDateLabel formats a valid ISO date', mod.formatDateLabel('2026-01-04T12:00:00.000Z') === 'Jan 4, 2026');
check('formatDateLabel returns empty for garbage input', mod.formatDateLabel('not-a-date') === '');
check('formatDateLabel returns empty for empty input', mod.formatDateLabel('') === '');

/* ── layout.ts: wrapText ─────────────────────────────────────────────── */

console.log('wrapText');

// A deterministic "monospace" measure: every character is 10 units wide.
const mono = s => s.length * 10;

const basic = mod.wrapText('one two three four', 90, mono); // budget: 9 chars/line
check('wraps at word boundaries', basic.every(line => mono(line) <= 90), JSON.stringify(basic));
check('does not split a word that fits on its own line', basic.some(l => l.trim() === 'three'), JSON.stringify(basic));
check('rejoining wrapped lines reproduces the words (order preserved)', basic.join('').replace(/\s+/g, ' ').trim() === 'one two three four');

const longUrl = mod.wrapText('see https://example.com/a-very-long-path-that-does-not-fit-on-one-line-at-all here', 100, mono);
check('a token wider than the line is split, not left overflowing', longUrl.every(line => mono(line) <= 100), JSON.stringify(longUrl));
check('splitting a long token still produces more than one line for it', longUrl.length > 2);

const cjk = mod.wrapText('東京都渋谷区新宿区渋谷駅前', 60, mono); // no spaces at all
check('a no-space CJK run is wrapped by character, not left as one giant line', cjk.length > 1, JSON.stringify(cjk));
check('every wrapped CJK line respects the width budget', cjk.every(line => mono(line) <= 60), JSON.stringify(cjk));

check('empty text wraps to no lines', mod.wrapText('', 100, mono).length === 0);

/* ── layout.ts: truncateLines ───────────────────────────────────────── */

console.log('truncateLines');

const withinLimit = mod.truncateLines(['a', 'b', 'c'], 5, 1000, mono);
check('lines within the cap are untouched', withinLimit.truncated === false && withinLimit.lines.length === 3);

const overLimit = mod.truncateLines(['a', 'b', 'c', 'd', 'e'], 3, 1000, mono);
check('lines over the cap are truncated to maxLines', overLimit.lines.length === 3);
check('truncated is flagged', overLimit.truncated === true);
check('the last kept line ends with an ellipsis', overLimit.lines[2].endsWith('…'), overLimit.lines[2]);

// truncateLines' contract assumes its input lines already fit maxWidth (the
// real pipeline always pipes wrapText()'s output straight into it, and
// wrapText guarantees that per-line width already) — so this test wraps
// first, same as computeCardLayout does, rather than handing truncateLines
// a single raw unwrapped paragraph.
const wrappedLong = mod.wrapText('a very long line of text that is quite wide indeed and keeps going', 50, mono);
const tightEllipsis = mod.truncateLines(wrappedLong, 1, 50, mono);
check('ellipsis truncation still respects the width budget', mono(tightEllipsis.lines[0]) <= 50, mono(tightEllipsis.lines[0]));
check('ellipsis truncation of a multi-line wrap is flagged truncated', tightEllipsis.truncated === true);

/* ── layout.ts: computeCardLayout ───────────────────────────────────── */

console.log('computeCardLayout');

const layoutConfig = {
  width: 640,
  padding: 28,
  avatarSize: 56,
  lineHeight: 30,
  maxLines: 10,
  showMetrics: true,
};

const shortInput = {
  author: 'Ada Lovelace',
  handle: '@ada',
  text: 'Short reply.',
  dateLabel: 'Jan 4, 2026',
  metrics: { replies: 3, reposts: 1, likes: 40 },
};

const longInput = {
  ...shortInput,
  text: Array.from({ length: 20 }, (_, i) => `sentence number ${i} with a few words in it`).join(' '),
};

const shortLayout = mod.computeCardLayout(shortInput, layoutConfig, mono);
const longLayout = mod.computeCardLayout(longInput, layoutConfig, mono);

check('a longer post produces a taller card', longLayout.height > shortLayout.height, `${longLayout.height} vs ${shortLayout.height}`);
check('body text is capped at maxLines', longLayout.textLines.length <= layoutConfig.maxLines);
check('a long post is flagged truncated', longLayout.truncated === true);
check('a short post is not flagged truncated', shortLayout.truncated === false);
check('card width matches config', shortLayout.width === layoutConfig.width);

const noMetricsConfig = { ...layoutConfig, showMetrics: false };
const noMetricsLayout = mod.computeCardLayout(shortInput, noMetricsConfig, mono);
check('hiding metrics produces a shorter card than showing them', noMetricsLayout.height < shortLayout.height, `${noMetricsLayout.height} vs ${shortLayout.height}`);
check('showMetrics flag is carried into the layout', noMetricsLayout.showMetrics === false);

const rtlInput = { ...shortInput, text: 'مرحبا بالعالم' };
const rtlLayout = mod.computeCardLayout(rtlInput, layoutConfig, mono);
check('Arabic body text sets rtl direction', rtlLayout.direction === 'rtl');
check('English body text sets ltr direction', shortLayout.direction === 'ltr');

const noReplyInput = { ...shortInput, metrics: { replies: null, reposts: null, likes: null } };
const noReplyLayout = mod.computeCardLayout(noReplyInput, layoutConfig, mono);
check('a post with no readable metrics renders an empty metrics line, not a crash', noReplyLayout.metricsText === '');

check('metrics line formats each count', mod.computeCardLayout(shortInput, layoutConfig, mono).metricsText.includes('40 likes'));

/* ── templates.ts ────────────────────────────────────────────────────── */

console.log('templates');
check('exactly three templates', mod.TEMPLATE_ORDER.length === 3);
check('every template id resolves to a config', mod.TEMPLATE_ORDER.every(id => mod.TEMPLATES[id]?.id === id));
check('minimal hides metrics (fixed template property, not a toggle)', mod.TEMPLATES.minimal.showMetrics === false);
check('light shows metrics', mod.TEMPLATES.light.showMetrics === true);
check('dark shows metrics', mod.TEMPLATES.dark.showMetrics === true);
check('isTemplateId accepts a known id', mod.isTemplateId('dark') === true);
check('isTemplateId rejects an unknown value', mod.isTemplateId('sepia') === false);
check('isTemplateId rejects undefined', mod.isTemplateId(undefined) === false);

/* ── avatar.ts ───────────────────────────────────────────────────────── */

console.log('avatar');
check(
  'upgrades a _normal suffix to _400x400',
  mod.upgradeAvatarUrl('https://pbs.twimg.com/profile_images/1/foo_normal.jpg') ===
    'https://pbs.twimg.com/profile_images/1/foo_400x400.jpg'
);
check(
  'upgrades a _bigger suffix',
  mod.upgradeAvatarUrl('https://pbs.twimg.com/profile_images/1/foo_bigger.png') ===
    'https://pbs.twimg.com/profile_images/1/foo_400x400.png'
);
check(
  'upgrades an existing small explicit size',
  mod.upgradeAvatarUrl('https://pbs.twimg.com/profile_images/1/foo_200x200.jpg') ===
    'https://pbs.twimg.com/profile_images/1/foo_400x400.jpg'
);
check('leaves a URL with no recognized size suffix unchanged', mod.upgradeAvatarUrl('https://pbs.twimg.com/profile_images/1/foo.jpg') === 'https://pbs.twimg.com/profile_images/1/foo.jpg');
check('leaves an empty string unchanged', mod.upgradeAvatarUrl('') === '');

check('recognizes the real avatar CDN (pbs.twimg.com)', mod.looksLikeAvatarUrl('https://pbs.twimg.com/profile_images/1/foo_normal.jpg') === true);
check('recognizes the default-avatar CDN (abs.twimg.com)', mod.looksLikeAvatarUrl('https://abs.twimg.com/default_profile.png') === true);
check('rejects an unrelated domain, even if it looks similar', mod.looksLikeAvatarUrl('https://pbs.twimg.com.evil.example/x.jpg') === false);
check('rejects a non-CDN https URL', mod.looksLikeAvatarUrl('https://example.com/avatar.jpg') === false);

check('two-word name gives two initials', mod.initialsFor('Ada Lovelace', '@ada') === 'AL');
check('single-word name gives its first two letters', mod.initialsFor('Ada', '@ada') === 'AD');
check('falls back to handle when author is blank', mod.initialsFor('', '@ada') === 'AD');
check('falls back to ? when both are blank', mod.initialsFor('', '') === '?');

/* ── filenames.ts ────────────────────────────────────────────────────── */

console.log('filenames');
const single = mod.buildCardFilename('@ada', 'A post about antifragile systems and how they gain from disorder over time.');
check('single filename ends in .png', single.endsWith('.png'));
check('single filename includes the handle', single.startsWith('@ada'));
check('single filename has no filesystem-hostile characters', !/[\\/:*?"<>|]/.test(single));

const longText = mod.buildCardFilename('@ada', 'x'.repeat(500));
check('long text is truncated to the 120-char budget', longText.length <= 120, `${longText.length} chars`);
check('truncation keeps the extension', longText.endsWith('.png'));

const thread2of5 = mod.buildThreadFilename('@ada', 2, 5);
check('thread filename follows the N of M convention', thread2of5 === '@ada - thread - 2 of 5.png', thread2of5);

fs.rmSync(entry, { force: true });
fs.rmSync(bundlePath, { force: true });

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
