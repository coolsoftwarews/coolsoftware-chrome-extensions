# Amazon Product Opportunity Overlay

Chrome MV3 extension. On any Amazon search or category page, reads the results already rendered in
the tab and shows how contested the category is — review moat, rating ceiling, brand concentration —
straight off the page. No account, no backend, no sales/revenue/BSR estimates, no network requests.

Built from [PRD-18](../../docs/extensions/PRD-18-amazon-product-opportunity.md). The
storage, backup and metrics layers follow the same shape as [WebHighlighter](../WebHighlighter) and
[YouTubeTranscription](../YouTubeTranscription).

## Quick start

```bash
npm install
npm run icons          # regenerate src/icons/*.png (no image dependency)
npm run build          # dev build into dist/
npm run build:watch    # rebuild on change
npm run build:prod     # minified, production manifest name
npm test               # headless checks — parsing, stats, filters, exports, deltas
npm run typecheck
npm run zip            # production build + dist/ packed for the Web Store
```

Node 18+ is required. Load it: `chrome://extensions` → Developer mode → **Load unpacked** → select
`dist/`. Then visit any Amazon search results page (e.g. `amazon.com/s?k=water+bottle`).

## How it works

| File | Job |
| :-- | :-- |
| `src/parsing.ts` | Locale-aware text parsing for price, rating, review count, brand — pure, no DOM |
| `src/extract.ts` | Reads the rendered result cards into `ListingSnapshot[]` (the DOM half) |
| `src/stats.ts` | The category read: median reviews/rating, distinct brands, moat/ceiling/concentration labels |
| `src/filters.ts` | Max reviews · min rating gap · price band · brand — narrows which badges are highlighted |
| `src/deltas.ts` | "+140 reviews since 12 Aug" — the watchlist's whole value proposition |
| `src/exporters.ts` | CSV/Markdown for the result set and the watchlist, plus filenames |
| `src/storage.ts` | `chrome.storage.local` watch records, backup export/import, quota status |
| `src/content.ts` | Mounts the summary strip and per-listing badges on the Amazon page, owns the watchlist UI |
| `src/background.ts` | The only place `chrome.downloads` is called for in-page exports (content scripts can't call it) |
| `src/popup.ts` | Toolbar popup: this page's read, the full watchlist, data ownership, usage counters |

### The category read, and why it stops where it does

PRD §4 draws a hard line: **no sales, revenue or BSR estimates, ever.** Everything this extension
shows is either a number Amazon already printed (review count, rating, price, brand) or a bucket
label computed over real medians of those numbers — never a modelled guess. The three proxies:

- **Moat** — bucketed from the median review count of the organic (non-sponsored, de-duplicated)
  results: `< 150` light, `150–1499` moderate, `≥ 1500` strong.
- **Rating ceiling** — how many of the top 10 organic results sit below a 4.3 rating (the PRD's own
  worked example). `0` under → strong ceiling (hard to beat); `≥ 30%` under → soft (room to win on
  quality).
- **Concentration** — the top brand's share of readable-brand listings: `< 20%` fragmented,
  `20–39%` moderate, `≥ 40%` concentrated.

### Edge cases handled (PRD §7)

- **Sponsored listings** are read (so they can be labelled) but excluded from every category stat.
- **Variations / duplicate ASINs** on one results page are counted once.
- **Locale variability** — `parsePriceText`/`parseRatingText`/`parseCountText` handle both
  thousands-comma (`$1,234.56`) and thousands-dot (`1.234,56 €`) formats, and English/German/French
  rating phrasing. Verified in `scripts/selftest.mjs`; not exhaustively verified against every live
  marketplace layout (see **Known limits**).
- **Unreadable fields** (brand, Prime badge, rating) are `null`, never guessed, and the strip reports
  how many listings had an unreadable brand rather than silently shrinking the denominator.
- **A page Amazon has A/B tested into an unrecognised shape** simply yields fewer or no listings; the
  overlay does not throw, and if there is nothing to read it renders nothing (see `src/content.ts`'s
  `analyze()` — wrapped so a DOM surprise disables the overlay quietly rather than breaking the page).

### The legal posture (PRD §5), enforced in code

The whole defensibility argument is "reads only what's already in the tab, at human speed, no extra
requests." That's enforced, not just claimed: `scripts/selftest.mjs` greps every file in `src/` for
`fetch(`, `XMLHttpRequest(`, `.sendBeacon(` and `new WebSocket(` and fails the build if any exist.
There is exactly one place `chrome.downloads` is called from a background context that never reaches
out to the network — see `src/background.ts`.

### Why there's a background script at all

Content scripts cannot call `chrome.downloads` — only extension pages can. The overlay's Export
button lives on the Amazon page, so it relays the finished CSV/Markdown text to the service worker,
which is the only code path that touches the downloads API for in-page exports. The popup calls
`chrome.downloads` directly for the watchlist and backup exports, since it's its own extension page.

## Privacy

No `fetch`, `XMLHttpRequest`, `sendBeacon` or `WebSocket` anywhere in `src/` — enforced by
`scripts/selftest.mjs`, and verifiable in devtools' network tab. Watchlist snapshots and usage
counters live in `chrome.storage.local` and are never transmitted. See [PRIVACY.md](PRIVACY.md).

## Manual test checklist

The DOM-bound half needs a real browser and Amazon's actual (frequently A/B-tested) markup:

- [ ] `amazon.com/s?k=<query>` with a mix of sponsored and organic results — strip renders, sponsored
      listings are labelled but excluded from the category read
- [ ] A query with fewer than 10 results (rating ceiling sample shrinks, no divide-by-zero)
- [ ] A query with zero results (overlay renders nothing, doesn't throw)
- [ ] `.co.uk` and `.de` — price parses with the right decimal separator, rating phrase parses
- [ ] Filters: max reviews, min rating gap, price band, brand — badges dim/highlight correctly,
      opportunity flag only appears with both review and rating filters set
- [ ] `+ Watch this search`, revisit a day later, snapshot again — delta line reads correctly
- [ ] `☆` on a listing → `★`, revisit and re-click → product watch snapshot appended
- [ ] Export results as CSV and Markdown — file downloads, opens cleanly
- [ ] Popup: this page's read, full watchlist, remove a watch, export watchlist CSV/MD
- [ ] Data → export all data → clear all → import → watchlist comes back
- [ ] Pagination (`&page=2`) — analyzed once per page, not double-counted
- [ ] A non-search Amazon page (product page, cart, homepage) — no overlay, no console errors

## Known limits

- Verified against the DOM structure documented in current third-party scraping references, not
  against every live marketplace at once — Amazon's frequent A/B tests (PRD §7) mean some layouts
  will read partially or not at all. The overlay disables quietly rather than showing wrong numbers.
- Prime/FBA detection is presence-based only; a `false`/absent reading can mean either "not Prime" or
  "not readable in this locale" (PRD §7 calls this out explicitly).
- Brand is read from a handful of common label patterns ("by X", "Brand: X", "Visit the X Store").
  Layouts that don't print one of those render `brand: null` rather than guessing.
- The watchlist has no background polling or notifications — by design (PRD §6: foreground only).
  Deltas only update when the user revisits and clicks Watch again.
