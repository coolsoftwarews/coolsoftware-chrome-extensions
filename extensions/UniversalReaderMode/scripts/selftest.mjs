/**
 * Headless checks for the pure logic: HTML parsing, the extraction heuristic
 * (PRD-39 §5's core technical risk — the most coverage here, on purpose),
 * Markdown conversion, plain-text/filename formatting, and the PDF byte
 * layout.
 *
 * The extraction fixtures are close approximations of real page shapes
 * (news article, blog post, docs page, a non-article dashboard) rather than
 * scraped live pages — see README.md for why, and for the honest limits of
 * this extension's own dependency-free HTML parser versus the real DOM the
 * live content script actually runs against.
 *
 * Also enforces this extension's own "no network code, anywhere" claim by
 * grepping src/*.ts for fetch/XHR/sendBeacon/WebSocket calls.
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

const entry = path.join(os.tmpdir(), `urm-selftest-${process.pid}.mjs`);
fs.writeFileSync(
  entry,
  ['dom-tree.ts', 'htmlparse.ts', 'extract-core.ts', 'reading.ts', 'markdown.ts', 'formatters.ts', 'pdf.ts']
    .map(file => `export * from ${JSON.stringify(path.join(rootDir, 'src', file).replace(/\\/g, '/'))};`)
    .join('\n')
);

const bundlePath = path.join(os.tmpdir(), `urm-selftest-bundle-${process.pid}.mjs`);
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

function findBody(root) {
  return mod.find(root, el => el.tag === 'body') ?? root;
}

/* ── HTML parsing ────────────────────────────────────────────────────── */

console.log('htmlparse');
{
  const tree = mod.parseHtml('<div class="a"><p>Hello <b>world</b></p><img src="/x.png" alt="a fox"/><!-- skip --></div>');
  const div = mod.find(tree, el => el.tag === 'div');
  check('parses a nested element', div !== null);
  check('parses attributes', div && div.attrs.class === 'a');
  const p = mod.find(tree, el => el.tag === 'p');
  check('parses text content', p && mod.textOf(p).includes('Hello'));
  check('parses a bold child', mod.find(tree, el => el.tag === 'b') !== null);
  const img = mod.find(tree, el => el.tag === 'img');
  check('void elements do not swallow siblings', img !== null && img.attrs.alt === 'a fox');
  check('comments are skipped', !mod.textOf(tree).includes('skip'));

  const scriptTree = mod.parseHtml('<div>before<script>if (1<2) { x(); }</script>after</div>');
  const text = mod.textOf(scriptTree);
  check('script content is not treated as element markup', text.includes('before') && text.includes('after'));
}

/* ── Extraction heuristic ────────────────────────────────────────────── */

console.log('extraction');

const NEWS_ARTICLE = `<html><head><title>Markets</title></head><body>
  <nav class="site-nav"><a href="/">Home</a><a href="/world">World</a><a href="/sports">Sports</a><a href="/tech">Tech</a></nav>
  <header class="site-header"><div class="masthead">Daily Example</div></header>
  <div class="ad-banner"><a href="/buy">Buy now! Limited time offer, click here to save big on your next purchase today.</a></div>
  <article class="article-body" itemtype="http://schema.org/NewsArticle">
    <h1>Antifragile systems outperform in volatile markets, new research finds</h1>
    <p>Researchers studying complex adaptive systems have found that structures which are designed to gain from disorder consistently outperform those merely built to withstand it during periods of sustained volatility.</p>
    <p>The distinction matters because most risk management frameworks are built around resilience, not antifragility, and the two produce very different responses when conditions turn unpredictable and sharp.</p>
    <p>"A resilient system resists a shock and stays the same. An antifragile one gets better because of it," said one of the paper's authors in an interview conducted for this piece.</p>
    <blockquote>Wind extinguishes a candle and energizes a fire — the same event, two entirely different outcomes, depending on the design of the system it meets.</blockquote>
  </article>
  <aside class="sidebar"><div class="related">Related: five more stories about markets and volatility you might enjoy reading next.</div></aside>
  <footer class="site-footer">&copy; 2026 Daily Example. All rights reserved. <a href="/privacy">Privacy</a> <a href="/terms">Terms</a></footer>
</body></html>`;

