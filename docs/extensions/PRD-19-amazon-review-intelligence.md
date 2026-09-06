# PRD — Amazon Review Intelligence

**Status:** Draft for build
**Owner:** Gabriel
**Date:** 2026-08-15
**Type:** Chrome extension (MV3), standalone Web Store listing
**Platform:** Amazon
**Backend:** None · **Accounts:** None · **Payments:** None
**Pair:** [Amazon Product Opportunity Overlay](PRD-18-amazon-product-opportunity.md) — that one tests market intelligence, this one tests customer intelligence.

---

## 1. One-line proposition

Turn a competitor's reviews into a list of complaints, ranked by how often they come up — the product improvements and the copy angles, in one pass.

## 2. The hypothesis

**Will sellers pay for customer intelligence?** Reading 300 reviews to find the three recurring complaints is the most valuable hour in product research and the one nobody wants to spend. The claim is that clustering the complaints locally, with the reviews still attached as evidence, is the useful artifact.

Cleaner data story than its pair: reviews are text on a page the user opened, and the analysis is counting, not estimating.

## 3. Target user

| Segment | Job |
| :-- | :-- |
| Amazon sellers | Find what to fix in a competitor's product to beat it |
| Product developers | Source requirements from real complaints |
| Copywriters / marketers | Write the bullet that answers the top objection |
| Ecommerce operators | Decide whether a supplier's product has a known flaw |

## 4. Scope — V1

### In scope

**Review page analysis.** On a product's reviews, an analysis panel:

```
214 reviews read  ·  47 negative (1–2★)

Recurring themes in negative reviews
  battery / charge / dies        18 mentions
  strap / broke / snapped        12
  instructions / manual / unclear 9
  sizing / too small              7

Recurring praise
  easy to set up                 31
```

- Themes are **frequent term clusters** — normalized words and 2–3 word phrases that recur across reviews, grouped by co-occurrence. Not sentiment AI, not an LLM: countable, explainable, and correct or visibly wrong
- Every theme expands to the reviews behind it. The evidence must always be one click away, or the number is just an assertion
- Split by star band, and by verified purchase where readable

**Filters:** star band · verified only · date range · keyword.

**Saved analyses.** Store an analysis per ASIN locally: themes, counts, date, and the user's note. Re-running later shows what changed — `"battery" mentions up from 18 to 31`.

**Export:** CSV (theme, count, star band, example review) and Markdown (a readable teardown, which is what gets pasted into a product brief).

### Explicitly out of scope for V1

No account, no backend, no LLM or cloud analysis (sending someone's competitive research to an API breaks the local-only promise and needs a payment story). No fake-review detection — a serious claim requiring data we don't have, and being wrong about it is defamatory. No review scraping across products the user hasn't opened. No automated pagination through hundreds of review pages — read what the user loads (see §5). No write actions.

## 5. Where the data comes from — read before committing

Only reviews rendered on the page the user opened, at human speed. **Do not auto-paginate**: clicking through 20 review pages on the user's behalf is crawling, it trips Amazon's bot detection, and it puts the user's session at risk. Instead:

- Analyse what's loaded, and state it: `214 reviews read — scroll or open more pages to include them`
- Accumulate across pages the user navigates themselves, keyed by ASIN
- Make the "read more" instruction part of the UI, not a footnote

That constraint is a genuine product limitation and also the thing that keeps this shippable. Design the panel so a 50-review analysis is still useful, because that's what most users will have.

**Spike first, 1 day:** confirm review text, rating, date and verified status are readable across `.com`/`.co.uk`/`.de`, and check how many reviews a single page yields.

## 6. Non-functional requirements

| Requirement | Target |
| :-- | :-- |
| Analysis of 200 reviews | < 500 ms, computed in-page |
| Theme expansion | Instant (evidence held in memory) |
| Permissions | `activeTab`, `storage`, `downloads` + `*://*.amazon.*/*` |
| Zero extra requests | No `fetch` anywhere — same posture as the pair |
| Privacy | No network requests; analyses stay local |

## 7. Edge cases

- Products with fewer than 20 reviews (say "not enough to cluster", don't show noise)
- Reviews in multiple languages on one listing (cluster per language, don't blend)
- Variation-level reviews mixed across sizes/colours (label the variation where readable)
- Reviews that are images/video only
- Very long reviews (weight by review, not by word, or one essay dominates a theme)
- Stop-word-heavy clusters ("product", "amazon", "item" must not become themes)
- Amazon layout A/B tests

## 8. Success metrics (30 / 90 day)

| Metric | 30d | 90d |
| :-- | :-- | :-- |
| Installs | 300 | 3,000 |
| 7-day retention | 25% | 35% |
| Users who analyse ≥ 3 products | 45% | 60% |
| Users who expand a theme to its reviews | 50% | 65% |
| Export used ≥ once | 30% | 45% |
| Store rating | ≥ 4.3 | ≥ 4.5 |

Theme expansion is the trust metric: it means people believed the clustering enough to check it, which is exactly the behaviour a numbers-based tool should produce.

## 9. Kill criteria

Under 500 installs at 90 days, **or** theme quality complaints in more than 10% of reviews. Bad clusters are worse than no clusters — the user's whole reason to install is not reading 300 reviews themselves.

## 10. Open questions

- **Clustering quality without an LLM.** Term co-occurrence is crude. Test it against 10 real listings and judge honestly — if the themes are junk, the options are (a) ship a simpler "keyword frequency in negative reviews" tool, which is still useful, or (b) don't ship. Not (c) add an API and a subscription.
- **How much does the "read what's loaded" limit hurt?** If most users analyse 30 reviews and want 300, the value story weakens. Measure the distribution.
- **Same buyer as the pair.** Consider one listing with both features later — but only after both have separate 90-day numbers, or the experiment is spoiled.
