# PRD — LinkedIn Post Outlier Finder

**Status:** Draft for build
**Owner:** Gabriel
**Date:** 2026-09-02
**Type:** Chrome extension (MV3), standalone Web Store listing
**Platform:** LinkedIn
**Backend:** None · **Accounts:** None · **Payments:** None

---

## 1. One-line proposition

Badge every post you're already looking at on LinkedIn — a profile's history, a hashtag feed, a
search result set — with how it compares to that specific author's own recent median, so a breakout
post is obvious instead of buried in a scroll.

## 2. The hypothesis

**Will marketers pay for intelligence?** This portfolio already tests the same question on
Instagram, TikTok, X and Pinterest: does a *relative* number — this post vs. this account's own
median — change what a marketer makes next, more than a workflow tool (a saver, a watchlist) does?
LinkedIn is the interesting extension of that test because every existing LinkedIn extension in this
category is a sales-automation tool (auto-connect, auto-message, lead scraping) — nobody is selling
*content* intelligence here, even though LinkedIn creators have exactly the same "which of my posts
worked, and by how much" question Instagram creators do. If this converts on a platform with zero
comparable competitors, that's a stronger signal than winning a crowded Instagram category.

Its sibling, [LinkedIn Creator Watchlist](PRD-10-linkedin-creator-watchlist.md), tests a different
problem class on the same platform: that one asks whether creators will curate a *list of people* to
track over time (a workflow/collection product, built by browsing, stored indefinitely). This one
asks whether they'll pay for a *live comparison* computed on whatever page they already opened — no
watchlist, no tracking, nothing to curate. A user never has to have seen a person before for this to
work; they open a profile or a hashtag page and the badges are just there.

## 3. Target user

| Segment | Job |
| :-- | :-- |
| LinkedIn creators | "Which of my posts broke out, and which just performed at my normal level?" |
| Content marketers | Scout proven post formats/angles from a hashtag or search result set before writing |
| Agencies | Competitive teardown of a prospect's or competitor's LinkedIn history in minutes |
| Founders | Sanity-check whether a launch post actually outperformed their own baseline, or just felt big |

## 4. Scope — V1

### The core insight

LinkedIn shows an aggregate reaction count and a separate comment count on almost every rendered
post, but never a per-account baseline — a founder's 400-reaction post reads as "big" only in
isolation. The signal is the same one this portfolio already ships elsewhere: this post's engagement
÷ that specific author's own recent median.

**Engagement metric (V1, documented and fixed):** `engagement = reactions + comments`, an
**unweighted sum** of LinkedIn's own two visible counters. Reposts/shares are read and shown in the
export as a separate column but are **not** part of the ratio's numerator — a reshare count reflects
the resharers' own audiences more than engagement with this specific post, and folding it in would
make the number harder to explain and audit. Unweighted was chosen over a comments-weighted variant
(e.g. `reactions + comments × 4`) because it's the simpler, more defensible number to show next to a
badge someone might screenshot into a client deck — a weighting scheme invites the question "why
4×?", and this portfolio's outlier engine has always favored an honest raw number over a tuned score.

**Baseline (per author, computed live, not tracked over time):** for the posts currently visible on
the page, group by author, exclude that author's pinned/featured post(s) from the baseline
calculation (same discipline as [PRD-06](PRD-06-instagram-outlier-finder.md) §4), and take the
median engagement of the rest. Every post — including the excluded pinned one — is still scored and
badged against that baseline.

### In scope

**Works on three page shapes, same engine underneath:**
- A profile's post history (`/in/<handle>/recent-activity/…`) — the high-value case, since one
  author's whole visible history is on screen and the median is built from a real sample.
- A hashtag page (`/feed/hashtag/…`) or content search results (`/search/results/content/…`) — a
  mixed-author result set. Each post is still scored against *its own author's* median, computed from
  however many of that author's posts are visible in the current result set, falling back to a
  cached per-author median (see §4 "Local state") when the live sample is too thin.
- The main feed is explicitly **out of scope for badge display** in V1 — it's the least
  outlier-relevant surface (algorithmic, not a research context) and the surface
  [LinkedIn Creator Watchlist](PRD-10-linkedin-creator-watchlist.md) already owns for
  browsing-driven collection. Keeping this extension off the main feed keeps the two products from
  visually competing for the same post row.

