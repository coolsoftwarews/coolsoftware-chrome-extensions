/**
 * Headless checks for the pure logic: field fallback chains, name inversion,
 * date rendering, URL cleanup, and all five output formats — every one of
 * them checked with fields present AND with fields individually missing,
 * because PRD §5's rule ("no missing field may ever produce a visible
 * artifact") is the thing most likely to quietly break.
 *
 * Nothing here touches a browser: `citation.ts` is pure by construction, and
 * the one DOM-touching function (`extract.ts`'s `collectRawMeta`) is a thin
 * shim covered by the manual checklist in the README instead.
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

const entry = path.join(os.tmpdir(), `ucc-selftest-${process.pid}.mjs`);
fs.writeFileSync(
  entry,
  `export * from ${JSON.stringify(path.join(rootDir, 'src', 'citation.ts').replace(/\\/g, '/'))};`
);

const bundlePath = path.join(os.tmpdir(), `ucc-selftest-bundle-${process.pid}.mjs`);
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
const {
  deriveMetadata,
  formatMarkdownLink,
  formatPlainUrl,
  formatAPA,
  formatMLA,
  formatChicago,
  formatCitation,
  invertAuthorName,
  cleanCitationUrl,
  hostnameOf,
  isSupportedPageUrl,
  parseDateParts,
} = mod;

let failures = 0;
function check(name, condition, detail) {
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/** No formatter output should ever contain these — the whole point of §5. */
const FORBIDDEN_PATTERNS = [/undefined/i, /\bnull\b/, /\(\)/, /,\s*,/, /\.\s*\./, /"\s*"/, /\[\]/];
function checkClean(name, text) {
  for (const pattern of FORBIDDEN_PATTERNS) {
    check(`${name}: no artifact matching ${pattern}`, !pattern.test(text), text);
  }
}

function rawMeta(overrides = {}) {
  return {
    documentTitle: 'Doc Title',
    ogTitle: 'OG Title',
    ogSiteName: 'Example Site',
    metaAuthor: 'Jane Doe',
    articleAuthor: null,
    relAuthorText: null,
    bylineText: null,
    publishedTime: '2024-03-05T12:00:00Z',
    canonicalUrl: 'https://example.com/posts/anti-fragile',
    locationHref: 'https://example.com/posts/anti-fragile?utm_source=x',
    h1Text: 'H1 Title',
    ...overrides,
  };
}

/* ── URL handling ─────────────────────────────────────────────────────── */

console.log('urls');
check(
  'cleanCitationUrl strips utm params',
  mod.cleanCitationUrl('https://example.com/a?utm_source=news&x=1') === 'https://example.com/a?x=1'
);
check('cleanCitationUrl strips the hash', mod.cleanCitationUrl('https://example.com/a#section') === 'https://example.com/a');
check('cleanCitationUrl keeps non-tracking params', mod.cleanCitationUrl('https://example.com/a?page=2') === 'https://example.com/a?page=2');
check('hostnameOf strips www', hostnameOf('https://www.example.com/x') === 'example.com');
check('hostnameOf handles a bare host', hostnameOf('https://example.com') === 'example.com');
check('isSupportedPageUrl accepts https', isSupportedPageUrl('https://example.com') === true);
check('isSupportedPageUrl rejects chrome://', isSupportedPageUrl('chrome://extensions') === false);
check('isSupportedPageUrl rejects file://', isSupportedPageUrl('file:///C:/x.html') === false);
check('isSupportedPageUrl rejects undefined', isSupportedPageUrl(undefined) === false);

/* ── deriveMetadata fallback chains (PRD §5) ─────────────────────────────── */

console.log('deriveMetadata — fallback chains');

const full = deriveMetadata(rawMeta());
check('title prefers og:title', full.title === 'OG Title');
check('siteName prefers og:site_name', full.siteName === 'Example Site');
check('author prefers meta author', full.author === 'Jane Doe');
check('url prefers canonical, cleaned', full.url === 'https://example.com/posts/anti-fragile');
check('publishedDate parsed', full.publishedDate && full.publishedDate.year === 2024 && full.publishedDate.month === 3 && full.publishedDate.day === 5, JSON.stringify(full.publishedDate));

const noOgTitle = deriveMetadata(rawMeta({ ogTitle: null }));
check('title falls back to document.title', noOgTitle.title === 'Doc Title');

const noTitleAtAll = deriveMetadata(rawMeta({ ogTitle: null, documentTitle: null }));
check('title falls back to h1', noTitleAtAll.title === 'H1 Title');

