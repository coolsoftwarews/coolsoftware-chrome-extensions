# Universal Reader Mode & Export

Chrome MV3 extension. Strip any page down to a clean, distraction-free reading view — then export
it as Markdown, PDF or TXT. No account, no backend, no network requests.

Built from [PRD-39](../../docs/extensions/PRD-39-universal-reader-mode.md). Shares its PDF
writer with [WebHighlighter](../WebHighlighter) and [YouTubeTranscription](../YouTubeTranscription)
— same file, ported unchanged, per the portfolio's shared-modules table.

## Quick start

```bash
npm install
npm run icons          # regenerate src/icons/*.png (no image dependency)
npm run build           # dev build into dist/
npm run build:watch     # rebuild on change
npm run build:prod      # minified, production manifest name
npm test                # headless checks — extraction, markdown, formats, filenames, PDF bytes
npm run typecheck
npm run zip              # production build + dist/ packed for the Web Store
```

Node 18+ is required. Load it: `chrome://extensions` → Developer mode → **Load unpacked** → select
`dist/`.

Nothing runs automatically. Click the toolbar icon (or press **Alt+Shift+R**) on an article to open
reader mode; do it again to close it.

## How it works

| File | Job |
| :-- | :-- |
| `src/dom-tree.ts` | `GenericNode` — a minimal, dependency-free stand-in for a DOM tree |
| `src/htmlparse.ts` | HTML string → `GenericNode`, used to build the selftest fixtures |
| `src/dom-adapter.ts` | The browser half: walks the live `document` into a `GenericNode`, reads page metadata |
| `src/extract-core.ts` | The extraction heuristic — candidate scoring, the article/non-article decision, cleanup |
| `src/reading.ts` | Word count and the reading-time estimate |
| `src/markdown.ts` | `GenericNode` → Markdown (headings, lists, tables, code, images as `![alt](src)`) |
| `src/formatters.ts` | Plain text, filenames, and the PDF line layout — pure, fully tested |
| `src/pdf.ts` | Dependency-free PDF writer (ported verbatim from WebHighlighter) |
| `src/storage.ts` | Reading preferences + backup export/import/clear — the only things ever stored |
| `src/metrics.ts` | Local-only usage counters |
| `src/content.ts` | The reader overlay itself: extraction, the four UI states, controls, export |
| `src/background.ts` | Injects `content.js` on demand (toolbar click / shortcut), relays downloads |

### Why there's no always-on content script

Most extensions in this portfolio declare a `content_scripts` entry that runs on every page load.
This one doesn't — PRD-39 §6 treats "foreground only" literally: `background.ts` injects
`content.js` via `chrome.scripting.executeScript` only when the user clicks the toolbar icon or
presses the shortcut, and re-invoking it on a page that already has the overlay open closes it
(`content.ts`'s own top-level code checks for its own host element and toggles). Nothing from this
extension executes on a page the user hasn't explicitly asked it to look at.

### The extraction heuristic, and its honest limits

`extract-core.ts` is a dependency-free Readability-in-miniature: score every candidate block by how
much real paragraph text it holds, penalize link-dense blocks (navigation dressed up as content),
give a modest boost to an actual `<article>` tag or schema.org `Article` markup, and take the
winner — but only if it clears a floor (PRD-39 §5). Below that floor, extraction returns
`confidence: 'low'` with a reason, and the overlay says so in plain language rather than rendering a
mangled result.

**The genuinely interesting design choice, and its tradeoff:** `extract-core.ts` operates on
`GenericNode`, not the real DOM. Two things build that same shape — `dom-adapter.ts` (the browser,
walking the live, already-correctly-parsed `document`) and `htmlparse.ts` (a small hand-rolled HTML
string parser, used only by `scripts/selftest.mjs`'s fixtures). That split means the actual risky
logic (candidate scoring, the confidence decision) is identical code in production and in tests —
`scripts/selftest.mjs` runs it against a news-article fixture, a blog-post fixture, a docs-page
fixture, and a non-article dashboard fixture that must be correctly rejected. The honest tradeoff:
`htmlparse.ts` is not a full HTML5 parser and is not used at runtime — production always uses the
real DOM via `dom-adapter.ts`, which is far more robust against real-world malformed markup than any
hand-rolled parser could be. `dom-adapter.ts` itself is thin and mechanical (tag/attrs/children, no
judgment calls) and is **not** unit-tested — it needs a real browser, so it gets the manual checklist
below instead, same convention as every DOM-bound module elsewhere in this portfolio.

## Manual test checklist

`dom-adapter.ts` and the overlay's live behaviour need a real browser. Before shipping, walk this on
a deliberately varied set of real sites (PRD-39 §5):

- [ ] A news article, a personal blog post, a documentation page, a long-form essay (Wikipedia, a
      Substack post, a GitHub README rendered as a page)
- [ ] A page that is *not* an article (a dashboard, a search results page, a login screen) — reader
      mode should say plainly that it doesn't look like an article, never produce a garbled export
- [ ] A single-page app where content loads after the initial DOM is ready — open reader mode
      immediately on navigation and confirm the short settle-and-retry still finds the article
- [ ] A paywalled article — confirm only what's actually rendered is extracted, nothing is bypassed
- [ ] An image-heavy article — images become `![alt](src)` in Markdown / `[image: alt]` in TXT, never
      embedded
- [ ] Non-English and RTL content — the overlay itself must not assume LTR; PDF export should flag
      unsupported characters and point at Markdown/TXT
- [ ] Keyboard only: open with the shortcut, Tab cycles within the dialog and never escapes it,
      Escape closes, focus returns to what was focused before opening
- [ ] A dark-mode site and each of the light/sepia/dark reader themes, for legible contrast
- [ ] `chrome://extensions` and a `file://` page → the extension declines cleanly, no errors
- [ ] Each export format (Markdown/PDF/TXT), and reopening reader mode on the same page (preferences
      from the last session should already be applied)
- [ ] Data → Export all data → Clear all data → Import → preferences come back

## Privacy

No `fetch`, `XMLHttpRequest`, `sendBeacon` or `WebSocket` — enforced in `scripts/selftest.mjs` (it
greps `src/*.ts` and fails the build if any appear) and verifiable in devtools' network tab.
Preferences and usage counters live in `chrome.storage.local` and are never transmitted. `<all_urls>`
exists only so extraction can run on whatever page you're currently reading. See
[PRIVACY.md](PRIVACY.md).

## Known limits

- Extraction is heuristic, like every reader-mode tool. It fails honestly (see above) rather than
  guessing, but "honestly rejecting an actual article" is still a possible failure mode on an
  unusual page layout — this is the metric PRD-39 §8/§9 tracks above all others.
- PDF export uses standard PDF fonts (WinAnsi), so non-Latin scripts are flagged and the overlay
  points at `.md`/`.txt` instead — same limit WebHighlighter ships with.
- No read-it-later queue, no sync, no accounts — deliberately out of scope; see PRD-39 §2 and §4 for
  why that's not just a V1 cut.