**Badge on every scored post:**

```
🔥 4.2×   62 reactions · 11 comments
```

- Ratio badge with the band glyphs this portfolio already uses (`🔥 ≥5×`, `🔥 ≥2×`, `↑ ≥1.5×`, `—`
  under), capped for display at `20×+` (true ratio kept for sort/export).
- **Header strip**, shape depends on the page:
  - Single-author page (profile history): `Recent median: 38 engagements (reactions + comments) ·
    median of 14 loaded posts · covers Jan 3 – Aug 29, 2026`.
  - Mixed-author page (hashtag/search): `142 posts scanned across 96 authors · 31 have a reliable
    per-author median (5+ of their posts visible or cached from a profile visit) · 111 pending`.

**Filters** (single row, no settings page): `>2×` / `>5×`, last 30 / 90 days, sort by ratio, date, or
raw engagement.

**Export** the visible set as CSV or Markdown: author, profile URL, post URL, post type, date,
reactions, comments, reposts, engagement, ratio, repost flag. Download only.

**Local state:** the last-used filter, and a small per-author cache of the most recently computed
reliable median (author id, median, sample size, computed-at) so a hashtag/search page can badge a
post confidently even when only one of that author's posts is visible there, as long as the user has
visited that author's profile history at some point. That's the whole storage story — same "that's it"
framing as PRD-06 §4.

### Explicitly out of scope for V1

No cross-author comparison dashboard or leaderboard (that's a different product, and starts to look
like a sales tool this portfolio is deliberately not building). No historical tracking of an author's
median *over time* — a cached median is a point-in-time convenience, refreshed whenever the user
revisits that profile, never a trend line (that needs a server). No AI explanation of "why it
worked". No posting, reacting, commenting, connecting, following or any write action against
LinkedIn — read-only, always, permanently, same as every LinkedIn product in this portfolio. No
crawling profiles or hashtags the user hasn't opened.

## 5. Where the data comes from — read before committing

LinkedIn renders an aggregate reaction count (not broken out by reaction type by default — that
breakdown needs a click this extension never makes) and a separate comment count for posts already
in the DOM, on all three in-scope page shapes. **No separate API calls, no background crawling** —
identical read-only/foreground-only posture to [LinkedIn Creator
Watchlist](PRD-10-linkedin-creator-watchlist.md) §5, because LinkedIn is the most automation-hostile
platform in this portfolio and being mistaken for a scraping/automation tool is the real business
risk here, not the DOM fragility itself.

Two known problems, in order of severity:

1. **Sample size is almost always thin on a mixed-author page.** A hashtag or search feed rarely
   shows more than one or two posts from the same author. Below a documented floor — **5 of that
   author's own posts, live or cached** — the badge shows the ratio greyed out with "not enough of
   this author's posts to compare" rather than presenting a 1-post "median" as a baseline. This is
   the same honesty rule as PRD-06 §5, with a lower floor (5, not 12) because LinkedIn's engagement
   volume and posting cadence are both lower than Instagram's, and a 12-post floor would leave the
   product useless outside profile pages.
2. **Post-type parsing is not uniform.** Text posts, images, documents/carousels, polls and
   article/newsletter shares each render their engagement bar slightly differently, and a poll's own
   vote count is a distinct number from its reaction count that must never be mixed into engagement.
   **Required pre-ship spike (1 day):** confirm reaction and comment counts parse correctly across
   all five post types listed above, on a real profile history page, a hashtag page and a content
   search page, logged in. Where a post type's counts can't be read reliably (article/newsletter
   shares are the likeliest failure, since LinkedIn sometimes renders them as an external-link card
   with engagement counts on the *wrapping* post rather than the article itself), that post degrades
   to "not scored" rather than a wrong number — never a guess.

## 6. Non-functional requirements

| Requirement | Target |
| :-- | :-- |
| Badges visible after a page's posts render | < 400 ms, no layout shift in the post list |
| Recompute on scroll (infinite-loading feed/history) | Debounced, no visible jank at 150+ posts |
| Permissions | `activeTab`, `storage`, `downloads` + host permission `*://*.linkedin.com/*`. Nothing broader — no `sidePanel`, no `tabs`, no `scripting` |
| UI surface | Toolbar popup only (usage counters, export-all/import/clear-all). All filter/sort/badge/export UI lives in an on-page overlay injected by the content script — a side panel isn't needed because nothing here requires a persistent panel independent of the page being viewed |
| Privacy | No network requests. Verifiable in devtools |
| Safety | Zero write actions against LinkedIn, enforced by having no such code path anywhere in the extension |
| Failure mode | If LinkedIn's DOM changes and parsing fails: one quiet in-page notice, never a broken post list |

