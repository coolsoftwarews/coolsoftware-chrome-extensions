# PRD — Facebook Group Opportunity Finder

**Status:** Draft for build
**Owner:** Gabriel
**Date:** 2026-08-15
**Type:** Chrome extension (MV3), standalone Web Store listing
**Platform:** Facebook Groups
**Backend:** None · **Accounts:** None · **Payments:** None
**Pair:** [Meta Ad Winner](PRD-14-facebook-ad-winner.md) — that one tests advertising intelligence, this one tests lead generation.

---

## 1. One-line proposition

In the groups you're already in, catch the posts where someone is asking for exactly what you sell.

## 2. The hypothesis

**Will founders and service sellers pay for lead generation?** Facebook groups are full of "can anyone recommend…" posts that convert — and impossible to catch reliably, because the feed is chronological chaos. The claim is that a keyword lens over groups the user has already joined turns a time sink into a channel.

## 3. Target user

| Segment | Job |
| :-- | :-- |
| Service businesses / freelancers | Find "looking for a…" posts in their niche |
| Agencies | Source inbound-shaped leads without cold outreach |
| Founders | Hear the problem stated in customers' own words |
| Community managers | Spot the questions worth answering |

## 4. Scope — V1

### In scope

**Opportunity rules.** User-defined, stored locally:

```
Match:  "looking for"  ·  "can anyone recommend"  ·  "does anyone know"
Topic:  "bookkeeper"  ·  "accountant"  ·  "invoicing"
Ignore: "free"  ·  "intern"
```

A post matches when it hits a **match phrase and a topic word** — the two-part rule is what keeps the noise down, and it should be the default the product teaches on first run.

**In-feed highlighting.** Matching posts in a group feed get a marker and a reason chip:

```
💡 opportunity — "looking for" + "bookkeeper"
```

**Opportunity panel** (side panel)
- Matched posts collected as the user browses: group name, author, post text, date, comment count, link
- Status per item: `new` / `replied` / `dismissed`, plus a note
- Search and filter by group or rule
- `seen 3 similar posts this week` counts per rule — the number that tells someone whether a niche is live

**Export:** CSV and Markdown.

**Data ownership:** export all / import / clear all; quota warning.

### Explicitly out of scope for V1 — and permanently

**No automation, no posting, no commenting, no DMs, no joining groups, no background scanning of groups the user isn't reading.** Facebook bans accounts for automation and the store rejects tools that provide it. The extension is a lens over the user's own browsing, nothing more.

Also out: no account, no backend, no Graph API, no notifications or alerts (they'd require background polling — which is exactly the line we won't cross), no scraping of member lists, no contact extraction, no scanning of groups the user hasn't joined.

## 5. Where the data comes from — read before committing

Only what Facebook renders in the user's tab, in groups they're already a member of, as they scroll. That constraint defines the product's honest promise: **it finds opportunities in what you read, not in what you don't.**

The uncomfortable consequence: users will expect alerts. Alerts require background scanning; background scanning is automation; automation risks their account and our listing. So the product's answer is a good panel plus a habit ("open the panel when you open Facebook"), and the listing must not imply monitoring.

Two other realities:
- **Group content is private-ish.** Members-only posts are personal data and often sensitive. Everything stays local, and the privacy policy must say so in plain words. `Clear all data` is one click.
- **Facebook's DOM is hostile and obfuscated.** Expect breakage. Budget maintenance, and degrade to "highlighting unavailable" rather than mangling someone's feed.

**Spike first, 1–2 days:** confirm post text, author, date and group name are readable in a group feed, and that posts can be identified stably enough to dedupe on re-scroll. This is the second-hardest DOM in the portfolio after LinkedIn.

## 6. Non-functional requirements

| Requirement | Target |
| :-- | :-- |
| Highlight applied | < 300 ms after a post renders; no layout shift |
| Rule evaluation | < 5 ms per post at 50 rules |
| Panel with 1,000 items | Opens < 600 ms |
| Permissions | `activeTab`, `storage`, `downloads` + `*://*.facebook.com/*` |
| Privacy | No network requests; explicit statement about group content staying local |

## 7. Edge cases

- The same post reappearing in the feed (dedupe)
- Posts edited after capture
- Comment threads containing the real opportunity (V1 reads the post only — say so)
- Non-English groups (rules are literal strings; support them without pretending to do NLP)
- Very long posts (store in full, truncate the card)
- Anonymous-member posts, common in support groups — capture the text, not an identity that doesn't exist
- Groups with 100+ posts a day (cap collection per session, report the cap)
- Facebook DOM rewrites

## 8. Success metrics (30 / 90 day)

| Metric | 30d | 90d |
| :-- | :-- | :-- |
| Installs | 200 | 2,000 |
| 7-day retention | 30% | 40% |
| Users who create ≥ 1 rule | 55% | 70% |
| Users with ≥ 1 matched post | 40% | 55% |
| Users who mark an item `replied` | 15% | 25% |
| Export used ≥ once | 15% | 25% |
| Store rating | ≥ 4.1 | ≥ 4.3 |

`Replied` is the closest thing to a revenue signal available without a backend. Watch it above installs.

## 9. Kill criteria

Under 300 installs at 90 days, **or** under 30% of users ever seeing a matched post. The latter means either the rules are too hard to write or the groups people are in don't contain the opportunities — and the first is fixable, the second isn't.

## 10. Open questions

- **Rule authoring is the whole onboarding.** If someone has to invent good keywords from a blank box, most won't. Ship starter rule packs by profession (agency, bookkeeper, developer, photographer) and measure which get used.
- **How badly do people want alerts?** If reviews consistently ask for monitoring, that's a real product — with a server, a different privacy posture, and a paid tier. That would be a separate decision, not a V2 patch.
- **Comments.** The opportunity is often in a reply, not the post. Reading comment threads multiplies both the value and the DOM surface. V1.1 candidate, gated on how often users say so.
