# Etsy Listing Analyzer

Chrome MV3 extension. Tear down any Etsy listing — title, tags, photos, price, options, sales,
shop — into one legible block, compare up to 6 side by side, see which tags recur across
competitors, and export the comparison as CSV or a Markdown audit. No account, no backend, no
Etsy API, no network requests.

Built from
[PRD-21](../../docs/extensions/PRD-21-etsy-listing-analyzer.md). Its pair is the
[Niche Opportunity Finder](../../docs/extensions/PRD-20-etsy-niche-finder.md) — that one
tests market selection, this one tests listing craft (kept as two separate extensions through the
first 90 days per PRD §10).

## Quick start

```bash
npm install
npm run icons          # regenerate src/icons/*.png (no image dependency)
npm run build          # dev build into dist/
npm run build:watch    # rebuild on change
npm run build:prod     # minified, production manifest name
npm test               # headless checks — analysis, exports, filenames
npm run typecheck
npm run zip            # production build + dist/ packed for the Web Store
```

Node 18+ is required. Load it: `chrome://extensions` → Developer mode → **Load unpacked** →
select `dist/`.

## How it works

| File | Job |
| :-- | :-- |
| `src/url.ts` | Matches Etsy listing URLs across locale prefixes and query strings |
| `src/analysis.ts` | Pure logic: title structure, price formatting, the schema.org JSON-LD parser, text-pattern fallbacks, tag recurrence, the compare-table diff |
| `src/extract.ts` | The DOM half: reads the live listing page and hands strings to `analysis.ts` |
| `src/content.ts` | The in-page overlay panel (Teardown / Compare / Saved tabs), all persistence and export wiring |
| `src/background.ts` | Toggles the panel from the toolbar icon; performs downloads (content scripts can't call `chrome.downloads`) |
| `src/formatters.ts` | CSV and Markdown audit builders, filenames, the saved-teardown diff |
| `src/storage.ts` | `chrome.storage.local` records: the compare tray, saved teardowns, backup export/import, quota status |
| `src/metrics.ts` | Local-only usage counters, one per PRD §8 success metric |

There is no side panel and no popup — the whole UI is a shadow-DOM overlay the content script
injects directly into the listing page (a small toggle tab, expanding to a panel), so the panel
counts toward none of Chrome's `sidePanel`/`tabs`/`scripting` permissions. Clicking the toolbar
icon sends a message to toggle it.

### Where the data comes from (PRD §5)

Two sources, in order:

1. **schema.org JSON-LD** (`<script type="application/ld+json">`), which Etsy ships for search
   engines: title, photo count, price (single or `AggregateOffer` range), stock status, rating,
   review count, shop name. This is the most redesign-resistant source on the page — markup churns,
   schema.org fields mostly don't.
2. **Text-pattern fallbacks** for what JSON-LD doesn't carry: tags, shop established year, shop
   total sales, shop location, free shipping, digital-download status, personalization, listing
   purchase count. Each is a small regex in `src/analysis.ts`, pure and unit tested, applied to text
   scraped from a relevant region of the page (or the whole page as a last resort).

Every field that can't be found comes back `null`/"—" rather than a guess, and is listed in the
teardown's `unavailable` array so the panel says plainly what it couldn't read (PRD §7: Etsy layout
changes). **PRD §5 calls for a half-day spike — open 10 real listings across categories and locales
and confirm tags, photo count, video, variations, personalization, shipping and shop stats are all
readable — before shipping.** The selectors and regexes here are a best-effort starting point, not
verified against live Etsy markup; treat `src/extract.ts` as the first thing to check against real
pages, and the manual checklist below as required, not optional.

## Manual test checklist

The DOM-bound half (`src/extract.ts`, `src/content.ts`) needs a real browser on real listings:

- [ ] A normal physical listing with tags, photos, video, variations and free shipping
- [ ] A listing with no tags shown (PRD §7) — panel says "0 of 13 used — none shown", doesn't crash
- [ ] A digital download — no shipping line, no false "free shipping ✗"
- [ ] A sold-out listing and a deactivated/removed listing — both flagged, fields degrade gracefully
- [ ] A listing with variation pricing — shows a range (`£18.00–£26.00`), never an averaged number
- [ ] A non-English listing (tags and title captured as-is, no translation attempted)
- [ ] Two compared listings in different currencies — both labelled with their own currency, no conversion
- [ ] Add 6 listings to the compare tray, confirm the 7th is refused with a clear reason
- [ ] Compare table with fewer than 4 listings — recurrence section explains the floor instead of showing a false finding
- [ ] Save a teardown, revisit the same listing after a price change — diff shows old → new
- [ ] Export CSV and Markdown from the compare tab, Markdown from a single teardown and from Saved
- [ ] Export all data → clear all → import → everything comes back
- [ ] Keyboard only: open the panel from the toolbar icon, tab through the tabs and buttons, Escape closes it
- [ ] Etsy's own page layout doesn't shift when the overlay injects (fixed-position, shadow DOM)

## Privacy

No `fetch`, no `XMLHttpRequest`, no `sendBeacon` — verifiable with `grep -rn "fetch(" src/` and in
devtools' network tab. Teardowns, the compare tray, saved listings and usage counters live in
`chrome.storage.local` and are never transmitted. See [PRIVACY.md](PRIVACY.md).

## Known limits

- Etsy's markup is not versioned or documented; selectors in `src/extract.ts` will need occasional
  updates. The JSON-LD-first design (see above) is the main defense against that.
- Tags are the single load-bearing assumption of the whole product (PRD §5) — if Etsy stops
  exposing them on the page, the product still works as a structure comparison, materially less
  compelling.
- No sales or revenue estimates, no bulk/shop-wide analysis, no tag or title generation — explicitly
  out of scope (PRD §4), not missing features.
