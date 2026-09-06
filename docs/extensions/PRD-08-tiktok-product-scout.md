# PRD — TikTok Product Scout

**Status:** Draft for build
**Owner:** Gabriel
**Date:** 2026-08-15
**Type:** Chrome extension (MV3), standalone Web Store listing
**Platform:** TikTok
**Backend:** None · **Accounts:** None · **Payments:** None
**Pair:** [TikTok Creator Outlier Finder](PRD-09-tiktok-creator-outliers.md) — that one tests content intelligence, this one tests commercial intelligence.

---

## 1. One-line proposition

Spot the products selling through TikTok before they're obvious — which items keep appearing in videos that are outperforming their creators' normal reach.

## 2. The hypothesis

**Will sellers pay for commercial intelligence?** Sellers are the best-monetizing buyer in this whole portfolio — they have a P&L and they already pay for tools. The claim is that the useful unit isn't "trending video", it's "product showing repeat traction across multiple accounts".

## 3. Target user

| Segment | Job |
| :-- | :-- |
| Ecommerce / dropship sellers | Find a product with proven demand before the market floods |
| TikTok Shop sellers | Decide what to stock or promote next |
| Agencies | Build a product shortlist for a client |
| Affiliates | Pick what to promote this month |

## 4. Scope — V1

### The core insight

A single viral video proves nothing — it might be one lucky creator. **Repetition across independent accounts** is the signal: the same product showing up in five videos from five creators, each outperforming that creator's own baseline, is a market forming.

### In scope

**Signal overlay** on the feed, search results and hashtag pages. Each video gets a compact badge:

```
🔥 6.2× · 340K · 🛒 shop link
```

- Outlier ratio against the creator's recent median (same engine as the pair — build it once)
- Commercial markers: TikTok Shop link, product tag, "link in bio", affiliate-style caption patterns
- Views, likes, comments, publish date

**Product board** (side panel). When a video carries a commercial marker, offer `+ Track product`. Grouping is by the marker the user chooses — shop item, caption keyword, or a name they type. Each board entry shows:
- Videos collected, distinct creators, median outlier ratio, first and last seen dates
- The list of source videos, click-through to each

The "distinct creators" count is the number that matters and should be the biggest thing on the card.

**Filters:** min outlier ratio · only videos with commercial markers · last 7/30/90 days · min views.

**Export:** CSV (product, creators, videos, views, ratios, dates, links) and Markdown summary.

### Explicitly out of scope for V1

No account, no backend, no scraping service, no TikTok API. No sales, revenue or GMV estimates — we cannot see them and inventing them would be the fastest way to lose a seller's trust. No supplier or sourcing links (that's a different product with real legal surface). No automation of the account, no bulk collection of anything the user isn't watching. No price tracking.

## 5. Where the data comes from — read before committing

Only what TikTok renders for the user in the current tab, as they browse. The extension is a lens over the user's own session, not a crawler.

Consequences that shape the product:

- **Coverage is what the user scrolled.** A product board is built by browsing, not by querying. Say this in the UI (`from 42 videos you've viewed`) — the honest framing is also the defensible one.
- **The creator median needs the creator's profile.** Computing an outlier ratio in-feed requires a baseline the feed doesn't provide. Cache medians per creator when the user visits a profile, and show the ratio as pending until then rather than guessing.
- **Commercial markers are heuristics.** Shop links are reliable; caption patterns are not. Label the difference in the badge and never present a heuristic as a fact.

**Spike first, 1–2 days:** confirm view counts, creator identity and shop/product markers are readable from feed, search and hashtag pages, and measure how many videos a normal browsing session yields. If a session produces under ~50 usable videos, the board never reaches a useful "distinct creators" count and the product needs rethinking.

## 6. Non-functional requirements

| Requirement | Target |
| :-- | :-- |
| Badge appears on a feed video | < 300 ms after the tile renders; never blocks playback |
| Feed impact | Zero layout shift; no interference with TikTok's own scrolling |
| Permissions | `activeTab`, `storage`, `downloads` + `*://*.tiktok.com/*` |
| Board with 200 products / 2,000 videos | Panel opens < 600 ms |
| Privacy | No network requests |

## 7. Edge cases

- Videos from creators whose profile hasn't been visited (no baseline yet)
- Reposts and duplicate videos of the same product
- Creators who only ever post one product (baseline is meaningless — flag, don't hide)
- Non-shop affiliate flows (bio links, discount codes)
- Region-restricted or age-gated content
- The feed recycling tiles as the user scrolls (don't double-count)
- TikTok's frequent DOM churn — degrade to "couldn't read this video", never break the feed

## 8. Success metrics (30 / 90 day)

| Metric | 30d | 90d |
| :-- | :-- | :-- |
| Installs | 250 | 2,500 |
| 7-day retention | 30% | 40% |
| Users who track ≥ 1 product | 40% | 55% |
| Boards reaching ≥ 3 distinct creators | 25% | 40% |
| Export used ≥ once | 25% | 35% |
| Store rating | ≥ 4.2 | ≥ 4.4 |

The middle row is the real one: it's the only metric that says the core insight actually fires in normal use.

## 9. Kill criteria

Under 400 installs at 90 days, **or** under 20% of boards ever reaching three distinct creators. If repetition doesn't accumulate in real browsing, the product's premise is wrong and no amount of filters saves it.

## 10. Open questions

- **Grouping products is the hard part.** Shop-linked items group cleanly; everything else needs the user to name the thing. Is a manual name acceptable friction, or does that make the board a chore?
- **Is "before it floods" defensible?** Sellers will ask how early this is. The honest answer is "as early as your browsing" — check in reviews whether that lands or disappoints.
- **Seller expectations of revenue data.** Competing paid tools quote GMV estimates. We can't and won't. Confirm that positioning against the store listing before building — it decides whether this is a $0 tool with a niche or a wasted month.
