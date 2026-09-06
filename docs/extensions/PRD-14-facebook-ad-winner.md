# PRD — Meta Ad Winner (Facebook Ad Library)

**Status:** Draft for build
**Owner:** Gabriel
**Date:** 2026-08-15
**Type:** Chrome extension (MV3), standalone Web Store listing
**Platform:** Facebook / Meta Ad Library
**Backend:** None · **Accounts:** None · **Payments:** None
**Pair:** [Facebook Group Opportunity Finder](PRD-15-facebook-group-opportunities.md) — that one tests lead generation, this one tests advertising intelligence.

---

## 1. One-line proposition

In Meta's Ad Library, surface the ads that have been running longest and in the most variants — the ones that are almost certainly making money.

## 2. The hypothesis

**Will advertisers pay for creative intelligence?** Advertisers are a proven-spend audience with an obvious ROI story. The claim is that the Ad Library already contains the answer — an ad still running after 90 days is a winner — and that nobody surfaces it well because the Library's own UI buries longevity.

This is the most defensible data source in the portfolio: the Ad Library is a public transparency product, built to be browsed.

## 3. Target user

| Segment | Job |
| :-- | :-- |
| Media buyers | Find proven creative angles before spending |
| Agencies | Competitive teardown for a pitch or a client review |
| Ecommerce operators | See what's working in their category right now |
| Copywriters | Build a swipe file of ads that survived |

## 4. Scope — V1

### The core insight

**Longevity is the proxy for profitability.** Nobody pays to run a losing ad for three months. The Ad Library shows a start date; it does not rank by duration, count variants of the same creative, or let you filter to "still running after 60 days". Those three moves are the entire product.

### In scope

**Result overlay** in the Ad Library. Each ad gets a badge:

```
🏆 127 days running · 9 variants · still active
```

- Days running (start date → today, or → stop date)
- Variant count — ads grouped by near-identical body copy and landing domain
- Status: active / stopped
- Format: image / video / carousel

**Filters** (injected above the results)
- Minimum days running (30 / 60 / 90 / custom)
- Active only
- Minimum variant count
- Format

**Sort** by days running, variant count, or start date — sorting by longevity is the feature people will describe to each other.

**Swipe file.** `+ Save ad` captures advertiser, ad text, landing domain, start date, days running, variants, format, thumbnail, library link, and a note. Collections, same shape as the other savers in this portfolio.

**Export:** CSV and Markdown of either the filtered results or the swipe file.

### Explicitly out of scope for V1

No account, no backend, no Meta API, no ad spend or performance estimates (we cannot see them; competitors who quote them are guessing). No creative download beyond a thumbnail. No landing page capture or archiving. No automated monitoring of an advertiser — the user browses, the tool reads. No tracking of ads the user hasn't looked at.

## 5. Where the data comes from

The Ad Library, rendered in the user's tab. Public by design, no login required for most regions, and Meta publishes it precisely so it can be inspected. That makes this the cleanest permission and store-review story in the portfolio — lean on it in the listing.

Design consequences:
- **Variant grouping is fuzzy matching.** Ads differ by a word or a colour. Group by normalized body text similarity plus landing domain, and let the user expand a group to see the members. Never merge two things the user can't unmerge.
- **Dates are the whole product.** Verify the start date is machine-readable everywhere it appears, including for stopped ads.
- **Region matters.** Political-ad transparency rules differ by country; commercial ad coverage varies. Show the user which region's library they're looking at rather than pretending it's global.

**Spike first, 1 day:** confirm start date, status, format and body text are readable from a Library results page, and check pagination behaviour on a broad search (hundreds of results).

## 6. Non-functional requirements

| Requirement | Target |
| :-- | :-- |
| Badges after results render | < 400 ms |
| Grouping 500 ads into variants | < 300 ms, no jank |
| Permissions | `activeTab`, `storage`, `downloads` + `*://*.facebook.com/*` |
| Privacy | No network requests |
| Failure | Parse failure disables badges quietly; the Library page still works |

## 7. Edge cases

- Ads with no end date vs. ads stopped yesterday
- The same creative from multiple advertiser pages (agency-run accounts)
- Carousels with per-card text
- Non-English ad copy in variant grouping (normalize, don't translate)
- Political/issue ads with a different card layout
- Enormous result sets — cap grouping per page and say so
- Library UI changes

## 8. Success metrics (30 / 90 day)

| Metric | 30d | 90d |
| :-- | :-- | :-- |
| Installs | 250 | 2,500 |
| 7-day retention | 30% | 40% |
| Users who sort or filter by longevity | 50% | 65% |
| Users who save ≥ 1 ad | 30% | 45% |
| Export used ≥ once | 25% | 40% |
| Store rating | ≥ 4.3 | ≥ 4.5 |

This has the highest expected conversion in the portfolio: high-intent audience, obvious value, clean data. If it *doesn't* perform, that's strong evidence the whole "intelligence tool" thesis is weaker than it looks.

## 9. Kill criteria

Under 400 installs at 90 days, **or** under 35% of users using the longevity sort/filter at 90 days. The second means the insight didn't land, which would be surprising and worth understanding before building anything else in this class.

## 10. Open questions

- **Variant grouping threshold.** Too loose and unrelated ads merge; too tight and every ad is its own group. Tune against real searches, and expose the group so the user can judge it.
- **Is longevity enough, or do people want spend estimates?** Everyone will ask. The answer is no — but check whether that costs conversions or earns trust.
- **Swipe file overlap.** This product's save/collection/export layer is the same as the other savers here. Build it once as a shared module before the third one is written.
