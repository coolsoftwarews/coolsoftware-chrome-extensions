# Amazon Review Intelligence

Chrome MV3 extension. Reads the reviews already rendered on an Amazon product page and clusters the
recurring complaints and recurring praise — locally, by counting, with every review behind a theme one
click away. No account, no backend, no LLM, no network requests.

Built from [PRD-19](../../docs/extensions/PRD-19-amazon-review-intelligence.md). The build
system and the storage/export patterns are ported from [WebHighlighter](../WebHighlighter) and
[YouTubeTranscription](../YouTubeTranscription).

## Quick start

```bash
npm install
npm run icons          # regenerate src/icons/*.png (no image dependency)
npm run build          # dev build into dist/
npm run build:watch    # rebuild on change
npm run build:prod     # minified, production manifest name
npm test               # headless checks — tokenizing, clustering, parsing, exports
npm run typecheck
npm run zip            # production build + dist/ packed for the Web Store
```

Node 18+ is required (verified on v24).

Load it: `chrome://extensions` → Developer mode → **Load unpacked** → select `dist/`. Then open any
Amazon product page (or its `/product-reviews/…` page) and click the toolbar icon.

## How it works

| File | Job |
| :-- | :-- |
| `src/text.ts` | Tokenizing, stopwords, Amazon noise words, a light stemmer — pure string logic |
| `src/language.ts` | Buckets a review's dominant Unicode script (Latin/Cyrillic/CJK/Arabic/…) |
| `src/cluster.ts` | The clustering algorithm itself — see below |
| `src/analyze.ts` | Wires filters + language buckets + star bands + the clusterer together |
| `src/parse.ts` | Pure text parsing: star rating text, helpful-vote counts, review dates, ASIN, filenames |
| `src/formatters.ts` | CSV and Markdown export — pure, fully tested |
| `src/storage.ts` | `chrome.storage.local` records keyed by ASIN, snapshot history, backup export/import |
| `src/metrics.ts` | Local-only usage counters |
| `src/content.ts` | Reads `div[data-hook="review"]` elements already on the page, merges into storage |
| `src/background.ts` | Badges the toolbar icon with the running review count — no other job |
| `src/panel.ts` | The popup: themes, filters, evidence, note, exports, data ownership |

### The clustering algorithm, which is the whole product

Not sentiment AI, not an LLM (PRD §4) — every number is a count of *distinct reviews*, so it is either
right or visibly wrong:

1. Tokenize each review; drop stopwords and Amazon-specific noise words ("amazon", "product", "item",
   "order", "review"…) so they can never become a theme.
2. Build 1–3 word candidate phrases from what survives, but only from words that were close together in
   the original sentence — a run of several stripped stopwords breaks the chain, so unrelated ideas
   never get glued into one phrase.
3. Count each candidate **once per review it appears in**, never once per occurrence — a single long,
   repetitive review can't dominate a theme.
4. Drop anything below a mention floor that scales gently with how many reviews are in the band.
5. Greedily group candidates whose review-sets overlap heavily into clusters — this is the
   "battery / charge / dies" grouping in the PRD's worked example. A cluster's count is the size of the
   *union* of its members' reviews, never the sum.

This runs once per language bucket (PRD §7 — a listing with reviews in two languages is analysed
separately per language, never blended) and once each for the negative band (1–2★) and the positive band
(4–5★). A band under 20 reviews says so plainly instead of showing noise.

### Reading, not crawling (PRD §5)

The content script reads whatever `div[data-hook="review"]` elements are already rendered — on the
product page's review section and on the dedicated `/product-reviews/…` page — and re-scans on DOM
mutation (Amazon's own "see more reviews" AJAX, or a page's own late-loading content). It never clicks
"next page" and never fetches anything. Reviews accumulate per ASIN as the user navigates their own
review pages; the panel always states how many were read and whether more pages are available.

## Privacy

No `fetch`, no `XMLHttpRequest`, no `sendBeacon` — verifiable with `grep -rn "fetch(" src/` and in
devtools' network tab. Reviews, notes and usage counters live in `chrome.storage.local` and are never
transmitted. Host access is limited to Amazon's storefronts (see `scripts/build.mjs` for the exact list —
Chrome match patterns don't support a wildcard TLD, so the PRD's `*.amazon.*` shorthand is expanded into
the storefronts explicitly). See [PRIVACY.md](PRIVACY.md).

## Manual test checklist

The DOM-bound half (content.ts's review scraping) needs a real Amazon page. PRD §5 calls for a 1-day
spike confirming review text, rating, date and verified status are readable across `.com`/`.co.uk`/`.de`
before relying on this in production — walk this list as that spike:

- [ ] A product page's review section (bottom of `/dp/ASIN`) and the dedicated `/product-reviews/ASIN`
      page both populate the badge and the panel
- [ ] Star rating, title, body, date, verified badge and size/colour variation all read correctly
- [ ] A review with no text (image/video only) counts toward the total but never appears as evidence
- [ ] Paginating to page 2 on the reviews page accumulates on top of page 1, not replacing it (same ASIN)
- [ ] A product with fewer than 20 reviews shows "not enough to cluster" instead of noise
- [ ] `.co.uk` and `.de` listings: dates, verified-purchase badge and "reviewed in" text still parse
- [ ] A listing with reviews in two languages: each language gets its own theme list, not blended
- [ ] Filters (star band, verified only, keyword, date range) narrow both the summary and the exports
- [ ] Re-opening the panel a day later on the same ASIN shows "up from X to Y" on a repeated theme
- [ ] Export CSV and Markdown; open both and confirm the evidence quotes match the panel
- [ ] Export all data → clear all → import → everything comes back
- [ ] A non-Amazon page and `chrome://extensions`: the panel says there's nothing here, no errors

## Known limits

- Only English month names parse into a sortable date; other locales' dates still display in the
  evidence list, they just don't filter by date range (documented, not silently wrong).
- The clustering threshold and merge heuristics are deliberately simple (PRD §10 flags term
  co-occurrence as crude by nature). If themes read as junk against real listings, the fallback per the
  PRD is a simpler "keyword frequency in negative reviews" view — not an API and a subscription.
- Amazon's review markup has been stable for years but is not a public API; a layout A/B test could stop
  the extension from finding review elements. The panel then reads "no reviews found on this page yet"
  rather than crashing.
