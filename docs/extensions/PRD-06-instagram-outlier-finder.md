# PRD — Instagram Content Outlier Finder

**Status:** Draft for build
**Owner:** Gabriel
**Date:** 2026-08-15
**Type:** Chrome extension (MV3), standalone Web Store listing
**Platform:** Instagram
**Backend:** None · **Accounts:** None · **Payments:** None
**Pair:** [Instagram Creator Research Saver](PRD-07-instagram-research-saver.md) — that one tests workflow, this one tests intelligence.

---

## 1. One-line proposition

Find the posts that massively outperform an account's normal content — and see, in one glance, by how much.

## 2. The hypothesis

**Will marketers pay for intelligence?** Not "can we sort a feed" — anyone can sort a feed. The claim is that a *relative* number (this post vs. this account's own median) answers a question a marketer actually has, and that seeing it changes what they make next.

If this converts and its pair doesn't, the portfolio's lesson is: build outlier/intelligence tools, not workflow tools. That lesson is worth more than either extension.

## 3. Target user

| Segment | Job |
| :-- | :-- |
| Creators | "Which of my ideas worked unusually well, and why?" |
| Content marketers | Find proven angles in a niche before scripting |
| Agencies | Competitive teardown in ten minutes, not an afternoon |
| Social strategists | Evidence for a content recommendation |

## 4. Scope — V1

### The core insight

Absolute view counts are noise across accounts of different sizes. The signal is the **outlier ratio**: this post's views ÷ the account's recent median. A 157K-view Reel on an account whose median is 18K is an 8.7× outlier — that is a finding. A 2M-view post from an account that always does 2M is not.

### In scope

**Profile overlay.** On an Instagram profile, compute the median from the loaded grid and label each post:

```
Recent median: 18K views

🔥 8.7×   157K
🔥 5.1×    92K
↑  2.4×    43K
—  0.9×    16K
```

- Badge on each grid tile: multiplier + raw number
- Header strip: median, post count sampled, date range covered
- Bands: `🔥 ≥5×`, `🔥 ≥2×`, `↑ ≥1.5×`, `— under`

**Filters** (a single row, no settings page)
- Show only >2× / >5×
- Reels / Posts
- Last 30 / 90 days / all loaded

**Sort** the grid by outlier ratio, views, or date.

**Export** the visible set as CSV or Markdown: URL, type, date, views, likes, comments, ratio. Download only — nothing is uploaded.

**Local state:** the last-used filter, and a small cache of computed medians per profile so revisiting a profile is instant. That's the whole storage story.

### Explicitly out of scope for V1

No account, no login-with-Instagram, no backend, no API keys. No historical tracking of an account over time (that needs a server). No cross-account comparison dashboard. No AI summarization of what made a post work. No posting, DMing, following or any write action against Instagram — read-only, always. No bulk crawling of profiles the user isn't looking at.

## 5. Where the data comes from — read before committing

The extension reads only what Instagram has already rendered for the logged-in user in the current tab: the grid's post nodes and the JSON Instagram embeds alongside them. **No separate API calls, no background crawling, no automation of the account.** That boundary is both the legal position and the Web Store review position, and it is not negotiable for a cheap experiment.

Two known problems, in order of severity:

1. **View counts are not always exposed.** Reels usually show plays; static posts often show only likes. Where views are missing, fall back to a like-based ratio and **say so in the badge** (`8.7× likes`), rather than silently mixing two different denominators.
2. **The grid is lazy-loaded.** The median is computed from what's loaded, so it moves as the user scrolls. Show the sample size next to it (`median of 24 loaded posts`) and recompute on scroll. Never present a median from 6 posts as if it were the account's baseline — below ~12 posts, show the number greyed out with "keep scrolling for a reliable median".

**Spike first, 1 day:** confirm that view/like counts and post dates are reliably readable from a profile grid, on both a personal and a business account, logged in and logged out. If counts are not readable, the product doesn't exist and the day is well spent.

## 6. Non-functional requirements

| Requirement | Target |
| :-- | :-- |
| Badges visible after profile load | < 400 ms, no layout shift in the grid |
| Recompute on scroll | Debounced, no visible jank at 200+ tiles |
| Permissions | `activeTab`, `storage`, `downloads` + `*://*.instagram.com/*`. Nothing broader |
| Privacy | No network requests. Verifiable in devtools |
| Failure mode | If the DOM changes and parsing fails: one quiet in-page notice, never a broken grid |

## 7. Edge cases

- Private accounts, and profiles the user doesn't follow
- Accounts with fewer than 12 visible posts
- Pinned posts (old, high-count posts distorting a "recent" median — exclude pins from the median, badge them normally)
- Mixed Reels/carousels/statics where only some expose views
- A viral outlier so large it compresses every other badge (cap the display at `20×+`)
- Logged-out browsing, and the login wall appearing mid-scroll
- Instagram's periodic DOM rewrites — the failure must be legible, not silent

## 8. Success metrics (30 / 90 day)

| Metric | 30d | 90d |
| :-- | :-- | :-- |
| Installs | 200 | 2,000 |
| 7-day retention | 25% | 35% |
| Users who open ≥ 3 profiles | 50% | 60% |
| Users who use a filter or sort | 35% | 50% |
| Export used ≥ once | 20% | 30% |
| Store rating | ≥ 4.2 | ≥ 4.4 |

Local counters only: profiles analysed, filter used, sort used, export used, parse-failure count. The parse-failure counter is the health metric — Instagram will change its DOM, and this tells us before the reviews do.

## 9. Kill criteria

Under 300 installs at 90 days with real distribution effort, **or** parse-failure rate above 10% of profile loads that we can't fix inside a week. A tool that shows wrong numbers on a marketer's competitor is worse than no tool.

## 10. Open questions

- **Likes-based fallback.** Is a like-ratio outlier useful enough to ship, or does mixing denominators cost more trust than it buys coverage?
- **Median vs. trimmed mean.** Median is honest and simple; a trimmed mean may read better on accounts with one runaway post. Decide with real profiles, not in the abstract.
- **Naming.** "Outlier" is insider vocabulary. Test it against "breakout posts" in the store listing — the listing is the product for the first 30 seconds.
