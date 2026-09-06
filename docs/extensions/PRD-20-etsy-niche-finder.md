# PRD — Etsy Niche Opportunity Finder

**Status:** Draft for build
**Owner:** Gabriel
**Date:** 2026-08-15
**Type:** Chrome extension (MV3), standalone Web Store listing
**Platform:** Etsy
**Backend:** None · **Accounts:** None · **Payments:** None
**Pair:** [Etsy Listing Competitor Analyzer](PRD-21-etsy-listing-analyzer.md) — that one tests listing craft, this one tests market selection.

---

## 1. One-line proposition

For any Etsy search, read the shape of the niche in one strip: how established the sellers are, how much of the page one shop owns, and whether new listings are breaking through.

## 2. The hypothesis

**Will Etsy sellers pay for market intelligence?** Etsy's seller base is huge, largely non-technical, and served by expensive tools (eRank, Marmalead, Alura) that all demand a signup before showing anything. The claim is that a zero-friction, in-page read of a search page converts people who bounce off a paywall.

Etsy is also the friendliest big marketplace to work on: rich data on the search page, less aggressive anti-extraction posture than Amazon.

## 3. Target user

| Segment | Job |
| :-- | :-- |
| New Etsy sellers | "Can I get into this niche, or is it locked up?" |
| Established sellers | Scan adjacent niches for expansion |
| Print-on-demand sellers | Triage many niches quickly |
| Craft businesses | Understand pricing norms before launching |

## 4. Scope — V1

### The core insight

The three things that decide whether an Etsy niche is enterable are all on the search page:

- **Sales moat** — Etsy shows per-listing sales/review counts. If page one is all 5,000-sale shops, that's a wall
- **Shop concentration** — how many distinct shops hold the first two pages. Four shops owning 30 slots is a closed niche
- **Freshness** — are there recent listings ranking, or is page one a decade old

### In scope

**Search-page strip**

```
Niche read: 64 listings · 23 shops · median 340 sales · median price £24
Concentration: top 3 shops hold 41% of page one
Price band: £12–£58 (middle 50%)
```

Per-listing badges: sales/reviews, price, shop name, ad/organic where readable.

**Filters:** max sales (find the beatable listings) · price band · shop · organic only.

**Tag view.** Aggregate the words appearing in the titles of the top listings — Etsy search is title/tag driven, so this doubles as a keyword artifact. Show counts and the sample size, never a "search volume".

**Niche snapshots.** `+ Save niche` stores today's numbers for a query locally. Returning shows the delta: `median sales +40 since 12 Aug`. User-triggered, no background polling.

**Export:** CSV/Markdown of listings, the summary, and the tag table.

### Explicitly out of scope for V1

**No search volume or revenue estimates.** Every paid competitor sells them; they're modelled, they need a backend, and they're the fastest way to mislead a seller. Not in V1.

Also out: no account, no backend, no Etsy API, no listing creation or editing, no tag generation ("write my tags for me" needs an LLM and a payment story), no automated crawling of pages the user isn't viewing, no shop-level history beyond user-triggered snapshots, no write actions.

## 5. Where the data comes from

Only the search results Etsy renders in the user's tab. No API key, no extra requests, human speed.

Design notes from the data itself:
- **Sales counts are per listing, and Etsy sometimes shows reviews instead.** Label which one a badge is showing — mixing them silently invalidates the median
- **Ads are interleaved.** Exclude promoted listings from the concentration and median stats or every niche looks more contested than it is
- **Pagination.** Stats come from the pages the user actually loads; state the sample (`from 2 pages, 128 listings`)

**Spike first, 1 day:** confirm sales/review counts, price, shop name and ad status are readable across a few categories and at least two locales. Etsy's search layout is comparatively stable, which is why this pair is 🟢.

## 6. Non-functional requirements

| Requirement | Target |
| :-- | :-- |
| Strip after results render | < 400 ms; no layout shift |
| Permissions | `activeTab`, `storage`, `downloads` + `*://*.etsy.com/*` |
| Zero extra requests | No `fetch` in the codebase |
| Privacy | No network requests; snapshots local |
| Failure | Strip hides itself; Etsy's page still works |

## 7. Edge cases

- Promoted/ad listings (excluded from stats, visibly labelled)
- Digital vs. physical products (different price norms — note the mix)
- Listings with zero sales
- Multi-currency and locale differences (state the currency in the strip)
- Personalized/variable-price listings
- Very broad queries (thousands of results — stats are of what's loaded, always say so)
- Etsy A/B tests on the results layout

## 8. Success metrics (30 / 90 day)

| Metric | 30d | 90d |
| :-- | :-- | :-- |
| Installs | 250 | 2,500 |
| 7-day retention | 30% | 40% |
| Users who analyse ≥ 5 searches | 50% | 65% |
| Users who save ≥ 1 niche snapshot | 25% | 40% |
| Export used ≥ once | 20% | 30% |
| Store rating | ≥ 4.3 | ≥ 4.5 |

## 9. Kill criteria

Under 400 installs at 90 days, **or** under 30% of users analysing five searches. Etsy sellers search constantly; if they don't, the strip isn't answering their question.

## 10. Open questions

- **Will "no search volume" cost us?** eRank's whole pitch is volume estimates. Our counter is that everything we show is real. Test it in the listing copy — the answer generalizes to the Amazon pair.
- **Concentration vs. moat — which is the headline?** Pick one number to lead with; two competing headlines is none.
- **Snapshot habit.** Without notifications, deltas only work if people come back. If snapshots go unused by 90 days, cut them rather than carrying dead weight.