## 7. Edge cases

- **Reposts/shares — attribute to the original author, not the resharer.** Mirrors [LinkedIn Creator
  Watchlist](PRD-10-linkedin-creator-watchlist.md) §7's decision, kept consistent across the
  portfolio's two LinkedIn products: a two-author container ("X reposted this") scores and badges the
  post against the *original* author's median, marks it visibly as a repost, and never lets a
  reshare count toward the resharer's own baseline.
- **Articles/newsletters have different engagement semantics.** An article/newsletter share is
  scored the same way (reactions + comments on the share) when those numbers are readable on the
  post itself; when they're only readable on the linked article's own page (not visible from the
  feed/history view), the post is marked "not scored" rather than guessed.
- **One viral post skewing the median.** An author with one wildly outperforming post must not drag
  their own baseline upward and make every other post of theirs look artificially "flat." The median
  calculation itself excludes any single post whose engagement exceeds **15× the author's
  preliminary, all-inclusive median** (a documented, fixed multiple — computed in two passes: an
  initial median over every post, then a final median over whatever remains after dropping anything
  above that multiple). The excluded post is still scored and badged against the resulting baseline;
  it just never gets to define it. This is stricter than PRD-06's Instagram approach, which only caps
  the *display* at `20×+` — here the exclusion happens in the calculation itself, per this build's own
  brief.
- **Private / 1st-degree-only visible reaction lists.** The extension never needs to know *who*
  reacted — only the aggregate count LinkedIn already renders for this viewer, regardless of
  connection degree. If a post's audience setting hides even that count from this viewer, it's parsed
  as unknown (never zero), same as any other unreadable field.
- **An author with fewer than 5 posts visible or cached anywhere.** Badge stays permanently greyed
  for that author on this visit — never resolves into a false "reliable" baseline no matter how long
  the page is scrolled, if that author truly hasn't posted enough.

## 8. Success metrics (30 / 90 day)

| Metric | 30d | 90d |
| :-- | :-- | :-- |
| Installs | 150 | 1,500 |
| 7-day retention | 25% | 35% |
| Users who view ≥ 3 profile histories or hashtag/search pages | 40% | 55% |
| Users who use a filter or sort | 30% | 45% |
| Export used ≥ once | 15% | 25% |
| Store rating | ≥ 4.2 | ≥ 4.4 |

Local counters only: pages scanned (by page type), filter used, sort used, export used, and the
parse-failure count. The parse-failure counter is the health metric — LinkedIn ships DOM rewrites
often, and this is what surfaces a break before the reviews do.

## 9. Kill criteria

Under 250 installs at 90 days with real distribution effort, **or** a parse-failure rate above 10% of
page scans that isn't fixed inside a week, **or** fewer than 20% of users ever seeing a reliable
(non-greyed) badge — that last one specifically tests whether the thin-sample problem in §5 makes the
whole proposition too rare to be useful outside profile pages. A tool that mislabels which of a
marketer's posts (or a competitor's) actually broke out is worse than no tool.

## 10. Open questions

- **Is the 5-post reliability floor right for LinkedIn's lower posting cadence?** It might still be
  too high for hashtag/search pages to ever show more than a handful of reliable badges. Watch the
  "reliable badge seen" rate from real usage before tuning it down further; going lower than 5 starts
  to reintroduce the "a single lucky post looks like a baseline" problem this whole product exists to
  avoid.
- **Unweighted vs. comments-weighted engagement.** §4 documents the unweighted choice as more
  defensible and auditable; revisit if real usage shows comments-heavy posts (which usually reflect
  deeper engagement than a reaction click) are getting under-badged relative to how creators actually
  judge their own posts.
- **Should the cached per-author median ever expire?** A stale cached median (from a profile visited
  months ago) badging a hashtag-feed post today could be misleading if that author's posting pattern
  changed. Consider a visible "cached from your visit on <date>" label and/or a TTL, decided with real
  usage rather than guessed up front.