const BLOG_POST = `<html><body>
  <div id="page">
    <header class="site-header"><h1 class="site-title">A Working Blog</h1></header>
    <div class="content-area">
      <article class="post type-post hentry">
        <h1 class="entry-title">Why I stopped tracking everything in spreadsheets</h1>
        <div class="entry-content">
          <p>For three years I kept every project, every invoice, and every idea in a tangle of linked spreadsheets that I told myself was a system, when really it was just a very elaborate junk drawer.</p>
          <p>The breaking point came when I spent an entire Sunday afternoon reconciling two tabs that were supposed to be the same data, and found out they had quietly disagreed with each other for months.</p>
          <img src="/img/chart.png" alt="A chart showing reconciliation errors accumulating over eight months" />
          <p>Since then I have moved almost everything into plain text files and a couple of small, boring tools, and the boring part turns out to be the whole point.</p>
        </div>
      </article>
    </div>
    <aside class="widget-area"><div class="widget">Categories: productivity, tools, writing</div></aside>
    <div id="comments" class="comments-area"><h2>3 comments</h2><div class="comment">Great post, thanks for writing it up!</div></div>
  </div>
</body></html>`;

const DOCS_PAGE = `<html><body>
  <nav class="docs-nav"><a href="/docs/">Docs</a><a href="/api/">API</a><a href="/guides/">Guides</a></nav>
  <main class="content" role="main">
    <h1>Getting started</h1>
    <p>This guide walks through installing the package, wiring up the client, and making your first authenticated request against the sandbox environment, end to end, with no prior configuration assumed.</p>
    <h2>Installation</h2>
    <pre><code class="language-bash">npm install example-package --save
example-package init --sandbox</code></pre>
    <p>Once installed, import the client and construct it with your sandbox key, which you can find on the dashboard under API keys once you have created an account and verified your workspace.</p>
    <p>Every request made with a sandbox key is logged separately from production traffic, so it is safe to experiment here before switching to a live key later on.</p>
    <ul><li>Step one: install the package</li><li>Step two: construct the client with your key</li></ul>
  </main>
  <footer class="docs-footer">Docs footer &copy; Example Co.</footer>
</body></html>`;

const NON_ARTICLE = `<html><body>
  <nav class="app-nav"><a href="/">Dashboard</a><a href="/users">Users</a><a href="/settings">Settings</a></nav>
  <div class="dashboard">
    <div class="widget"><h2>Active users</h2><span>128</span></div>
    <div class="widget"><h2>Revenue</h2><span>$4,203</span></div>
    <button type="button">Refresh</button>
    <button type="button">Export CSV</button>
  </div>
  <footer class="app-footer">v2.3.1</footer>
</body></html>`;

for (const [label, html] of [
  ['news article', NEWS_ARTICLE],
  ['blog post', BLOG_POST],
  ['docs page', DOCS_PAGE],
]) {
  const tree = mod.parseHtml(html);
  const result = mod.pickArticleRoot(findBody(tree));
  check(`${label}: extracted with high confidence`, result.confidence === 'high', result.reason);
  check(`${label}: article root is not null`, result.root !== null);
}

{
  const tree = mod.parseHtml(NON_ARTICLE);
  const result = mod.pickArticleRoot(findBody(tree));
  check('non-article page: rejected, not high confidence', result.confidence === 'low');
  check('non-article page: article root is null', result.root === null);
  check('non-article page: reason is reported', result.reason === 'no-content-found');
}

{
  // The floor is deliberately strict: a single short paragraph is not "an article".
  const thin = mod.parseHtml('<html><body><main><p>Just one short paragraph here.</p></main></body></html>');
  const result = mod.pickArticleRoot(findBody(thin));
  check('a single thin paragraph is rejected, not guessed at', result.confidence === 'low');
}

{
  const newsTree = mod.parseHtml(NEWS_ARTICLE);
  const picked = mod.pickArticleRoot(findBody(newsTree));
  check('nav is excluded from the winning candidate', !mod.textOf(picked.root).includes('Sports'));
  check('the ad banner is excluded from the winning candidate', !mod.textOf(picked.root).includes('Buy now'));
  check('footer/legal text is excluded from the winning candidate', !mod.textOf(picked.root).includes('All rights reserved'));
  check('the actual article text is included', mod.textOf(picked.root).includes('Antifragile systems'));

  const cleaned = mod.cleanTree(picked.root);
  check('cleaned tree keeps the blockquote', mod.find(cleaned, el => el.tag === 'blockquote') !== null);
  check('cleaned tree strips nav/header/footer tags entirely', mod.find(cleaned, el => ['nav', 'footer', 'header'].includes(el.tag)) === null);
}

/* ── Markdown ────────────────────────────────────────────────────────── */

console.log('markdown');
{
  const tree = mod.parseHtml(NEWS_ARTICLE);
  const picked = mod.pickArticleRoot(findBody(tree));
  const cleaned = mod.cleanTree(picked.root);
  const md = mod.treeToMarkdown(cleaned);
  check('markdown carries the heading', md.includes('# Antifragile systems'));
  check('markdown renders the blockquote', md.includes('> Wind extinguishes a candle'));
  check('markdown does not leak nav text', !md.includes('Sports'));
}

