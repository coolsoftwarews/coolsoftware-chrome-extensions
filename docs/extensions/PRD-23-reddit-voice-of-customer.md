# PRD — Reddit Voice-of-Customer Saver

**Status:** Draft for build
**Owner:** Gabriel
**Date:** 2026-08-15
**Type:** Chrome extension (MV3), standalone Web Store listing
**Platform:** Reddit
**Backend:** None · **Accounts:** None · **Payments:** None
**Pair:** [Reddit Opportunity Monitor](PRD-22-reddit-opportunity-monitor.md) — that one tests lead intelligence, this one tests research workflow.

---

## 1. One-line proposition

Save the exact sentences where customers describe their problem — with the thread, the subreddit and your note — and export them as the raw material for your copy.

## 2. The hypothesis

**Will founders and marketers pay for a research workflow?** Voice-of-customer research is a recognised, valuable job: the phrases people use about their problem become the landing page, the ad and the onboarding copy. Today it's done with a spreadsheet and copy-paste. The claim is that capture-in-place beats the spreadsheet.

Note the shape: this is the same product family as the [Web Highlighter](PRD-05-web-highlighter-markdown.md) — select text, save it with context, export Markdown — aimed at one platform and one job. If it wins where the general highlighter doesn't, the lesson is that **specific beats general**, which would redirect the whole portfolio.

## 3. Target user

| Segment | Job |
| :-- | :-- |
| SaaS founders | Collect the words customers use for the problem |
| Copywriters | Source landing page copy from real language |
| Product marketers | Build a messaging doc from evidence |
| Researchers | Assemble qualitative data with citations intact |

## 4. Scope — V1

### In scope

**Select-to-save.** Highlight any text in a post or comment; a small control appears:

```
+ Save quote
```

Captures: the quote, the surrounding comment/post, author (username as displayed), subreddit, thread title, thread URL, permalink, score, date, and the user's note.

Saving a **quote plus its context** is the whole product — a sentence without its thread is unciteable, and citability is what the job requires.

**Themes.** User-defined buckets, defaults renameable: `Pain` · `Objections` · `Language` · `Alternatives` · `Feature requests`. Assign at save time in one click.

**Research panel** (side panel)
- Quotes grouped by theme, searchable across quote, note, subreddit and author
- Per-theme count and per-subreddit count — `19 pain quotes, 12 from r/freelance` is itself a finding
- Click through to the permalink

**Export**
- **Markdown** — the primary artifact: grouped by theme, each quote with its citation link. This is what gets pasted into a messaging doc
- **CSV** — for the spreadsheet workflow this product is replacing
- **JSON** — full backup, re-importable

**Data ownership:** export all / import / clear all; quota warning at 80%.

### Explicitly out of scope for V1

No account, no backend, no Reddit API. No AI clustering or summarizing of quotes (a local, honest tool; the moment we summarise, we need a model and a payment story). No automated collection — nothing is saved that the user didn't select. No posting, commenting, voting or DMs. No user profiling or tracking of individuals across threads. No cross-platform saving (that's SavePosty).

## 5. Where the data comes from

Only text rendered in the user's tab, selected by the user. Both `www.reddit.com` and `old.reddit.com` should work — old.reddit is where a lot of this audience lives and it's the easier DOM.

**Personal data note:** quotes include usernames and can include sensitive disclosures (health, finance, employment). Everything stays local, the privacy policy must say so plainly, and `clear all` must be one click. Offer a "save without username" toggle — a copywriter needs the sentence, not the person, and the toggle is a cheap trust signal.

## 6. Non-functional requirements

| Requirement | Target |
| :-- | :-- |
| Selection → save control | < 100 ms, no layout shift |
| Save → confirmation | < 200 ms, no navigation |
| Panel with 2,000 quotes | Opens < 600 ms; search < 150 ms |
| Permissions | `activeTab`, `storage`, `downloads` + `*://*.reddit.com/*` |
| Privacy | No network requests |

## 7. Edge cases

- Selection spanning multiple comments (capture as separate quotes, or refuse clearly)
- Collapsed comment chains
- Very long comments (store full context, truncate the card)
- Deleted comments after saving (the saved copy stands — that's the point of saving)
- Both Reddit front-ends, and new Reddit's redesigns
- Markdown formatting inside comments (preserve it in the export)
- Quotes from the same comment saved twice (dedupe, keep the longer span)

## 8. Success metrics (30 / 90 day)

| Metric | 30d | 90d |
| :-- | :-- | :-- |
| Installs | 200 | 2,000 |
| 7-day retention | 30% | 40% |
| Users who save ≥ 5 quotes | 45% | 60% |
| Users who assign a theme | 40% | 55% |
| Export used ≥ once | 35% | 50% |
| Median quotes per active user / week | 6 | 15 |

Export rate should be the highest in the portfolio: this product exists to produce a document. If people save and never export, the value was in the saving and the product is smaller than we thought.

## 9. Kill criteria

Under 300 installs at 90 days, **or** export used by under 25% of active users at 90 days.

## 10. Open questions

- **Overlap with the Web Highlighter.** If [PRD-05](PRD-05-web-highlighter-markdown.md) is already shipped and doing well, this may be a niche listing of the same engine rather than a separate build — which is cheap and fine, but the store listings must not cannibalise each other. Decide the positioning before publishing.
- **Is theme assignment friction or value?** One click is cheap; measure whether people actually use themes or dump everything in the default.
- **Anonymization default.** On or off? Off is more useful for citation; on is more defensible. Probably off with a prominent toggle — but decide deliberately, and say which in the listing.
