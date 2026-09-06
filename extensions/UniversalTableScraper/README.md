# Universal Table/List → CSV Scraper

Chrome MV3 extension. Click a table — or a repeated list of cards/results that isn't a semantic
`<table>` but behaves like one — preview it as rows and columns, export CSV or JSON. No account, no
backend, no network requests.

Built from
[PRD-42](../../docs/extensions/PRD-42-universal-table-scraper.md). The export layer and
build scaffold follow the same shape as [WebHighlighter](../WebHighlighter), the portfolio's other
cross-platform DOM tool.

## Quick start

```bash
npm install
npm run icons          # regenerate src/icons/*.png (no image dependency)
npm run build           # dev build into dist/
npm run build:watch     # rebuild on change
npm run build:prod      # minified, production manifest name
npm test                # headless checks — table layout, CSV/JSON, list heuristic, filenames
npm run typecheck
npm run zip              # production build + dist/ packed for the Web Store
```

Node 18+ is required. Load it: `chrome://extensions` → Developer mode → **Load unpacked** → select
`dist/`.

## How it works

| File | Job |
| :-- | :-- |
| `src/table.ts` | Pure: lays raw `<table>` rows out into a rectangular grid, duplicating merged (`colspan`/`rowspan`) cell values, and infers or overrides the header row |
| `src/csv.ts` | Pure: RFC 4180 CSV escaping and array-of-objects JSON serialization |
| `src/heuristics.ts` | Pure: scores whether a set of repeated DOM elements looks like rows of a table — the riskiest, most-heuristic part of the product (PRD §5) |
| `src/formatters.ts` | Ties the above together: builds the export file + the `{site} - {title}.{ext}` filename |
| `src/content.ts` | The DOM half — hover-to-highlight picking, `<table>`/list extraction, and the on-page preview panel (shadow DOM, so it never restyles the host page) |
| `src/background.ts` | Thin service worker — its only job is `chrome.downloads`, which content scripts cannot call directly |
| `src/popup.ts` | The toolbar popup — checks the tab, then hands off to the content script and closes itself |
| `src/metrics.ts` | Local-only usage counters, readable/resettable from the popup |

### Why a popup that closes immediately

MV3 popups close the instant focus leaves them — including the moment the user clicks something on
the page. A "hover the page, then click something" flow can't live in the popup itself, so the popup
here is only the entry point: it starts picking mode in the content script and calls `window.close()`.
Everything else — the hover outline, the preview grid, the header-row toggle, the export buttons — is
rendered by the content script inside an isolated shadow root docked in the corner of the page. This
is the same reason `WebHighlighter` uses a side panel; this extension's permission set (PRD §6) is
deliberately narrower (no `sidePanel`, no `tabs`), so the on-page overlay does that job instead.

### Merged cells

`colspan`/`rowspan` cells are duplicated into every grid cell they visually cover, rather than being
collapsed into one cell and shifting every column after it. A duplicated value is a small, honest
compromise; a column that silently drifts by one for every row beneath a merged header is not. See
`src/table.ts` and the "merged cells" block in `scripts/selftest.mjs` for the exact behaviour.

### The repeated-list heuristic, which is the real risk

Real `<table>`s are deterministic — semantic tags tell you exactly what a header row and a cell are.
A grid of product cards or search results has no such signal. `heuristics.ts` scores a set of sibling
DOM elements on two independent things that both have to clear a floor, not just average out:

1. **Structural similarity** — what fraction of the items share the page's most common internal shape
   (tag + class + child-tag signature)?
2. **Field coverage** — of the items that match that shape, how many actually have non-empty text in
   each inferred column?

If either signal is weak, the extension refuses rather than exports a best guess: the preview shows
*"This doesn't look like a structured list"* with no rows offered. A plausible-looking wrong export is
worse than an honest refusal — it costs trust the moment someone opens the file.

## Manual test checklist

The DOM-bound half needs a real browser. Before shipping, walk this on a handful of real pages (PRD §5
names an ecommerce grid, a job/real-estate listing page, and a search-results page as the minimum
spike set):

- [ ] A plain HTML `<table>` with an explicit `<thead>`
- [ ] A `<table>` with no header row at all — the "first row is headers" toggle should let you fix a
      wrong guess
- [ ] A table with merged header cells (`colspan`) over several data columns
- [ ] A table with a `rowspan` cell spanning several data rows
- [ ] A table with a nested `<table>` inside one cell — the nested table's text should appear inline,
      flattened, not break the outer grid
- [ ] A very large table (thousands of rows) — the row cap should kick in with a clear message, not
      hang the tab
- [ ] A product grid built from `<div>`s (an ecommerce category page)
- [ ] A search-results page from a major search engine
- [ ] A page with no repeated structure at all under the cursor — picking mode should simply not
      highlight anything there
- [ ] A page whose "list" candidate is actually a nav menu or ad grid — confirm the low-confidence
      refusal fires rather than a garbage export
- [ ] `Esc` cancels picking mode at any point, and closes the preview panel
- [ ] Export CSV, then JSON, and open both in a spreadsheet / text editor
- [ ] `chrome://extensions` and a `file://` page — the popup says the page is unsupported, no errors
- [ ] A tab that was open before install/update — the popup's "reload this page" message appears

## Known limits

- **Virtualized/infinite-scroll tables**: only the rows currently rendered in the DOM are visible to
  the extension. A table that virtualizes off-screen rows will export only what's currently mounted —
  documented, not silently half-solved.
- **Nested tables**: a table inside a table cell is flattened into that cell's text rather than
  recursed into as its own structure.
- **List-mode picking is mouse-driven only** — there is no keyboard-only path to select a candidate in
  V1; `Esc` still works everywhere to cancel/close.
- **Single page only**: no pagination-following, no multi-page crawling, no scheduled re-scraping —
  this is a one-shot, user-initiated action every time (PRD §4).