const noTitleWhatsoever = deriveMetadata(rawMeta({ ogTitle: null, documentTitle: null, h1Text: null }));
check('title falls back to "Untitled page" when nothing is present', noTitleWhatsoever.title === 'Untitled page');

const whitespaceTitle = deriveMetadata(rawMeta({ ogTitle: '   ', documentTitle: '\n\t' }));
check('whitespace-only title fields are treated as missing', whitespaceTitle.title === 'H1 Title');

const noSiteName = deriveMetadata(rawMeta({ ogSiteName: null }));
check('siteName falls back to hostname (never null)', noSiteName.siteName === 'example.com');

const authorChain = deriveMetadata(rawMeta({ metaAuthor: null, articleAuthor: 'Article Author' }));
check('author falls back article:author', authorChain.author === 'Article Author');

const authorRelChain = deriveMetadata(rawMeta({ metaAuthor: null, articleAuthor: null, relAuthorText: 'Rel Author' }));
check('author falls back to rel="author" text', authorRelChain.author === 'Rel Author');

const authorBylineChain = deriveMetadata(
  rawMeta({ metaAuthor: null, articleAuthor: null, relAuthorText: null, bylineText: 'Byline Person' })
);
check('author falls back to byline heuristic', authorBylineChain.author === 'Byline Person');

const noAuthorAtAll = deriveMetadata(
  rawMeta({ metaAuthor: null, articleAuthor: null, relAuthorText: null, bylineText: null })
);
check('author is omitted (null) gracefully when nothing is present', noAuthorAtAll.author === null);

const noDate = deriveMetadata(rawMeta({ publishedTime: null }));
check('publishedDate is null when missing', noDate.publishedDate === null);

const badDate = deriveMetadata(rawMeta({ publishedTime: 'not a real date' }));
check('an unparsable date string is treated as missing rather than throwing', badDate.publishedDate === null);

const noCanonical = deriveMetadata(rawMeta({ canonicalUrl: null }));
check('url falls back to locationHref, cleaned', noCanonical.url === 'https://example.com/posts/anti-fragile');

/* ── invertAuthorName ─────────────────────────────────────────────────── */

console.log('invertAuthorName');
check('inverts a plain two-token name', invertAuthorName('Jane Doe') === 'Doe, Jane');
check('inverts a three-token name using the last token as surname', invertAuthorName('Jane Q. Doe') === 'Doe, Jane Q.');
check('leaves an already-inverted / comma name alone', invertAuthorName('Doe, Jane') === 'Doe, Jane');
check('leaves a single-token name alone', invertAuthorName('Cher') === 'Cher');
check('leaves an org-like byline alone', invertAuthorName('Associated Press') === 'Associated Press');
check('leaves a no-space (e.g. CJK) name alone', invertAuthorName('田中太郎') === '田中太郎');
check('handles diacritics correctly', invertAuthorName('José García') === 'García, José');

/* ── Date rendering per style ─────────────────────────────────────────── */

console.log('date parsing');
const parts = parseDateParts('2024-03-05T00:00:00Z');
check('parseDateParts reads year/month/day', parts.year === 2024 && parts.month === 3 && parts.day === 5);
check('parseDateParts returns null for garbage input', parseDateParts('garbage') === null);
check('parseDateParts returns null for null input', parseDateParts(null) === null);

/* ── Formatters: full metadata, one per style ────────────────────────── */

console.log('formatters — complete metadata');

const meta = full; // title "OG Title", author "Jane Doe", 2024-03-05, example.com

const md = formatMarkdownLink(meta);
check('markdown link shape', md === '[OG Title](https://example.com/posts/anti-fragile)', md);
checkClean('markdown link', md);

const plain = formatPlainUrl(meta);
check('plain URL is just the URL', plain === meta.url);

const apa = formatAPA(meta);
check(
  'APA: author inverted, (Year, Month Day), title, site, url',
  apa === 'Doe, Jane. (2024, March 5). OG Title. Example Site. https://example.com/posts/anti-fragile',
  apa
);
checkClean('APA (full)', apa);

const mla = formatMLA(meta);
check(
  'MLA: author inverted, quoted title, site, day-mon-year, url',
  mla === 'Doe, Jane. "OG Title." Example Site, 5 Mar. 2024, https://example.com/posts/anti-fragile.',
  mla
);
checkClean('MLA (full)', mla);

