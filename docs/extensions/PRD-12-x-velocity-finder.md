# PRD — X Velocity Finder

**Status:** Draft for build — **gated on §5**
**Owner:** Gabriel
**Date:** 2026-08-15
**Type:** Chrome extension (MV3), standalone Web Store listing
**Platform:** X (Twitter)
**Backend:** None · **Accounts:** None · **Payments:** None
**Pair:** [X Prospect & Conversation Saver](PRD-13-x-conversation-saver.md) — that one tests workflow, this one tests intelligence.

---

## 1. One-line proposition

See which posts are actually taking off right now — engagement per hour since posting, not raw totals.

## 2. The hypothesis

**Does velocity beat volume as a discovery signal?** A post with 400 likes in 40 minutes is a live event; the same 400 likes over three days is history. X shows you totals. The claim is that showing the rate — and the ratio against the author's own baseline — changes what people find.

## 3. Target user

| Segment | Job |
| :-- | :-- |
| Creators | Spot a live conversation early enough to add to it |
| Founders | Catch a thread about their market while it's moving |
| Marketers | Find the format and hook that's working this week |
| Journalists / researchers | Distinguish a breaking thread from an old one resurfacing |

## 4. Scope — V1

### In scope

**Velocity badge** on every post in the timeline, search results and profiles:

```
⚡ 620/h · 3.4× · 2h old
```

- Engagement per hour since posting (likes + reposts + replies, weighted equally and stated plainly)
- Outlier ratio against the author's recent median, when a baseline is available
- Age

**Timeline filter bar** (injected once, at the top)
- Minimum velocity
- Minimum outlier ratio
- Age band (< 1h / < 6h / < 24h)
- Hide posts below the bar, or dim them — user's choice, because hiding things in someone's timeline is a strong move

**Sort a search result** by velocity — X's own "Top" is a black box; this is a legible alternative.

**Export:** CSV/Markdown of the filtered set (author, text, metrics, velocity, ratio, age, link).

**Local state:** author medians, filter settings. Nothing else.

### Explicitly out of scope for V1

No account, no backend, no X API (see §5 — this is the whole gate). No posting, liking, following or any write action. No DM anything. No tracking a post over time in the background. No sentiment or AI analysis. No follower-quality scoring.

## 5. The gate — X API and platform posture

**This PRD is marked 🟡 in the portfolio for a reason, and the gate is commercial, not technical.**

X has been the most aggressive platform about third-party access: the API is expensive and restrictive, and the web app is engineered against extraction. This product reads only the rendered timeline — no API, no key, no cost — but that leaves three open risks that must be checked *before* a line of code:

1. **Does the rendered timeline expose reliable counts and timestamps?** If counts are abbreviated (`1.2K`) with no precise value, velocity is coarse. Coarse may still be fine — decide deliberately.
2. **How stable is the DOM?** X ships changes constantly with no deprecation courtesy. Estimate the maintenance tax honestly; a tool that breaks monthly earns one-star reviews faster than installs.
3. **Store and platform tolerance.** Check for recent takedowns of similar extensions.

**Spike first, 2 days, and treat it as a go/no-go:** read counts, timestamps and author identity from timeline, search and profile; measure how often a normal session yields a usable author baseline. If the spike is ugly, **build the pair first** and leave X with one product rather than a broken two.

## 6. Non-functional requirements

| Requirement | Target |
| :-- | :-- |
| Badge appears | < 250 ms after a post renders; no layout shift in the timeline |
| Filtering 500 timeline posts | No visible jank while scrolling |
| Permissions | `activeTab`, `storage`, `downloads` + `*://*.x.com/*`, `*://*.twitter.com/*` |
| Privacy | No network requests |
| Resilience | A parse failure disables badges quietly; the timeline must never break |

## 7. Edge cases

- Abbreviated counts (`1.2K`) — round-trip them honestly, show `~`
- Posts with no visible timestamp (relative-only)
- Reposts and quote posts (attribute to the original, badge the quote separately)
- Threads (badge the head post; don't clutter every reply)
- Ads and promoted posts (skip)
- Authors with no baseline yet
- Very new posts (< 5 min) where velocity is statistically meaningless — show `too new` rather than a wild number
- Timeline virtualization recycling nodes

## 8. Success metrics (30 / 90 day)

| Metric | 30d | 90d |
| :-- | :-- | :-- |
| Installs | 200 | 2,000 |
| 7-day retention | 25% | 35% |
| Users who set a filter | 35% | 50% |
| Users who sort a search by velocity | 25% | 35% |
| Export used ≥ once | 15% | 25% |
| Store rating | ≥ 4.0 | ≥ 4.3 |

Rating expectations are deliberately lower here: DOM breakage on X will cost stars in a way it won't on calmer platforms.

## 9. Kill criteria

Under 300 installs at 90 days, **or** more than two breakages requiring an emergency fix in a 90-day window. The second criterion is unusual and intentional — maintenance cost is the real risk on this platform, and a tool that eats a day a month must earn a lot to justify it.

## 10. Open questions

- **Which engagement counts?** Likes-only is stable and legible; a composite is more accurate and more arguable. Pick one, state the formula in the UI, don't hide it.
- **Hide or dim?** Hiding posts from someone's timeline is powerful and slightly alarming. Default to dim, offer hide.
- **Is one X product enough?** If the spike comes back rough, ship only the pair. Coverage of the platform matters more than symmetry of the portfolio.
