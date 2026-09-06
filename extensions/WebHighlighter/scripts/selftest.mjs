/**
 * Headless checks for the pure logic: quote anchoring, URL normalization, the
 * four export formats, filenames and the PDF byte layout.
 *
 * Anchoring is the risk the PRD calls out above all others (§7), so it gets the
 * most coverage here — reflowed whitespace, duplicate sentences, edited
 * paragraphs, and the case that must fail rather than guess. The DOM-bound
 * halves (content script, extraction, HTML→Markdown) need a browser and are
 * covered by the manual checklist in the README.
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

const entry = path.join(os.tmpdir(), `wh-selftest-${process.pid}.mjs`);
fs.writeFileSync(
  entry,
  ['quote.ts', 'url.ts', 'formatters.ts', 'pdf.ts']
    .map(file => `export * from ${JSON.stringify(path.join(rootDir, 'src', file).replace(/\\/g, '/'))};`)
    .join('\n')
);

const bundlePath = path.join(os.tmpdir(), `wh-selftest-bundle-${process.pid}.mjs`);
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

/* ── URL normalization ───────────────────────────────────────────────── */

console.log('urls');
const canonical = 'https://example.com/posts/anti-fragile';
check(
  'strips utm parameters',
  mod.normalizeUrl(`${canonical}?utm_source=newsletter&utm_medium=email`) === canonical,
  mod.normalizeUrl(`${canonical}?utm_source=newsletter`)
);
check('strips the fragment', mod.normalizeUrl(`${canonical}#section-3`) === canonical);
check('drops www and trailing slash', mod.normalizeUrl('https://www.example.com/posts/anti-fragile/') === canonical);
check('keeps meaningful query parameters', mod.normalizeUrl(`${canonical}?page=2`) === `${canonical}?page=2`);
check(
  'parameter order does not create a second key',
  mod.normalizeUrl(`${canonical}?b=2&a=1`) === mod.normalizeUrl(`${canonical}?a=1&b=2`)
);
check('keeps a bare origin usable', mod.normalizeUrl('https://example.com/') === 'https://example.com/');
check('rejects chrome pages', mod.isSupportedUrl('chrome://extensions') === false);
check('accepts https pages', mod.isSupportedUrl('https://example.com') === true);
check('site name drops www', mod.siteName('https://www.example.com/x') === 'example.com');

/* ── Anchoring ───────────────────────────────────────────────────────── */

console.log('anchoring');

const page =
  'Antifragility is beyond resilience or robustness. ' +
  'The resilient resists shocks and stays the same; the antifragile gets better. ' +
  'This property is behind everything that has changed with time. ' +
  'The resilient resists shocks and stays the same; the antifragile gets better. ' +
  'Wind extinguishes a candle and energizes fire.';

const quote = 'the antifragile gets better';
const secondAt = page.lastIndexOf(quote);
const selector = mod.describeQuote(page, secondAt, secondAt + quote.length);

check('describe captures the exact text', selector.exact === quote);
check('describe captures 32 characters of context', selector.prefix.length === 32 && selector.suffix.length > 0);

const exactHit = mod.findQuote(page, selector);
check('exact pass finds the quote', exactHit?.pass === 'exact');
check(
  'context disambiguates two identical sentences',
  exactHit?.start === secondAt,
  `expected ${secondAt}, got ${exactHit?.start}`
);

// The same page after a rebuild: reflowed whitespace and a new paragraph on top.
const reflowed = 'A newly inserted introduction paragraph.\n\n' + page.replace(/ /g, '\n   ');
const reflowedHit = mod.findQuote(reflowed, selector);
check('whitespace pass survives reflowed markup', reflowedHit !== null && reflowedHit.pass === 'whitespace');
check(
  'whitespace pass lands on the right text',
  reflowedHit && reflowed.slice(reflowedHit.start, reflowedHit.end).replace(/\s+/g, ' ') === quote,
  reflowedHit && JSON.stringify(reflowed.slice(reflowedHit.start, reflowedHit.end))
);

