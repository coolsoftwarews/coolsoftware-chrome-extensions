# PRD — LinkedIn Engagement Lead Finder

**Status:** Draft for build
**Owner:** Gabriel
**Date:** 2026-08-15
**Type:** Chrome extension (MV3), standalone Web Store listing
**Platform:** LinkedIn
**Backend:** None · **Accounts:** None · **Payments:** None
**Pair:** [LinkedIn Creator Watchlist](PRD-10-linkedin-creator-watchlist.md) — that one tests content workflow, this one tests sales intelligence.

---

## 1. One-line proposition

The people commenting on posts in your market are already raising their hand — collect them, qualify them, and export the list.

## 2. The hypothesis

**Will sales people and founders pay for outreach intelligence?** This is the highest willingness-to-pay hypothesis in the portfolio: sales tools carry real budgets. The claim is narrow and testable — that *engagement on a relevant post* is a better prospect signal than a title filter, and that a local tool capturing it is worth having.

## 3. Target user

| Segment | Job |
| :-- | :-- |
| Founders selling B2B | Find people who just showed interest in the problem |
| SDRs / sales | Build a warm list without a Sales Navigator seat |
| Agencies | Source prospects from a competitor's audience |
| Recruiters | Find people engaging with a role-relevant topic |

## 4. Scope — V1

### The core insight

A title filter tells you who someone is. **Engagement tells you what they're thinking about this week.** Someone who commented thoughtfully on a post about the exact problem you solve is a better prospect than a matching job title who has never expressed the need.

### In scope

**Collect from a post.** On any post's comment thread, a control appears:

```
Collect commenters (34 visible)
```

Captures, per person, from the rendered thread only: name, headline, profile URL, their comment text, reaction count on the comment, the post it came from, and the date.

**Qualification, done locally**
- Keyword rules over headline and comment text (`founder`, `head of`, `hiring`, `looking for`) — user-defined, saved locally
- Rules mark a lead as ⭐ rather than filtering it out; the user always sees everything collected
- Manual status per lead: `new` / `shortlist` / `contacted` / `dismissed`, plus a note field

**Lead panel** (side panel)
- List with search, status filter, and grouping by source post
- Deduplication across posts, with a `seen on 3 posts` counter — repeat engagers are the strongest signal in the product, so surface that count prominently

**Export:** CSV (the deliverable — it goes into a CRM or a sequence tool) and Markdown.

**Data ownership:** export all / import / clear all; quota warning.

### Explicitly out of scope for V1 — and permanently

**No automation of any kind.** No auto-connect, auto-message, auto-like, auto-visit, no request the user didn't make by clicking. This is the line that keeps users' accounts alive and keeps the extension in the store. It is not a V2 feature; it is the product's boundary.

Also out: no account, no backend, no CRM sync, no email finding or enrichment (a different legal universe — see §5), no data purchased or joined from anywhere, no scraping of profiles the user hasn't opened, no bulk collection across posts the user isn't reading.

## 5. Legal and platform posture — read before committing

This is the riskiest PRD in the portfolio and deserves its own section.

- **Personal data.** Names, headlines and comments are personal data under GDPR/UK GDPR even though they're public. Because everything stays in the user's own browser and nothing is transmitted, the extension is a tool the user operates — but the listing and privacy policy must be explicit about what's stored, and "clear all data" must be one click.
- **No email/phone enrichment.** The moment we resolve a person to an email address, we are a data broker with a compliance burden and a very different store review. Not in V1, and not by integration either.
- **LinkedIn's terms.** Read-only, foreground-only, no faster than a human reading the thread. Any feature that would need volume is out by definition.
- **Users will ask for automation.** They will ask in reviews and in email. The answer is a documented no, with the reason (account bans). Write that answer once and reuse it.

**Spike first, 1 day:** confirm commenter name, headline, profile URL and comment text are readable from a rendered thread, and check what fraction of a thread is visible without repeatedly clicking "load more". If the answer is "10 of 200 comments", the value per action is low and the design needs rethinking.

## 6. Non-functional requirements

| Requirement | Target |
| :-- | :-- |
| Collect 50 commenters | < 1 s, no page interference |
| Panel with 2,000 leads | Opens < 600 ms; search < 150 ms |
| Permissions | `activeTab`, `storage`, `downloads` + `*://*.linkedin.com/*` |
| Privacy | No network requests; explicit in-product statement about what is stored |
| Safety | Zero write actions, enforced by having no such code path |

## 7. Edge cases

- "Load more comments" — collect only what's rendered, and say how many were skipped
- Deleted or anonymized commenters
- The same person commenting on multiple watched posts (merge, increment `seen on`)
- Company pages commenting rather than people
- Non-English headlines and comments in keyword rules
- Enormous threads (1,000+ comments) — cap per collection and report the cap
- LinkedIn DOM rewrites

## 8. Success metrics (30 / 90 day)

| Metric | 30d | 90d |
| :-- | :-- | :-- |
| Installs | 150 | 1,500 |
| 7-day retention | 30% | 40% |
| Users who collect from ≥ 2 posts | 45% | 60% |
| Users who export | 30% | 45% |
| Users who set a qualification rule | 20% | 30% |
| Store rating | ≥ 4.2 | ≥ 4.4 |

Export rate is the money metric here — a sales user who never exports never put the tool in their workflow.

## 9. Kill criteria

Under 250 installs at 90 days, **or** export used by under 20% of active users. Also an immediate kill, regardless of numbers: any credible report that using the extension contributed to an account restriction. Read-only makes that unlikely; it does not make it impossible, and this is a product where users' professional identity is at stake.

## 10. Open questions

- **Is CSV the whole product?** If everyone exports immediately and never opens the panel again, cut the panel and ship a one-click extractor. That's a *better* product, not a lesser one.
- **Where does the free tool stop being enough?** The honest paid surface (tracking a prospect over time, cross-post scoring) needs a server. If demand shows up, that's a separate product decision, not a bolt-on.
- **Reviews will demand enrichment.** Decide now, in writing, that the answer is no — otherwise it gets relitigated every month.