{
  const tree = mod.parseHtml(
    '<div><h2>Title</h2><ul><li>one</li><li>two</li></ul><pre><code class="language-js">const x = 1;</code></pre><p>A <a href="https://example.com">link</a> and <img src="/a.png" alt="a fox"/>.</p></div>'
  );
  const md = mod.treeToMarkdown(tree);
  check('heading renders as ##', md.includes('## Title'));
  check('list items render as bullets', md.includes('- one') && md.includes('- two'));
  check('code fence keeps the language', md.includes('```js'));
  check('code content is not mangled', md.includes('const x = 1;'));
  check('links render as [text](href)', md.includes('[link](https://example.com)'));
  check('images keep alt text, not embedded', md.includes('![a fox](/a.png)'));
}

/* ── Plain text and filenames ────────────────────────────────────────── */

console.log('formatters');
{
  const tree = mod.parseHtml('<div><p>First paragraph.</p><p>Second paragraph.</p><img src="/x.png" alt="a diagram"/></div>');
  const txt = mod.treeToText(tree);
  check('plain text has no markdown syntax', !txt.includes('**') && !txt.includes('#'));
  check('paragraphs are separated by a blank line', txt.includes('First paragraph.\n\nSecond paragraph.'));
  check('images become a bracketed reference, not embedded', txt.includes('[image: a diagram]'));
}

{
  const filename = mod.buildFilename({ site: 'example.com', title: 'Antifragile: things that gain from disorder / part 1' }, 'md');
  check(
    'follows the {site} - {title}.{ext} convention',
    filename === 'example.com - Antifragile things that gain from disorder part 1.md',
    filename
  );
  check('drops filesystem-hostile characters', !/[\\/:*?"<>|]/.test(filename));

  const longName = mod.buildFilename({ site: 'example.com', title: 'x'.repeat(400) }, 'pdf');
  check('truncates to 120 characters', longName.length <= 120, `${longName.length} chars`);
  check('keeps the extension after truncation', longName.endsWith('.pdf'));
}

/* ── Reading time ────────────────────────────────────────────────────── */

console.log('reading');
check('word count of empty text is zero', mod.countWords('') === 0);
check('word count is whitespace-based', mod.countWords('one two   three') === 3);
check('reading time is never zero for real content', mod.estimateReadingMinutes(50) >= 1);
check('reading time is zero for no content', mod.estimateReadingMinutes(0) === 0);
check('reading time scales with word count', mod.estimateReadingMinutes(2250) === 10);

/* ── PDF ─────────────────────────────────────────────────────────────── */

console.log('pdf');
{
  const meta = { url: 'https://example.com/posts/x', title: 'A Long Article', author: 'J. Writer', site: 'example.com', published: '', captured: '2026-09-02' };
  const paragraphs = Array.from(
    { length: 120 },
    (_, i) => `<p>Paragraph number ${i}: a fairly long sentence to force wrapping and pagination across many pages of output.</p>`
  ).join('');
  const tree = mod.parseHtml(`<article>${paragraphs}</article>`);
  const article = mod.find(tree, el => el.tag === 'article');
  const doc = mod.toPdfDocument(article, meta);
  const pdf = mod.generatePdf(doc);
  const bytes = new Uint8Array(await pdf.blob.arrayBuffer());
  const text = Buffer.from(bytes).toString('latin1');

  check('has a PDF header', text.startsWith('%PDF-1.4'));
  check('ends with EOF', text.trimEnd().endsWith('%%EOF'));
  check('reports no unsupported characters for ASCII', pdf.unsupportedCharacters.length === 0, pdf.unsupportedCharacters.join(''));
  check('paginates a long export', (text.match(/\/Type \/Page[^s]/g) || []).length > 1, `${(text.match(/\/Type \/Page[^s]/g) || []).length} pages`);

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
}

/* ── No network code, anywhere ───────────────────────────────────────── */

console.log('privacy posture');
{
  const srcDir = path.join(rootDir, 'src');
  const files = fs.readdirSync(srcDir).filter(f => f.endsWith('.ts'));
  const forbidden = [/fetch\(/, /XMLHttpRequest\(/, /\.sendBeacon\(/, /new WebSocket\(/];
  let clean = true;
  for (const file of files) {
    const content = fs.readFileSync(path.join(srcDir, file), 'utf8');
    for (const pattern of forbidden) {
      if (pattern.test(content)) {
        clean = false;
        console.log(`  FAIL network-capable call ${pattern} found in ${file}`);
      }
    }
  }
  check('no fetch/XHR/sendBeacon/WebSocket call anywhere in src/', clean);
}

fs.rmSync(entry, { force: true });
fs.rmSync(bundlePath, { force: true });

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