// A longer quote that the author has since edited in the middle.
const longQuote = 'The resilient resists shocks and stays the same; the antifragile gets better.';
const longSelector = mod.describeQuote(page, page.indexOf(longQuote), page.indexOf(longQuote) + longQuote.length);
const edited = page.replace(
  'The resilient resists shocks and stays the same; the antifragile gets better.',
  'The resilient resists shocks and merely stays the same, whereas the antifragile gets better.'
);
const fuzzyHit = mod.findQuote(edited, longSelector);
check('fuzzy pass recovers an edited sentence', fuzzyHit !== null, 'no match');
check('fuzzy matches score below exact ones', !fuzzyHit || fuzzyHit.score < exactHit.score);

check('a quote that is genuinely gone returns null', mod.findQuote('Completely different content.', selector) === null);
check('an empty selector never matches', mod.findQuote(page, { exact: '', prefix: '', suffix: '', hint: 0 }) === null);

// Position drift alone must not move a match onto the wrong sentence.
const drifted = 'x'.repeat(5000) + page;
const driftedHit = mod.findQuote(drifted, selector);
check(
  'position hint does not override context after a large shift',
  driftedHit && drifted.slice(driftedHit.start, driftedHit.end) === quote,
  driftedHit && drifted.slice(driftedHit.start, driftedHit.end)
);

/* ── Export formats ──────────────────────────────────────────────────── */

console.log('exports');

const state = {
  meta: {
    url: 'https://example.com/posts/anti-fragile',
    title: 'Antifragile: things that gain from disorder / part 1',
    author: 'N. N. Taleb',
    site: 'example.com',
    published: '2026-01-04',
    captured: '2026-08-15',
  },
  pageNote: 'Read this before the strategy review.',
  unsupported: null,
  highlights: [
    {
      id: 'h1',
      color: 'yellow',
      exact: 'Wind extinguishes a candle and energizes fire.',
      prefix: '',
      suffix: '',
      hint: 0,
      note: 'Use as the opener.',
      createdAt: 2,
      anchored: true,
      order: 1,
    },
    {
      id: 'h2',
      color: 'green',
      exact: 'Antifragility is beyond resilience or robustness.',
      prefix: '',
      suffix: '',
      hint: 0,
      note: '',
      createdAt: 1,
      anchored: true,
      order: 0,
    },
    {
      id: 'h3',
      color: 'blue',
      exact: 'A quote from a paragraph the site has since deleted.',
      prefix: '',
      suffix: '',
      hint: 0,
      note: 'Still matters.',
      createdAt: 3,
      anchored: false,
      order: -1,
    },
  ],
};

const options = { includeMeta: true, includeNotes: true, includeSourceUrl: false };
const article = {
  markdown: '## Heading\n\nSome ==highlighted== body text.',
  html: '<h2>Heading</h2><p>Some <mark>highlighted</mark> body text.</p>',
  text: 'Heading\n\nSome highlighted body text.',
  fallback: false,
};

const highlightsInput = { state, options, scope: 'highlights' };
const pageInput = { state, options, scope: 'page', article };

const md = mod.toMarkdown(highlightsInput);
check('markdown opens with YAML front matter', md.startsWith('---\ntitle: "'));
check('front matter carries the source url', md.includes(`source: "${state.meta.url}"`));
check('quotes are blockquotes', md.includes('> Wind extinguishes a candle and energizes fire.'));
check('highlights come out in document order', md.indexOf('Antifragility is beyond') < md.indexOf('Wind extinguishes'));
check('notes appear beneath their highlight', md.includes('Use as the opener.'));
check('the page note is carried through', md.includes('Read this before the strategy review.'));
// The one unrecoverable failure this product can have is losing a note, so an
// unanchored highlight must still export in full.
check('unanchored highlights still export', md.includes('A quote from a paragraph the site has since deleted.'));
check('unanchored highlights are labelled', md.includes('could not be located'));
check('unanchored highlights keep their note', md.includes('Still matters.'));

const noMeta = mod.toMarkdown({ ...highlightsInput, options: { ...options, includeMeta: false } });
check('metadata can be turned off', !noMeta.startsWith('---'));
const noNotes = mod.toMarkdown({ ...highlightsInput, options: { ...options, includeNotes: false } });
check('notes can be turned off', !noNotes.includes('Use as the opener.'));
const withUrls = mod.toMarkdown({ ...highlightsInput, options: { ...options, includeSourceUrl: true } });
check('per-highlight source links can be turned on', withUrls.includes(`[Source](${state.meta.url})`));

