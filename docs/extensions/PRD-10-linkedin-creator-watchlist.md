# PRD — LinkedIn Creator Watchlist

**Status:** Draft for build
**Owner:** Gabriel
**Date:** 2026-08-15
**Type:** Chrome extension (MV3), standalone Web Store listing
**Platform:** LinkedIn
**Backend:** None · **Accounts:** None · **Payments:** None
**Pair:** [LinkedIn Engagement Lead Finder](PRD-11-linkedin-lead-finder.md) — that one tests sales intelligence, this one tests content workflow.

---

## 1. One-line proposition

Keep a watchlist of the people worth learning from on LinkedIn, and see their best posts in one place instead of hoping the feed shows you.

## 2. The hypothesis

**Will founders and creators pay for a content workflow tool?** LinkedIn's feed is optimized for LinkedIn, not for the ten people you actually want to read. The claim is that a self-curated watchlist plus a "what did they post that worked" view is worth installing something for.

## 3. Target user

| Segment | Job |
| :-- | :-- |
| LinkedIn creators | Study the people ahead of them in their niche |
| Founders | Keep up with a dozen specific voices without the feed |
| Content marketers | Build a hook/format reference from B2B posts |
| Consultants | Watch what resonates in a client's industry |

## 4. Scope — V1

### In scope

**Add to watchlist.** A button on any profile and on any post author line:

```
+ Watch  ·  Watching ✓
```

**Watchlist panel** (side panel)
- The people being watched, with the posts collected from them so far
- Per post: text preview, reactions, comments, reposts, date, link, and an outlier badge (this post vs. that person's collected median)
- Sort by recency or by outlier ratio
- Filter to one person, or to `>2×` only
- Your note on a person ("good at carousels, weak hooks") and on a post

**Collection is browsing-driven.** Posts enter the watchlist when the user encounters them — in the feed, on a profile, in search. The panel states this plainly: `collected from 128 posts you've seen`. No background polling, no crawling, no notifications about things the user hasn't looked at.

**Export:** CSV (person, post, metrics, ratio, date, link, note) and Markdown (a readable digest, one section per person).

**Data ownership:** export all / import / clear all; quota warning at 80%.

### Explicitly out of scope for V1

No account, no backend, no LinkedIn API, no Sales Navigator anything. No automation whatsoever — no auto-follow, auto-like, auto-connect, auto-comment. (LinkedIn bans accounts for this, and shipping it would put users' professional identity at risk. It is out of scope permanently, not just for V1.) No notifications or email digests. No CRM. No scraping of profiles the user hasn't opened.

## 5. Where the data comes from — read before committing

**LinkedIn is the most hostile platform in this portfolio.** It actively fights automation and its DOM is deliberately unfriendly. Two rules that keep this shippable and keep users safe:

1. **Read-only, foreground-only.** The extension reads what's on the user's screen. It never issues a request LinkedIn didn't already make, and never acts as the user.
2. **No volume.** Nothing here is faster than reading. If a feature would only be useful at scale, it doesn't belong in this product.

The technical risk is ordinary DOM fragility; the *business* risk is being mistaken for an automation tool — by LinkedIn, by the Web Store reviewer, or by users who wanted one. The listing must be explicit that this tool does nothing on your behalf.

**Spike first, 1 day:** confirm post author, text, reaction/comment/repost counts and dates are readable in the feed and on profiles, and that a post can be identified stably enough to avoid duplicates when it reappears in the feed.

## 6. Non-functional requirements

| Requirement | Target |
| :-- | :-- |
| Watch button appears | < 300 ms after a post renders; no layout shift in the feed |
| Panel with 100 people / 3,000 posts | Opens < 600 ms |
| Permissions | `activeTab`, `storage`, `downloads` + `*://*.linkedin.com/*` |
| Privacy | No network requests. Especially important here — this is professional data |
| Safety | Zero write actions against LinkedIn, enforced by having no such code |

## 7. Edge cases

- The same post reappearing in the feed (dedupe by post URN)
- Reposts and quoted posts (attribute to the original author, mark as a repost)
- Posts whose counts change between sightings (keep the highest, record when)
- Documents/carousels and video posts with no text
- Non-English posts
- A watched person who goes quiet (say so: `no posts seen in 30 days`)
- Feed DOM rewrites — LinkedIn ships these often

## 8. Success metrics (30 / 90 day)

| Metric | 30d | 90d |
| :-- | :-- | :-- |
| Installs | 150 | 1,500 |
| 7-day retention | 30% | 40% |
| Users watching ≥ 3 people | 40% | 55% |
| Panel opened ≥ 3 times | 35% | 45% |
| Export used ≥ once | 15% | 25% |
| Store rating | ≥ 4.2 | ≥ 4.4 |

## 9. Kill criteria

Under 250 installs at 90 days, **or** fewer than 25% of installs watching three people. LinkedIn's audience is small but wealthy — low installs alone aren't fatal if retention is high. Flat retention *is* fatal.

## 10. Open questions

- **Is browsing-driven collection enough?** If a user watches 10 people but the feed shows them 2, the panel stays thin. Test whether "open their profile to refresh" is acceptable, or whether the product needs to steer users to profiles.
- **Does the outlier badge belong here at all?** It's cheap (the engine exists) but this is a workflow product; a metric may dilute the proposition. Consider it a V1.1 toggle.
- **Watchlist vs. lead list.** The moment users start watching prospects rather than creators, this has become its pair. Watch for it — it's a signal about which hypothesis is really live.
