# PRD — Pinterest Opportunity Finder

**Status:** Draft for build
**Owner:** Gabriel
**Date:** 2026-08-15
**Type:** Chrome extension (MV3), standalone Web Store listing
**Platform:** Pinterest
**Backend:** None · **Accounts:** None · **Payments:** None
**Pair:** [Pinterest Competitor Pin Research](PRD-17-pinterest-competitor-research.md) — that one tests workflow, this one tests content intelligence.

---

## 1. One-line proposition

For any Pinterest search, see which pins are pulling far above their board's normal saves — and what keywords those pins are actually using.

## 2. The hypothesis

**Will bloggers and ecommerce sellers pay for content intelligence?** Pinterest is a search engine wearing a feed's clothes, and its users are unusually commercially minded (bloggers monetizing traffic, sellers driving product views). The claim is that outlier pins plus the keywords in their titles/descriptions is a usable content brief.

## 3. Target user

| Segment | Job |
| :-- | :-- |
| Bloggers | Find the angle that gets saved in their niche |
| Ecommerce sellers | See which product framings perform |
| Pinterest marketers | Build a pin strategy from evidence |
| Etsy/Shopify sellers | Understand demand phrasing before writing listings |

## 4. Scope — V1

### In scope

**Search overlay.** On a search results page, badge each pin with what Pinterest exposes — saves/reactions where visible, domain, and an outlier ratio against the median of the loaded results:

```
🔥 4.2×  ·  1.2K saves  ·  domain.com
```

**Keyword panel** — the differentiator. Across the top-performing pins in the current results:
- Words and 2–3 word phrases over-represented in outlier titles/descriptions versus the rest of the results
- Which domains recur among outliers (who owns this query)
- The pin formats that dominate (image ratio bands, text-on-image vs. plain)

Presented as counts with the sample size, never as advice.

**Filters:** min outlier ratio · domain · has text overlay (where detectable) · last N results.

**Export:** CSV and Markdown — pins with metrics, plus the keyword table. The keyword table is the artifact people will actually use.

**Local state:** last filter, cached medians per query. Nothing else.

### Explicitly out of scope for V1

No account, no backend, no Pinterest API. No search volume estimates (Pinterest doesn't expose them and inventing them is fraud-adjacent). No pin scheduling, posting or saving to boards — no write actions. No image download. No competitor tracking over time. No bulk collection beyond the results the user is looking at.

## 5. Where the data comes from

Only the search results and pin cards Pinterest renders in the user's tab.

The known weakness, stated up front: **Pinterest exposes engagement inconsistently.** Save counts appear on some surfaces and not others, and the numbers shown are not always current. Design for it:

- If saves are unreadable for a result set, fall back to a **relative rank within the query** (Pinterest's own ordering is a signal) and label the badge accordingly — never present a rank as a save count.
- Show the sample size on the median, always.

**Spike first, 1 day, and treat it as a go/no-go on the badge:** on 10 varied queries, check what fraction of pins expose a usable engagement number. Under ~50% and the outlier framing doesn't hold — in which case the keyword panel becomes the product and the badge is dropped. That is a smaller but still shippable tool, and knowing it before building saves a week.

## 6. Non-functional requirements

| Requirement | Target |
| :-- | :-- |
| Badges after results render | < 400 ms; no layout shift in the masonry grid |
| Keyword panel recompute | < 300 ms for 200 pins |
| Permissions | `activeTab`, `storage`, `downloads` + `*://*.pinterest.*/*` |
| Privacy | No network requests |
| Failure | Degrade to keywords-only rather than showing wrong numbers |

## 7. Edge cases

- Pins with no visible engagement number
- Promoted pins (exclude from the median, label them)
- Idea pins vs. standard pins (different surfaces, different data)
- Non-English queries and descriptions (count tokens, don't parse grammar)
- Regional domains (`pinterest.co.uk`, `.de`, `.fr` — the manifest must cover them)
- Infinite scroll changing the median as the user scrolls
- Repins of the same image from different domains (group in the keyword view, list separately in results)

## 8. Success metrics (30 / 90 day)

| Metric | 30d | 90d |
| :-- | :-- | :-- |
| Installs | 200 | 2,000 |
| 7-day retention | 25% | 35% |
| Users who run ≥ 3 analysed searches | 50% | 60% |
| Keyword panel opened | 45% | 55% |
| Export used ≥ once | 25% | 35% |
| Store rating | ≥ 4.2 | ≥ 4.4 |

## 9. Kill criteria

Under 300 installs at 90 days, **or** engagement data readable on under half of searches after the spike's mitigations. Wrong numbers in a seller's research is the failure mode that generates the reviews you can't recover from.

## 10. Open questions

- **Is the keyword panel the actual product?** If the spike says engagement is unreliable, the answer is probably yes — and a "Pinterest keyword extractor" may be an easier listing to sell than an outlier finder.
- **Blogger vs. seller.** They search differently and want different exports. Pick one for the listing copy; serve both in the product.
- **Pinterest's tolerance.** Confirm no recent enforcement against read-only overlays before building.
