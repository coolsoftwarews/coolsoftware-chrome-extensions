# PRD — Etsy Listing Competitor Analyzer

**Status:** Draft for build
**Owner:** Gabriel
**Date:** 2026-08-15
**Type:** Chrome extension (MV3), standalone Web Store listing
**Platform:** Etsy
**Backend:** None · **Accounts:** None · **Payments:** None
**Pair:** [Etsy Niche Opportunity Finder](PRD-20-etsy-niche-finder.md) — that one tests market selection, this one tests listing craft.

---

## 1. One-line proposition

Open a competitor's listing and see exactly how it's built — tags, title structure, photo count, price, shipping and options — then compare several side by side.

## 2. The hypothesis

**Will Etsy sellers pay for listing craft?** The niche finder answers "should I enter?"; this answers "how do I beat the people already there?". Sellers who know their niche have a different, more urgent job: their listing is losing to a specific competitor and they want to know why.

## 3. Target user

| Segment | Job |
| :-- | :-- |
| Etsy sellers | Reverse-engineer the listing that outranks theirs |
| Print-on-demand sellers | Copy the title/tag structure that works |
| New sellers | Learn what a good listing looks like at all |
| Consultants | Produce a listing audit for a client |

## 4. Scope — V1

### In scope

**Listing teardown panel.** On any listing page:

```
Title:      12 words · 118 chars · keyword front-loaded ✓
Tags:       13 of 13 used
Photos:     8  ·  video ✓
Price:      £24.00  ·  free shipping ✓
Options:    3 variations  ·  personalization ✓
Sales:      1,240  ·  ★4.9 (312 reviews)
Shop:       est. 2019 · 4,800 sales · UK
```

Everything shown is on the page; the value is putting it in one legible block instead of scattered across three screens.

**Compare tray.** `+ Compare` adds a listing to a tray (up to 6). The tray view is a table of the fields above, side by side, with the differences highlighted. This is the feature people will screenshot and share — make the table the best-looking thing in the product.

**Tag extraction.** Collect tags across compared listings and show which ones recur. That's the practical output: "5 of 6 competitors use *personalized gift*, you don't".

**Saved teardowns.** Store per-listing snapshots locally with a note; revisit shows what changed (price, sales, tags).

**Export:** CSV (the comparison table) and Markdown (a readable audit — this is the consultant's deliverable).

### Explicitly out of scope for V1

No account, no backend, no Etsy API. No tag or title generation (LLM + payment story = a different product). No listing editing or posting — no write actions on the user's shop. No sales or revenue estimates. No crawling of listings the user hasn't opened. No shop-wide bulk analysis.

## 5. Where the data comes from

Only the listing page the user opened. Tags are visible on Etsy listing pages, which is what makes this product possible without an API — verify that in the spike, because it is the single load-bearing assumption.

**Spike first, half a day:** open 10 listings across categories and locales and confirm tags, photo count, video presence, variations, personalization, shipping and shop stats are all readable. If tags are not reliably exposed, the product shrinks to a structure comparison — still shippable, materially less compelling, and worth knowing before the build.

## 6. Non-functional requirements

| Requirement | Target |
| :-- | :-- |
| Teardown panel populated | < 300 ms after listing load |
| Compare tray with 6 listings | Renders instantly; persists across navigation |
| Permissions | `activeTab`, `storage`, `downloads` + `*://*.etsy.com/*` |
| Zero extra requests | No `fetch` in the codebase |
| Privacy | No network requests; teardowns local |

## 7. Edge cases

- Listings with no tags shown
- Digital downloads (no shipping fields)
- Sold-out or deactivated listings
- Multi-quantity/variation pricing (show the range, not a single number)
- Non-English listings and tags
- Currency differences across compared listings — convert nothing, label everything
- Etsy layout changes

## 8. Success metrics (30 / 90 day)

| Metric | 30d | 90d |
| :-- | :-- | :-- |
| Installs | 200 | 2,000 |
| 7-day retention | 30% | 40% |
| Users who tear down ≥ 3 listings | 50% | 65% |
| Users who use the compare tray | 35% | 50% |
| Export used ≥ once | 25% | 35% |
| Store rating | ≥ 4.3 | ≥ 4.5 |

Compare-tray usage is the differentiator metric: a single teardown is a nicety, a comparison is a decision.

## 9. Kill criteria

Under 300 installs at 90 days, **or** compare tray used by under 25% of active users at 90 days. Without comparison this is a prettier listing page, and that's not a product.

## 10. Open questions

- **Is one shared Etsy extension better than two?** These two products sit closer together than any other pair in the portfolio. Keep them separate through the first 90 days so the hypotheses stay distinguishable, then consider merging the winner with the loser's best feature.
- **Does the Markdown audit have a life of its own?** If consultants export audits constantly, that's a paid-product signal worth following.
- **Tag recurrence needs a minimum sample.** Below 4 compared listings, "5 of 6 competitors" isn't a finding. Enforce the floor in the UI.
