# PRD — Universal Table/List → CSV Scraper

**Status:** Draft for build
**Owner:** Gabriel
**Date:** 2026-09-02
**Type:** Chrome extension (MV3), standalone Web Store listing
**Platform:** Cross-platform (any website)
**Backend:** None · **Accounts:** None · **Payments:** None

---

## 1. One-line proposition

Click a table or a list of cards on any page, preview it as rows and columns, export CSV or JSON — no copy-paste, no server.

## 2. The hypothesis

"Export this table to a spreadsheet" is a long-standing, well-validated browser-extension category —
Table Capture and similar tools have a long install history — precisely because copy-pasting an HTML
table into Excel routinely mangles formatting: merged cells collapse, columns misalign, and repeated
whitespace turns one cell into three. It is a real, recurring, low-drama pain that a huge number of
people have independently hit.

A growing share of newer "table export" tools solve it by uploading the page's HTML to a server to do
the parsing — which is unnecessary. This is fundamentally a client-side DOM-structure problem: the
table is already sitting, fully parsed, in the browser that rendered it. There is no reason a page's
own tabular data needs to leave the device to be turned into a CSV.

**The hypothesis:** a purely local, click-to-select exporter — for both real `<table>` elements *and*
repeated list/card structures that aren't semantic tables but visually behave like one (a grid of
product cards, a list of search results, a feed of listings) — covers more real-world cases than
table-only tools while staying entirely client-side. Most "table export" competitors stop at
`<table>`; a large share of the data people actually want out of a page today (product grids, search
results, directory listings) is built from `<div>`s, not `<table>`s, and that's the gap.

## 3. Target user

| Segment | Job |
| :-- | :-- |
| Analysts / researchers | Pull a data table off a report or dashboard page into a spreadsheet without retyping it |
| Sales / lead-gen | Grab a list of companies, contacts or listings off a directory-style page |
| Ecommerce / market researchers | Export a competitor's product grid (name, price, rating) as rows |
| Students / journalists | Get a table out of a government or reference site into a workable format |
| Anyone stuck copy-pasting | The person who just watched Excel mangle a pasted HTML table for the third time |

## 4. Scope — V1

### In scope

- **Pick a table mode.** Hovering the page highlights candidate tables and repeated-structure
  regions under the cursor. Clicking selects one.
- **Preview before export.** The selected candidate is parsed into rows and columns and shown as a
  preview grid before anything is exported, so the user can see what they're about to get.
- **Export as CSV or JSON.**
- **Merged cells (`colspan`/`rowspan`).** Handled by sensible duplication — the spanned value is
  repeated into every cell it visually covers — rather than breaking column alignment. A collapsed
  or misaligned column is a worse failure than a duplicated value.
- **Repeated-card-list pattern.** Detects sibling elements with a similar internal structure/class
  pattern and infers columns from their common child elements. This is documented as **best-effort,
  not guaranteed** — it is inherently heuristic, unlike parsing a real `<table>`, which is
  deterministic.

### Out of scope for V1

- No scraping across multiple pages or pagination. Single visible page/table only — no crawling, no
  "next page" following.
- No scheduled or automatic re-scraping. This is a one-shot, user-initiated action every time.
- No data cleaning or transformation beyond basic whitespace trimming. No de-duplication, no type
  coercion, no currency/number parsing, no column reordering or renaming.

## 5. Where the data comes from — read before committing

This extension reads only the DOM already rendered on the current page, in the tab the user is
looking at, at the moment they click. It performs no separate fetch of the page, no crawl, and no
request to any server — the data source is exactly what `document` already contains.

**The real technical risk is the repeated-list-structure heuristic** (for non-`<table>` content).
Detecting "these twelve `<div>`s are actually rows of a table" from DOM shape alone is genuinely
heuristic — there is no semantic signal to lean on the way `<table>`/`<tr>`/`<td>` gives one. **Spike
this against a handful of real-world "grid of cards" pages** (e.g., a product listing page, a
search-results page) before committing to the exact algorithm. Test at minimum: an ecommerce category
grid, a job-board or real-estate listing page, and a search-results page from a major search engine.

The honest fallback, and it is non-negotiable: **if confidence is low, tell the user "this doesn't
look like a structured list" rather than exporting garbage rows.** A wrong export that looks plausible
is a worse outcome than an honest refusal — it costs the user trust the moment they open the CSV in a
spreadsheet and find columns that don't line up.

