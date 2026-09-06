# Etsy Niche Opportunity Finder

Chrome MV3 extension. Reads the shape of an Etsy niche — seller moat, shop concentration,
freshness — straight off the search or category page you're already looking at. No account, no
Etsy API, no backend, no network requests.

Built from [PRD-20](../../docs/extensions/PRD-20-etsy-niche-finder.md). The export layer
and the local-storage/backup discipline are ported from
[WebHighlighter](../WebHighlighter), which is what makes this a days-not-weeks build.

## Quick start

```bash
npm install
npm run icons          # regenerate src/icons/*.png (no image dependency)
npm run build           # dev build into dist/
npm run build:watch     # rebuild on change
npm run build:prod      # minified, production manifest name
npm test                # headless checks — scoring engine, filters, exports, filenames
npm run typecheck
npm run zip              # production build + dist/ packed for the Web Store
```

Node 18+ is required.

Load it: `chrome://extensions` → Developer mode → **Load unpacked** → select `dist/`. Then visit any
`etsy.com/search?q=...` or `etsy.com/c/...` page.

## How it works

| File | Job |
| :-- | :-- |
| `src/url.ts` | Turns a search or category URL into a stable "which niche is this" key, ignoring pagination and tracking params |
| `src/extract.ts` | Reads listing cards out of the DOM Etsy already rendered — price, sales/reviews, shop, ad status, digital vs physical |
| `src/stats.ts` | The scoring engine: median, percentile, shop concentration, the sales-vs-reviews split, tag aggregation, filters, snapshot deltas — pure, fully tested |
| `src/formatters.ts` | CSV and Markdown export — pure, fully tested |
| `src/storage.ts` | `chrome.storage.local`: user-triggered snapshots, an ephemeral per-query pagination cache, backup export/import/clear |
| `src/metrics.ts` | Local-only usage counters |
| `src/content.ts` | The fixed, non-layout-shifting strip; per-listing badges; filters; tag view; save/export wiring |
| `src/background.ts` | The one job a content script can't do itself: turning an export string into a downloaded file |
| `src/panel.ts` | The toolbar popup: this page's read, the saved-niche library, data ownership, usage counters |

### Where the data comes from

Only the listings Etsy renders in the tab you're viewing — no API key, no extra requests, human
speed (PRD-20 §5). Two design choices follow directly from that:

- **Ads are excluded from every stat.** A promoted listing's inflated sales count would make every
  niche look more contested than it is. Ads are still shown, labelled, in the listing table and the
  per-listing badges — just not folded into the median or the concentration number.
- **Sales and reviews are never blended.** Etsy shows one or the other depending on the listing; the
  strip picks whichever is more common on the page and says so, rather than silently averaging two
  different numbers together.
- **Pagination accumulates, it doesn't crawl.** Stats are built from the pages you've actually
  loaded for a query — page 2 adds to page 1's sample instead of replacing it, and the strip always
  states the sample ("from 2 pages, 128 listings"). Nothing is fetched automatically; the cache is
  keyed per query, capped, and expires after three hours.
- **No search-volume or revenue numbers, ever.** Every paid competitor sells them; they're modelled,
  they need a backend, and PRD-20 calls them out as the fastest way to mislead a seller. The tag
  table is real word counts from real titles — explicitly not a keyword-volume tool.

### The strip

A slim, fixed bar docked to the top of the viewport, built in a shadow root — it never reflows
Etsy's own grid, satisfying the "no layout shift" requirement regardless of where Etsy's markup
happens to put the results this week (PRD-20 notes Etsy runs layout A/B tests). It hides itself
completely if fewer than four listing cards are found, rather than show numbers built on a bad read.

Per-listing badges are absolutely positioned over each card (never affecting page flow) and show
price, the sales/reviews count with its label, shop name, and an "Ad" tag when applicable.

### Filters, tags, snapshots, export

- **Filters** (max sales, price band, shop, organic-only) dim non-matching badges in place; they
  never change the aggregate niche read, which always reflects the full sample.
- **Tag view** aggregates the words in the titles of the top organic listings, with counts and the
  sample size shown — a keyword artifact, not a volume estimate.
- **"+ Save niche"** stores today's numbers for this query locally. Returning to the same query
  shows the delta since the last save (e.g. "median sales +40 since 12 Aug"), computed automatically
  on load if a snapshot exists. Entirely user-triggered — nothing is saved automatically, and there
  is no background polling for changes.
- **Export** (CSV or Markdown, from the strip or the popup) writes the summary, the listing table
  (honouring the current filters), and the tag table to one downloaded file.

## Privacy

No `fetch`, no `XMLHttpRequest`, no `sendBeacon` — verifiable with `grep -rn "fetch(" src/` and in
devtools' network tab. Snapshots, the pagination cache and usage counters live in
`chrome.storage.local` and are never transmitted. See [PRIVACY.md](PRIVACY.md).

## Manual test checklist

`extract.ts`'s selectors are best-effort heuristics against Etsy's current markup, not a published
contract — Etsy re-hashes class names periodically. Before shipping, and periodically after, walk
this on a real, signed-out Etsy session:

- [ ] A broad search (`bags`), a narrow one (`hand-carved oak spoon`), and a category page (`/c/...`)
- [ ] A search with visibly promoted/sponsored listings mixed in — confirm they're labelled "Ad" in
      the badges and the listing table, and excluded from the summary's median/concentration numbers
- [ ] A search that mixes sales-count and review-count cards — confirm the strip states which one the
      median uses and shows the "mixed" note
- [ ] A search with digital-download listings mixed with physical goods — confirm the digital/physical
      note appears
- [ ] A personalized/variable-price listing ("From £x") — confirm it's flagged as a range
- [ ] A non-English Etsy locale (e.g. `etsy.com/de` or `?locale=de`) — confirm currency reads correctly
      or degrades gracefully (empty currency rather than a wrong one)
- [ ] Click "Page 2" — confirm the sample note updates to "from 2 pages" and totals grow, not reset
- [ ] A search returning zero results, and a malformed/very short results page — strip does not appear,
      no console errors, Etsy's own page still works
- [ ] Filters: max sales, price band, shop, organic-only — badges dim correctly, "N of M shown" updates
- [ ] "+ Save niche" twice on the same query on different days — delta line matches the numbers
- [ ] Export CSV and Markdown from both the strip and the popup — open the file, check all three
      sections are present and the listing table reflects the active filters
- [ ] Popup: Data → Export all → Clear all → Import — every saved niche comes back
- [ ] A page open before the extension was installed — popup shows the "reload this tab" message,
      not a raw error

## Known limits

- Card detection, price/count parsing, ad detection and shop-name extraction are heuristic — see the
  checklist above. When a selector goes stale the strip disappears rather than showing wrong numbers,
  by design (PRD-20 §6).
- The tag aggregator's stopword list is English-only; non-English titles will surface more filler
  words in the tag table.
- Currency detection reads the symbol/prefix Etsy prints; it does not convert between currencies, and
  a page mixing currencies is flagged rather than normalized.
- Ad detection relies on the screen-reader text Etsy attaches to promoted cards ("Ad from/by Etsy
  seller") plus a URL heuristic; a small number of ads may go unlabelled if Etsy changes that markup,
  which would very slightly inflate the organic sample rather than corrupt it silently in the other
  direction.
