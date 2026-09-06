# PRD — Amazon Product Opportunity Overlay

**Status:** Draft for build — **gated on §5**
**Owner:** Gabriel
**Date:** 2026-08-15
**Type:** Chrome extension (MV3), standalone Web Store listing
**Platform:** Amazon
**Backend:** None · **Accounts:** None · **Payments:** None
**Pair:** [Amazon Review Intelligence](PRD-19-amazon-review-intelligence.md) — that one tests customer intelligence, this one tests market intelligence.

---

## 1. One-line proposition

On any Amazon search, see at a glance how contested the category is — how many sellers, how old the listings, how thin the review moats are.

## 2. The hypothesis

**Will Amazon sellers pay for market intelligence from a free, local tool?** Sellers are the highest-spending buyer in the portfolio, and the incumbents (Jungle Scout, Helium 10) charge $50–200/month. The claim is *not* that we beat them — it's that a legible, free, no-signup slice of the same question converts a meaningful slice of people who bounce off a $99 subscription.

## 3. Target user

| Segment | Job |
| :-- | :-- |
| New Amazon sellers | "Is this category winnable or a wall?" |
| Established sellers | Scan adjacent categories quickly |
| Product researchers / agencies | Rapid triage before deep analysis |
| Ecommerce operators | Sanity-check a supplier's pitch |

## 4. Scope — V1

### The core insight

Sellers don't need an estimate of somebody's revenue. They need to know **whether they can win**. The readable proxies, all present on the search page itself:

- **Review moat** — how many reviews the top results have. Ten listings with 20K reviews each is a wall; a page of 50-review listings is an opening
- **Listing age** — new listings ranking high means the category is still moving
- **Rating ceiling** — top results averaging 4.1 means customers are unhappy and there's room
- **Concentration** — how many distinct brands hold the first page

### In scope

**Search-page overlay.** A summary strip above results:

```
Category read: 42 results · median 380 reviews · median rating 4.2 · 11 distinct brands
Moat: moderate  ·  Rating ceiling: soft (3 of 10 top results under 4.3)
```

Plus a per-result badge: review count, rating, price, and whether the listing is Prime/FBA where readable.

**Filters:** max reviews · min rating gap (rating below X) · price band · brand.

**Watchlist.** `+ Watch` a search or a product to store today's snapshot locally. Revisiting shows the delta: `+140 reviews since 12 Aug`. This is the closest thing to tracking that a local-only tool can honestly offer, and it's genuinely useful — it just requires the user to come back.

**Export:** CSV/Markdown of the result set and of watchlist snapshots.

### Explicitly out of scope for V1

**No sales, revenue or BSR-derived estimates.** Every paid competitor sells those; they are modelled guesses, they need a backend and a data set we don't have, and a wrong number costs a seller real money. Not in V1, not by approximation.

Also out: no account, no backend, no Amazon API/PA-API, no keyword search volume, no supplier or sourcing data, no automated crawling of listings the user isn't viewing, no price scraping across time beyond user-triggered snapshots, no write actions.

## 5. The gate — Amazon's posture

**This PRD is marked 🟡 for a reason.** Amazon is aggressive about extraction: rate limits, bot detection, and a history of pursuing scrapers. What keeps this defensible is that the extension reads only the page the user has already loaded, at human speed, with no additional requests. That distinction is real, and it must also be *visible* in the code (no background fetches, none, anywhere).

Check before building:
1. Recent enforcement against read-only Amazon extensions in the Web Store.
2. Whether review counts, ratings, prices and brand are reliably readable from a search page across at least `.com`, `.co.uk` and `.de` (layouts differ per marketplace, and sponsored slots differ more).
3. Whether listing age is obtainable at all without opening each product — if not, drop it from V1 rather than opening pages on the user's behalf, which would be crawling.

**Spike first, 2 days, go/no-go.** If listing age is unavailable and the layouts fragment per marketplace, ship the pair first — [Review Intelligence](PRD-19-amazon-review-intelligence.md) has a cleaner data story and the same buyer.

## 6. Non-functional requirements

| Requirement | Target |
| :-- | :-- |
| Summary strip after results render | < 400 ms; no layout shift |
| Permissions | `activeTab`, `storage`, `downloads` + `*://*.amazon.*/*` |
| Zero extra requests | No `fetch` anywhere in the codebase — this is the legal posture, enforced in code review |
| Privacy | No network requests; snapshots stay local |
| Failure | Overlay disables quietly; Amazon's page must never break |

## 7. Edge cases

- Sponsored results (exclude from category stats, label them)
- Variations (one listing, many SKUs) counted once
- Marketplaces with different layouts and currencies
- Books/media categories where the metrics mean something different
- Listings with no reviews yet
- Prime/FBA badge not readable in some locales
- Amazon's frequent A/B tests — two users can see different DOMs on the same day

## 8. Success metrics (30 / 90 day)

| Metric | 30d | 90d |
| :-- | :-- | :-- |
| Installs | 300 | 3,000 |
| 7-day retention | 30% | 40% |
| Users who analyse ≥ 5 searches | 45% | 60% |
| Users who watch ≥ 1 search/product | 25% | 40% |
| Export used ≥ once | 20% | 30% |
| Store rating | ≥ 4.2 | ≥ 4.4 |

Seller tools have the highest install ceiling here. If seller-class products outperform creator-class ones across the portfolio, that's the finding that reshapes everything after.

## 9. Kill criteria

Under 500 installs at 90 days (the bar is higher because the audience is bigger), **or** any breakage that causes the overlay to display wrong numbers to sellers more than once. Also an immediate stop if Amazon's terms or enforcement change against read-only overlays.

## 10. Open questions

- **Will "no estimates" read as honest or as incomplete?** Every review will ask for revenue numbers. Test the framing in the listing: "the numbers Amazon actually shows you, read properly" vs. competitors' modelled guesses.
- **Is the watchlist delta enough to build a habit** without notifications, which we can't do locally?
- **Which marketplace first?** Supporting `.com` only is faster and covers most sellers; multi-marketplace is a differentiator against tools that are US-centric.
