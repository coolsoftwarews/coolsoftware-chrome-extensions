# PRD — YouTube Pro Filters

**Status:** Draft for build
**Build order:** #3
**Owner:** Gabriel
**Date:** 2026-08-15
**Type:** Chrome extension (MV3), standalone Web Store listing
**Backend:** None in V1
**Accounts:** None in V1

**Reference product:** [Youtube Filter Pro](https://chromewebstore.google.com/detail/youtube-filter-pro-filter/dbkkcbfafkckhmefkpgnelikibobcabb)

---

## 1. One-line proposition

Find the YouTube videos worth studying — filter search results by views/day, channel size and outlier score, not just relevance.

## 2. Why this one third

It has the strongest creator/marketer → willingness-to-pay relationship of the four, so it deserves the most thought — but it is also the only one of the four with real build risk (see §7). Ship the two easier experiments first, then come to this with a clear head. Estimated build: 1.5–2.5 weeks.

The thesis: **don't build vidIQ.** Build the 10% of vidIQ that someone understands and uses in the first 30 seconds, in-page, with no signup.

## 3. Target user

| Segment | Job |
| :-- | :-- |
| Creators | "What's breaking out in my niche right now?" |
| Content marketers | Find proven angles before scripting |
| Agencies / strategists | Competitive research without a $50/mo seat |
| Researchers | Filter noise out of a topic search |

Narrow, high-intent, already pays for tools in this category.

## 4. Scope — V1

### The core insight to build around

Views alone are a vanity number. The signals that matter are **velocity** (views/day) and **outlier ratio** (this video's views ÷ that channel's median views). A 40K-view video from a 3K-subscriber channel published 5 days ago is far more instructive than a 2M-view video from MrBeast.

### In scope

**Filter bar injected into YouTube search results**

| Filter | Control |
| :-- | :-- |
| Published date | Presets (24h / 7d / 30d / 90d / 1y) + custom range |
| Views | Min / max |
| Views per day | Min / max |
| Channel size (subscribers) | Min / max |
| Duration | Min / max minutes |

**Sorting**
- Views/day (velocity) — the differentiator
- Views
- Publish date
- Outlier ratio (if channel median is resolvable — see §7)

**Per-result badges** overlaid on each search result thumbnail/row:
- `2.4K/day`
- `🔥 4.2×` when views are a multiple of the channel's typical performance

**Presets** — saved filter combinations, stored locally. Ship 2–3 built-in ones:
- *Breakout* — last 30d, channel < 50K, views > 100K
- *Fresh velocity* — last 7d, views/day > 2K
- *Evergreen* — older than 1y, views/day > 500

**Filter state persists** across searches within a session; a visible `Clear` resets it.

### Explicitly out of scope for V1

Channel-page analysis, watch-page video intelligence panel, channel watching/alerts, historical tracking, keyword/SEO tools, thumbnail analysis, exports, accounts, backend, subscription. Every one of those is a V2 candidate — none of them ship in V1.

## 5. Non-functional requirements

| Requirement | Target |
| :-- | :-- |
| Filter applied → results updated | < 300 ms for already-loaded results |
| Enrichment (channel size, exact views) per result | < 1.5 s, progressive — never block the page |
| Permissions | `storage`, host permission for `*://*.youtube.com/*` only |
| Degradation | If enrichment fails, the extension still filters on what YouTube's own DOM provides (date, views, duration). Never break YouTube search. |
| Zero-config | Works on install. No API key, no signup, no onboarding flow. |

## 6. Edge cases to handle

- Infinite scroll: filters must apply to newly loaded results automatically
- SPA navigation: re-bind on `yt-navigate-finish`
- Approximate view counts in the DOM ("1.2M views") → parse to a number, accept the precision loss or enrich
- Shorts mixed into results → filter them separately or exclude by duration
- Live / upcoming videos → no meaningful views/day; exclude from velocity sorting
- Very new videos (< 24h) → views/day is noisy; floor the divisor at 1 day
- YouTube A/B tests different search DOM layouts → selector layer must be isolated and fail soft
- "No results match your filters" → explicit empty state with a one-click loosen

## 7. Technical risk — read before committing

The filter UI is easy. **Getting subscriber count and precise view count per search result is the hard part**, and it determines whether this product is good or mediocre. Options:

| Approach | Cost | Risk |
| :-- | :-- | :-- |
| Parse what's in the search DOM | Free, instant | Approximate views; no subscriber count at all |
| Scrape each channel page in the background | Free | Slow, rate-limit sensitive, fragile |
| YouTube Data API v3 with the user's own key | Free-ish | Kills zero-config; quota ceilings |
| YouTube Data API v3 with our key via a thin proxy | Requires a backend | Quota cost scales with users; breaks "no backend" |

**Recommendation:** spend the first two days on a spike proving how far DOM parsing + opportunistic background enrichment gets us, with an in-memory + `storage` cache keyed by channel ID so a channel is fetched once per session. Only if that spike fails do we reconsider a backend — and if a backend is required, that is the signal this should be a paid product from day one, not a free one.

Do not start UI work before the spike answers this.

## 8. Success metrics (30 / 90 day)

| Metric | 30d checkpoint | 90d "keep investing" bar |
| :-- | :-- | :-- |
| Installs | 150 | 1,500 |
| 7-day retention | 30% | 40% |
| Searches with a filter applied | 40% | 55% |
| Preset usage | 15% of users | 30% of users |
| Store rating | ≥ 4.2 | ≥ 4.5 |

Retention matters more here than installs. A creator who uses this weekly is worth 100 drive-by installs.

**Instrumented events (local only):** filter applied by type, sort changed, preset used, results-after-filter count, enrichment failure rate.

## 9. Monetization posture

The most likely paid product of the four. Plausible Pro tier ($5–9/mo) *if* retention holds:
- Channel watching + breakout alerts
- Historical tracking of a niche
- Export to CSV
- Unlimited saved presets

Do not build any of it before V1 retention data exists.

## 10. Kill criteria

Under 300 installs **or** under 20% 7-day retention at 90 days → stop. This one is only worth continuing if the people who install it keep using it.

## 11. Open questions

- Does the outlier ratio survive the enrichment constraint? If we can't get channel medians cheaply, the 🔥 badge is cut and views/day carries the product alone.
- Should filters also apply on the homepage and subscription feed, or search only? **Search only for V1** — it keeps the surface small and the value clear.
