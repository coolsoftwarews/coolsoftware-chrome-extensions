# PRD — Reddit Opportunity Monitor

**Status:** Draft for build
**Owner:** Gabriel
**Date:** 2026-08-15
**Type:** Chrome extension (MV3), standalone Web Store listing
**Platform:** Reddit
**Backend:** None · **Accounts:** None · **Payments:** None
**Pair:** [Reddit Voice-of-Customer Saver](PRD-23-reddit-voice-of-customer.md) — that one tests research workflow, this one tests lead/market intelligence.

---

## 1. One-line proposition

Highlight the threads where someone is asking for a tool, a service or a recommendation in your space — in the subreddits you already read.

## 2. The hypothesis

**Will founders and marketers pay for opportunity intelligence?** Reddit is where people state problems in plain language and ask for solutions. The claim is that a rule-based lens over subreddits the user already browses turns a distraction into a channel — same shape as the [Facebook Group](PRD-15-facebook-group-opportunities.md) product, different culture and a very different tolerance for self-promotion.

## 3. Target user

| Segment | Job |
| :-- | :-- |
| SaaS founders | Find people describing the problem their product solves |
| Freelancers / agencies | Catch "can anyone recommend a…" threads |
| Marketers | Track how a market talks about a category |
| Indie hackers | Validate a problem before building |

## 4. Scope — V1

### In scope

**Rules,** stored locally, two-part like the Facebook pair:

```
Intent:  "looking for"  ·  "recommend"  ·  "any alternative to"  ·  "how do you handle"
Topic:   "invoicing"  ·  "time tracking"  ·  "freelance"
Ignore:  "free only"
```

**In-feed marking.** Matching posts in a subreddit or the home feed get a chip:

```
💡 "looking for" + "invoicing"  ·  r/freelance  ·  34 comments
```

**Opportunity panel** (side panel)
- Matched threads collected as the user browses: subreddit, title, snippet, score, comment count, age, link
- Status: `new` / `replied` / `dismissed`; note per item
- Rule hit counts — `"invoicing" matched 11 times in 30 days` is the market signal, more useful than any single thread
- Filter by subreddit, rule, or status

**Subreddit read.** For the current subreddit, a small summary from what's loaded: post volume, median score, the most common intent phrases. Enough to judge whether a community is worth being in.

**Export:** CSV/Markdown.

**Data ownership:** export all / import / clear all.

### Explicitly out of scope for V1

**No automation and no posting.** No auto-comment, no auto-DM, no vote manipulation, no account actions of any kind. Reddit's culture punishes self-promotion harder than its rules do, and a tool that automates it would deserve the reception it got.

Also out: no account, no backend, no Reddit API (see §5), no background polling or alerts, no scanning of subreddits the user isn't reading, no sentiment AI, no karma/user profiling.

## 5. Where the data comes from — read before committing

Only what Reddit renders in the user's tab as they browse. **No Reddit API** — the API is licensed, rate-limited and would require keys, an account and a business relationship, all of which break the portfolio's rules.

Two Reddit-specific realities:

1. **Two front-ends.** `www.reddit.com` (current), plus `old.reddit.com`, which a large share of the target audience still uses. Supporting old.reddit is comparatively easy (stable, simple HTML) and buys credibility with exactly the power users this tool targets. Decide before building — the shipped answer should probably be both.
2. **Users will ask for alerts.** Alerts mean background polling, which means the API or crawling. The answer is a panel and a habit, and the listing must not imply monitoring despite the product's name. *(Name check: "Monitor" over-promises. See §10.)*

**Spike first, 1 day:** confirm post title, body snippet, subreddit, score, comment count and age are readable on both front-ends, and that posts dedupe reliably across feed and subreddit views.

## 6. Non-functional requirements

| Requirement | Target |
| :-- | :-- |
| Chip applied | < 250 ms after a post renders; no layout shift |
| Rule evaluation | < 5 ms per post at 50 rules |
| Panel with 2,000 items | Opens < 600 ms |
| Permissions | `activeTab`, `storage`, `downloads` + `*://*.reddit.com/*` |
| Privacy | No network requests |

## 7. Edge cases

- Old vs. new Reddit layouts (and new Reddit's periodic redesigns)
- The same post seen in the home feed and its subreddit (dedupe by post id)
- Crossposts
- Deleted or removed posts after capture (the saved copy stands)
- NSFW/quarantined subreddits — capture nothing special, just don't break
- Comment-level opportunities (V1 reads posts only — say so)
- Very high-volume subreddits (cap per session, report the cap)
- Non-English subreddits

## 8. Success metrics (30 / 90 day)

| Metric | 30d | 90d |
| :-- | :-- | :-- |
| Installs | 200 | 2,000 |
| 7-day retention | 30% | 40% |
| Users who create ≥ 1 rule | 55% | 70% |
| Users with ≥ 1 match | 45% | 60% |
| Users who mark an item `replied` | 15% | 25% |
| Export used ≥ once | 15% | 25% |
| Store rating | ≥ 4.2 | ≥ 4.4 |

## 9. Kill criteria

Under 300 installs at 90 days, **or** under 30% of users ever seeing a match. Also worth an early stop if reviews indicate people are using it to spam communities — that outcome damages the whole portfolio's reputation, and no install count offsets it.

## 10. Open questions

- **The name over-promises.** "Monitor" implies background watching we deliberately don't do. Prefer something like *Reddit Opportunity Lens* or *Reddit Signal* before the listing is written — a name that promises monitoring earns one-star reviews from people who wanted monitoring.
- **Starter rule packs.** Same lesson as the Facebook pair: a blank rule box is where retention dies. Ship packs per profession.
- **Comments are where the gold is.** Reading comment threads doubles the value and the DOM surface. V1.1, gated on demand.