const chicago = formatChicago(meta);
check(
  'Chicago: author inverted, quoted title, site, Month Day Year, url',
  chicago === 'Doe, Jane. "OG Title." Example Site. March 5, 2024. https://example.com/posts/anti-fragile.',
  chicago
);
checkClean('Chicago (full)', chicago);

/* ── Formatters: missing-field fallback chains, per style ───────────────── */

console.log('formatters — missing author');

const noAuthorMeta = { ...meta, author: null };
const apaNoAuthor = formatAPA(noAuthorMeta);
check(
  'APA with no author starts at the title, not a stray author slot',
  apaNoAuthor === 'OG Title. (2024, March 5). Example Site. https://example.com/posts/anti-fragile',
  apaNoAuthor
);
checkClean('APA (no author)', apaNoAuthor);

const mlaNoAuthor = formatMLA(noAuthorMeta);
check(
  'MLA with no author starts at the quoted title',
  mlaNoAuthor === '"OG Title." Example Site, 5 Mar. 2024, https://example.com/posts/anti-fragile.',
  mlaNoAuthor
);
checkClean('MLA (no author)', mlaNoAuthor);

const chicagoNoAuthor = formatChicago(noAuthorMeta);
check(
  'Chicago with no author starts at the quoted title',
  chicagoNoAuthor === '"OG Title." Example Site. March 5, 2024. https://example.com/posts/anti-fragile.',
  chicagoNoAuthor
);
checkClean('Chicago (no author)', chicagoNoAuthor);

console.log('formatters — missing date');

const noDateMeta = { ...meta, publishedDate: null };
const apaNoDate = formatAPA(noDateMeta);
check('APA with no date uses "(n.d.)"', apaNoDate === 'Doe, Jane. (n.d.). OG Title. Example Site. https://example.com/posts/anti-fragile', apaNoDate);
checkClean('APA (no date)', apaNoDate);

const mlaNoDate = formatMLA(noDateMeta);
check(
  'MLA with no date omits the date segment cleanly (no dangling comma)',
  mlaNoDate === 'Doe, Jane. "OG Title." Example Site, https://example.com/posts/anti-fragile.',
  mlaNoDate
);
checkClean('MLA (no date)', mlaNoDate);

const fixedNow = new Date('2026-09-02T00:00:00Z');
const chicagoNoDate = formatChicago(noDateMeta, fixedNow);
check(
  'Chicago with no date substitutes "Accessed {today}", never a fake "n.d." publish date',
  chicagoNoDate === 'Doe, Jane. "OG Title." Example Site. Accessed September 2, 2026. https://example.com/posts/anti-fragile.',
  chicagoNoDate
);
checkClean('Chicago (no date)', chicagoNoDate);

console.log('formatters — missing author AND date (worst case)');

const bareMeta = { title: 'Untitled page', siteName: 'example.com', author: null, publishedDate: null, url: 'https://example.com/' };
for (const [name, fn] of [
  ['markdown', formatMarkdownLink],
  ['url', formatPlainUrl],
  ['apa', formatAPA],
  ['mla', formatMLA],
  ['chicago', m => formatChicago(m, fixedNow)],
]) {
  const out = fn(bareMeta);
  checkClean(`${name} (bare metadata)`, out);
  check(`${name} (bare metadata) is non-empty`, out.length > 0);
}

/* ── formatCitation dispatch ─────────────────────────────────────────── */

console.log('formatCitation dispatch');
for (const id of ['markdown', 'url', 'apa', 'mla', 'chicago']) {
  const direct = { markdown: formatMarkdownLink, url: formatPlainUrl, apa: formatAPA, mla: formatMLA, chicago: m => formatChicago(m, fixedNow) }[id];
  check(`formatCitation('${id}') matches the direct formatter`, formatCitation(id, meta, fixedNow) === direct(meta));
}

/* ── Markdown-link edge case: a title containing "]" ─────────────────── */

console.log('edge cases');
const bracketMeta = { ...meta, title: 'Weird [Title]' };
const bracketMd = formatMarkdownLink(bracketMeta);
check('a "]" in the title is escaped so the Markdown link syntax is not broken', bracketMd === '[Weird [Title\\]](https://example.com/posts/anti-fragile)', bracketMd);

/* ── Summary ──────────────────────────────────────────────────────────── */

console.log('');
if (failures > 0) {
  console.error(`${failures} check(s) failed.`);
  process.exit(1);
} else {
  console.log('All checks passed.');
}