## 6. Non-functional requirements

| Requirement | Target |
| :-- | :-- |
| Hover-to-highlight response | Effectively instant — no visible lag between cursor movement and the outline updating |
| Table parsed → preview shown | < 1 s for a typical table (hundreds of rows); large tables show a loading state |
| Export generated | < 2 s for a capped table (see §7 row cap) |
| Permissions | `activeTab`, `scripting`, `storage`, `downloads`, plus host permission `<all_urls>` — same universal-tool justification as `WebHighlighter`: a table exporter that only works on an approved list of sites isn't a table exporter |
| Page impact | Zero layout shift on the host page. The picking overlay and preview live in an isolated shadow root and never restyle the page itself |
| Privacy | No network requests of any kind, ever — verifiable in devtools. Nothing parsed or exported leaves the device |
| Accessibility | Escape cancels picking mode or closes the preview at any time; the preview panel is keyboard-reachable and announces state changes for screen readers |

## 7. Edge cases

- **Nested tables** (a table inside a table cell). V1 reads a cell's flattened text content rather
  than recursing into a nested table's structure — a nested table's rows are flattened into the
  parent cell's text, separated by a visible delimiter. Documented as a known simplification, not
  silently mangled.
- **Header row inference.** Tables with `<thead>`/`<tbody>` or an explicit header row (`<th>` cells)
  have their header inferred automatically. Tables with **no explicit header row at all** fall back
  to auto-generated column names (`Column 1`, `Column 2`, …) — the preview includes a "first row is
  headers" toggle so the user can correct the guess rather than the tool silently guessing wrong.
- **Extremely large tables** (thousands of rows). V1 applies a row cap (documented in-product) with a
  clear message — "showing the first N of M rows" — rather than silently truncating or hanging the
  tab trying to parse everything.
- **Virtualized/infinite-scroll tables.** Only the rows currently rendered in the DOM are visible to
  the extension — a table that virtualizes off-screen rows will export only what's currently mounted.
  This is a known limitation, documented plainly rather than half-solved, in the same honesty pattern
  the rest of this portfolio uses for other DOM-scraping products (see `WebHighlighter`,
  `YouTubeSubcription`).

## 8. Success metrics (30 / 90 day)

| Metric | 30d checkpoint | 90d "keep investing" bar |
| :-- | :-- | :-- |
| Installs | 200 | 2,000 |
| Users who complete ≥ 1 export | 45% | 60% |
| List-mode (non-`<table>`) exports as a share of all exports | tracked, no target | tracked, no target |
| List-mode low-confidence refusals as a share of list-mode attempts | tracked, no target | < 35% |
| Store rating | ≥ 4.2 | ≥ 4.4 |

**Instrumented events (local counters only, no PII, no network):** pick-mode started, table selected,
list selected, export CSV, export JSON, row cap hit, list-mode low-confidence refusal, header-row
toggle used.

The low-confidence-refusal rate is the health metric for the riskiest part of the product (§5). If
it's high, the list heuristic isn't good enough yet and V1's honest-refusal behavior is doing its job
of not shipping garbage — but it also means the "repeated card list" half of the value proposition
isn't landing for real pages, which is worth knowing early.

## 9. Kill criteria

Under 300 installs at 90 days, **or** completed-export rate under 30% of installs → stop investing. A
low completion rate most likely means picking mode is confusing or the preview isn't answering "is
this what I think it is" clearly enough — a positioning/UX failure, not a reason to add features.

## 10. Open questions

- **Row cap value.** A specific number (e.g., 5,000 rows) needs to be chosen against real performance
  testing on a mid-range machine, not guessed — pick it during the build, not in this document.
- **List-heuristic threshold.** The confidence bar for "this looks like a structured list" needs
  tuning against the spike pages in §5 before the number in code is trusted; expect to revisit it
  after the first batch of real usage.
- **Multi-table pages.** When a page has several plausible tables, is a single "pick one" flow enough,
  or does a later version want multi-select and a combined export? Out of scope for V1 either way —
  worth watching for in reviews.
- **CSV delimiter/locale.** Some locales expect `;` instead of `,` (common in regions where `,` is the
  decimal separator). V1 ships comma-delimited RFC 4180 CSV only; revisit if reviews ask for it.
