# PRD — TikTok Creator Outlier Finder

**Status:** Draft for build
**Owner:** Gabriel
**Date:** 2026-08-15
**Type:** Chrome extension (MV3), standalone Web Store listing
**Platform:** TikTok
**Backend:** None · **Accounts:** None · **Payments:** None
**Pair:** [TikTok Product Scout](PRD-08-tiktok-product-scout.md) — that one tests commercial intelligence, this one tests content intelligence.

---

## 1. One-line proposition

Open any TikTok profile and see instantly which videos broke out — and what their hooks had in common.

## 2. The hypothesis

**Will creators pay for content intelligence?** Same engine as [Instagram Content Outlier Finder](PRD-06-instagram-outlier-finder.md), different platform and a different buyer's wallet. Running the same idea on two platforms is deliberate: if it wins on one and dies on the other, the lesson is about the platform's audience, not about the idea.

## 3. Target user

| Segment | Job |
| :-- | :-- |
| Creators | "Which of my videos actually broke out, and what did they share?" |
| Content marketers | Reverse-engineer a competitor's best-performing hooks |
| Agencies | Build a scripting brief from evidence rather than taste |
| Researchers / analysts | Sample what works in a niche |

## 4. Scope — V1

### In scope

**Profile overlay.** On a creator profile, compute the median views of loaded videos and badge each tile:

```
Median: 24K views  (of 36 loaded)

🔥 11.4×  274K
🔥  4.8×  115K
↑   1.9×   46K
—   0.7×   17K
```

**Hook panel** — the differentiator over a plain sorter. For the outliers on screen, extract and list what they have in common:
- First line of the caption (the written hook)
- Hashtags shared across outliers but rare in the baseline
- Video length band (e.g. "outliers here are 8–15s; the baseline is 30s+")
- Posting hour/day distribution, if dates are readable

Present it as observations with counts, never as advice. `7 of 9 outliers open with a question` is useful and true; "post more questions" is neither.

**Filters and sort:** >2× / >5× · last 30/90 days · length band · sort by ratio, views or date.

**Export:** CSV and Markdown of the filtered set, including the hook column — this is what gets pasted into a scripting doc, so it's the export that matters.

**Local state:** cached medians per creator, last-used filter. Nothing else.

### Explicitly out of scope for V1

No account, no backend, no API. No tracking a creator over time (needs a server). No AI script generation or "why this worked" summaries — the moment we generate advice, a wrong call costs the user real work. No download of videos. No write actions on TikTok. No follower/demographic estimates we can't see.

## 5. Where the data comes from

Only the profile grid TikTok renders for the user. View counts are reliably shown on TikTok profiles — that's why this platform gets the outlier product first and Instagram's version carries a likes-based fallback.

Two things to design around:

1. **Lazy loading.** The median moves as the user scrolls. Always show the sample size, and grey the median under ~12 videos.
2. **Pinned videos.** Creators pin their best work. Exclude pins from the median or every account looks flat.

**Spike first, half a day:** confirm view counts, durations, captions and dates are readable from a profile grid without opening each video. If duration and caption require opening each video, the hook panel becomes a click-per-video chore and must be redesigned as an on-demand action.

## 6. Non-functional requirements

| Requirement | Target |
| :-- | :-- |
| Badges after profile load | < 400 ms, no layout shift |
| Hook panel recompute | < 200 ms for 100 videos |
| Permissions | `activeTab`, `storage`, `downloads` + `*://*.tiktok.com/*` |
| Privacy | No network requests |
| Failure | Parse failure shows one quiet notice; the profile page is never broken |

## 7. Edge cases

- Profiles with fewer than 12 videos
- One-hit accounts where a single video is 50× the median (cap the badge at `20×+`)
- Private accounts, age-gated profiles, region blocks
- Captions in mixed languages (hook extraction must not assume English; count patterns, don't parse grammar)
- Videos with no caption at all
- Slideshow/photo posts alongside videos
- TikTok DOM rewrites

## 8. Success metrics (30 / 90 day)

| Metric | 30d | 90d |
| :-- | :-- | :-- |
| Installs | 250 | 2,500 |
| 7-day retention | 25% | 35% |
| Users who analyse ≥ 3 profiles | 50% | 60% |
| Hook panel opened | 40% | 50% |
| Export used ≥ once | 25% | 35% |
| Store rating | ≥ 4.2 | ≥ 4.5 |

Hook-panel usage is the metric that separates this from a sorter. If people badge profiles but never open the panel, the product is a commodity and should be cut regardless of installs.

## 9. Kill criteria

Under 400 installs at 90 days, **or** hook panel opened by under 25% of active users at 90 days. The second means we built a sorter with extra steps.

## 10. Open questions

- **How much of the hook panel is real?** Pattern-counting across 10 videos is thin evidence. Decide a minimum sample (probably 8 outliers) below which the panel says "not enough data" instead of showing noise.
- **Shared engine with the Instagram pair.** The median/badge/export layer should be one module used by both. Confirm that before building the second one, or we'll pay for it twice.
- **Creators vs. marketers.** Creators are numerous and broke; marketers are fewer and pay. The listing can only speak to one of them — pick before writing it.
