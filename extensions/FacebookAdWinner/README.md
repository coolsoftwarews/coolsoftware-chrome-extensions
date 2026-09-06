# Meta Ad Winner

Chrome MV3 extension for Meta's Ad Library. Badges every ad with how long it's been running and
how many near-identical variants exist, adds filters and sort for longevity, and a swipe file to
save the ones worth stealing from. No account, no backend, no network requests.

Built from [PRD-14](../../docs/extensions/PRD-14-facebook-ad-winner.md). The core claim:
**an ad still running after 90 days is a winner**, and the Ad Library's own UI buries that signal.

## Quick start

```bash
npm install
npm run icons          # regenerate src/icons/*.png (no image dependency)
npm run build           # dev build into dist/
npm run build:watch     # rebuild on change
npm run build:prod      # minified, production manifest name
npm test                # headless checks — parsing, grouping, longevity, exports
npm run typecheck
npm run zip              # production build + dist/ packed for the Web Store
```

Node 18+ is required. Load it: `chrome://extensions` → Developer mode → **Load unpacked** →
select `dist/`. Then open <https://www.facebook.com/ads/library/> and run any search.

## How it works

| File | Job |
| :-- | :-- |
| `src/adparser.ts` | Turns one ad card's rendered text into structured fields — pure, no DOM |
| `src/grouping.ts` | Variant grouping: normalized-text similarity + landing domain, capped for huge result sets |
| `src/longevity.ts` | Days-running math and the badge text (`🏆 127 days running · 9 variants · still active`) |
| `src/filters.ts` | Min days / active-only / min variants / format filters, and the three sort keys |
| `src/formatters.ts` | CSV and Markdown for both the filtered results and the swipe file, plus filenames |
| `src/storage.ts` | `chrome.storage.local` swipe-file items + collections, backup export/import, quota |
| `src/metrics.ts` | Local-only usage counters — nothing that leaves the device |
| `src/content.ts` | Finds ad cards, injects badges + the filter/sort bar, saves ads straight to storage |
| `src/background.ts` | Relays download requests (content scripts can't call `chrome.downloads` directly) and keeps the toolbar badge count |
| `src/panel.ts` | The action popup: swipe file, search, collections, notes, export, data ownership |

### Finding ads without a stable selector

Meta's Ad Library has no public API and its class names are obfuscated and change without notice.
Every card does, however, print one stable string: `Library ID: <number>`. `findAdCards()` in
`content.ts` walks up from each such text node while the ancestor still contains exactly one
"Library ID" string — the smallest element that fully owns one ad, whatever markup happens to
wrap it this week. `adparser.ts` then reads the start/stop date and Active/Inactive state from the
card's own text with the same philosophy: match known strings, and return `null` rather than guess
when the text doesn't match anything recognized. A parse failure on one card disables that card's
badge quietly — the Library page still works (PRD §6).

**This needs live-page validation before shipping** (PRD §5: "Spike first, 1 day"). The parser was
built against documented Ad Library text patterns, not a live capture, because this build had no
network access to Facebook. Walk the manual checklist below on a real search before publishing.

### Variant grouping

Two ads only ever merge if they share a landing domain **and** their body copy clears a similarity
threshold (Jaccard over normalized word tokens, default 0.6) — see `textSimilarity()` in
`grouping.ts`. Non-English copy is Unicode-normalized (NFKC), never translated. Grouping is capped
at 500 ads per page; beyond that, every ad still gets a real day count but stops being considered
for merging, and the toolbar says so rather than silently guessing (PRD §7).

### Filters, sort, badges

Filtering hides non-matching cards in place. Sorting reorders cards that share one DOM parent (the
common case for a results grid) — cards under any other parent are left alone rather than risk
scrambling a page layout this extension doesn't own. Both are computed from the same
`ComputedAd[]` the badges are built from, so what you filter/sort by is exactly what the badge says.

## Privacy

No `fetch`, no `XMLHttpRequest`, no `sendBeacon` — verifiable with `grep -rn "fetch(" src/` and in
devtools' network tab. Saved ads, notes, collections and usage counters live in
`chrome.storage.local` and are never transmitted. See [PRIVACY.md](PRIVACY.md).

## Manual test checklist

The DOM-bound half needs a real browser and Meta's live markup:

- [ ] A broad search (hundreds of results) — badges render, pagination/infinite scroll keeps working
- [ ] An active ad and a stopped ad — both get a sane day count and the right status word
- [ ] An ad with no readable start date — its card is skipped quietly, no badge, no error
- [ ] Image, video and carousel ads — format detection matches what's actually shown
- [ ] Two obviously-related ads (same offer, different headline, same landing page) — group together
- [ ] Two unrelated ads on the same landing domain — do **not** group
- [ ] The same creative run from two different advertiser pages (agency-run accounts) — PRD §7
- [ ] A political/issue ad card (different layout in some regions) — parser degrades gracefully
- [ ] Non-English ad copy — grouping still works, no translation happens anywhere
- [ ] All four filters, each of the three sort keys, and the region label showing correctly
- [ ] `+ Save ad`, then confirm it shows "Saved ✓" and appears in the popup
- [ ] Export results as CSV and Markdown; export the swipe file as CSV and Markdown
- [ ] Export all data → clear all → import → everything comes back
- [ ] 500+ ads on one page — grouping cap message appears, page stays responsive

## Known limits

- Ad card text parsing is built against documented Ad Library patterns, not a live capture (see
  above) — validate against a real search before publishing.
- Sorting only reorders cards that share a single DOM parent; a layout where results aren't one
  flat grid won't visually re-sort (filtering still works everywhere).
- No ad spend or performance estimate is shown, on purpose — the PRD's whole bet is that longevity
  is the honest proxy and a spend number would be a guess (PRD §4, §10).