const pageMd = mod.toMarkdown(pageInput);
check('full-page scope emits the article body', pageMd.includes('## Heading'));
check('full-page scope does not repeat the highlight list', !pageMd.includes('> Wind extinguishes'));

const html = mod.toHtml(highlightsInput);
check('html is a complete document', html.startsWith('<!doctype html>') && html.includes('</html>'));
check('html carries no scripts', !/<script/i.test(html));
check('html preserves highlights as <mark>', html.includes('<mark>Wind extinguishes'));
check(
  'html escapes the title',
  mod.toHtml({ ...highlightsInput, state: { ...state, meta: { ...state.meta, title: '<img src=x>' } } }).includes(
    '&lt;img src=x&gt;'
  )
);

const txt = mod.toPlainText(highlightsInput);
check('text export has no markdown syntax', !txt.includes('**') && !txt.includes('> '));
check('text export includes the source url', txt.includes(state.meta.url));
check('text export numbers the highlights', /1\. Antifragility is beyond/.test(txt));

const empty = mod.toMarkdown({ ...highlightsInput, state: { ...state, highlights: [] } });
check('an empty page exports without throwing', empty.includes('No highlights on this page yet'));

/* ── Filenames ───────────────────────────────────────────────────────── */

console.log('filenames');
const filename = mod.buildFilename(state.meta, 'md');
check(
  'follows the {site} - {title}.{ext} convention',
  filename === 'example.com - Antifragile things that gain from disorder part 1.md',
  filename
);
check('drops filesystem-hostile characters', !/[\\/:*?"<>|]/.test(filename));

const longName = mod.buildFilename({ ...state.meta, title: 'x'.repeat(400) }, 'pdf');
check('truncates to 120 characters', longName.length <= 120, `${longName.length} chars`);
check('keeps the extension after truncation', longName.endsWith('.pdf'));

/* ── PDF ─────────────────────────────────────────────────────────────── */

console.log('pdf');
const manyHighlights = {
  ...state,
  highlights: Array.from({ length: 120 }, (_, i) => ({
    ...state.highlights[0],
    id: `h${i}`,
    exact: `Highlight number ${i}: ${'a fairly long sentence to force wrapping and pagination. '.repeat(2)}`,
    order: i,
  })),
};

const pdf = mod.generatePdf(mod.toPdfDocument({ state: manyHighlights, options, scope: 'highlights' }));
const bytes = new Uint8Array(await pdf.blob.arrayBuffer());
const text = Buffer.from(bytes).toString('latin1');

check('has a PDF header', text.startsWith('%PDF-1.4'));
check('ends with EOF', text.trimEnd().endsWith('%%EOF'));
check('reports no unsupported characters for ASCII', pdf.unsupportedCharacters.length === 0, pdf.unsupportedCharacters.join(''));
check('paginates a long export', (text.match(/\/Type \/Page[^s]/g) || []).length > 1, `${(text.match(/\/Type \/Page[^s]/g) || []).length} pages`);

// The real risk in a hand-rolled PDF is the cross-reference table.
const startxref = Number(text.match(/startxref\s+(\d+)/)[1]);
check('startxref points at the xref table', text.slice(startxref, startxref + 4) === 'xref');

const entries = [...text.slice(startxref).matchAll(/^(\d{10}) (\d{5}) ([nf])/gm)];
let offsetsOk = true;
entries.forEach(([, offset, , type], index) => {
  if (type === 'f') return;
  if (!text.slice(Number(offset)).startsWith(`${index} 0 obj`)) offsetsOk = false;
});
check('every xref offset lands on its object', offsetsOk);
check('xref size matches the object count', entries.length === Number(text.match(/\/Size (\d+)/)[1]));

const cyrillic = mod.generatePdf({ title: 'Привет мир', header: [], lines: [{ label: '', text: 'Привет' }] });
check('flags characters a standard PDF font cannot draw', cyrillic.unsupportedCharacters.length > 0);

const outPdf = path.join(rootDir, 'dist', 'selftest-sample.pdf');
if (fs.existsSync(path.dirname(outPdf))) {
  fs.writeFileSync(outPdf, bytes);
  console.log(`\nSample PDF written to ${path.relative(process.cwd(), outPdf)} — open it to eyeball the layout.`);
}

fs.rmSync(entry, { force: true });
fs.rmSync(bundlePath, { force: true });

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
