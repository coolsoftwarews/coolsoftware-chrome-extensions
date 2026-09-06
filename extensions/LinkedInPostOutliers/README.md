# LinkedIn Post Outlier Finder

Chrome MV3 extension. Badges every post on a LinkedIn profile's post history, a hashtag page, or a
content search result set with how it compares to **that specific author's** own recent median
engagement (reactions + comments) — a 4.2× outlier is a finding, a post that always performs at an
author's normal level is not. No account, no backend, no network requests, no tracking of anyone
over time.

Built from
[PRD-38](../../docs/extensions/PRD-38-linkedin-post-outliers.md). The outlier engine
(median baseline, ratio badges, sample-size honesty) is the shared module the portfolio's README
calls out as reused across Instagram, TikTok, X, Pinterest and YouTube Pro Filters — this is its
LinkedIn implementation, scoped **per author** rather than per account-you're-viewing, since a
LinkedIn page (a hashtag feed, a search result set) usually shows many different authors at once.

Its sibling on this platform, [LinkedIn Creator Watchlist](../LinkedInCreatorWatchlist), tests a
different problem class: that one is a workflow/collection tool (curate a list of people, track
their posts over time). This one is a live comparison computed on whatever page is already open —
nothing to curate, nobody has to be watched first.

## Quick start

```bash
npm install
npm run icons          # regenerate src/icons/*.png (no image dependency)
npm run build           # dev build into dist/
npm run build:watch    # rebuild on change
npm run build:prod     # minified, production manifest name
npm test               # headless checks — parsing, medians, bands, filters, exports
npm run typecheck
npm run zip            # production build + dist/ packed for the Web Store
```

Node 18+ is required. Load it: `chrome://extensions` → Developer mode → **Load unpacked** → select
`dist/`. Open a LinkedIn profile's post history (`/in/<handle>/recent-activity/all/`), a hashtag page
(`/feed/hashtag/<tag>/`), or a content search result set (`/search/results/content/`).

## How it works

| File | Job |
| :-- | :-- |
| `src/outlier.ts` | The outlier engine: number parsing, median, the runaway-post exclusion, band thresholds, ratio scoring — pure, fully tested |
| `src/text.ts` | Pure text parsing for whatever LinkedIn renders (counts, relative dates, URL normalization, page-mode detection) |
| `src/dom.ts` | Every assumption about LinkedIn's DOM, isolated in one file, degrade-not-throw |
| `src/scan.ts` | Turns the current page into `RawPost[]` using dom.ts + text.ts |
| `src/filters.ts` | The filter row and sort — pure, fully tested |
| `src/formatters.ts` | CSV and Markdown export, filenames — pure, fully tested |
| `src/badges.ts` | The inline per-post ratio chip (never an absolutely-positioned overlay — see below) |
| `src/bar.ts` | The injected header strip + filter/sort/export row |
| `src/content.ts` | Wires scan → per-author baseline → score → filter → render, watches scroll and SPA navigation |
| `src/background.ts` | Service worker — the only thing content scripts can't do themselves: `chrome.downloads` |
| `src/storage.ts` | Last-used filter, per-author median cache, backup export/import/clear |
| `src/metrics.ts` | Local usage counters, including the health metric (parse-failure rate) |
| `src/popup.ts` | Toolbar popup: local counters + data ownership (export all / import / clear all) |

### The outlier ratio, and where it comes from

**Engagement = reactions + comments, unweighted.** Reposts are read and exported as their own column
but never folded into the ratio's numerator — a reshare count reflects the resharers' own audiences,
not engagement with this specific post (PRD §4). The median is computed **per author**, from whatever
of that author's own posts are currently visible on the page (excluding any Featured/pinned post from
the calculation, though it's still scored and badged normally).

**Where the baseline comes from depends on the page:**
- On a profile's post history, one author's whole visible history is on screen — the real, reliable
  case.
- On a hashtag or search page, most authors will only have one or two posts visible. Below **5** of
  that author's own posts (live or cached), the badge shows a dashed "— pending" chip rather than a
  false-confidence ratio (PRD §5). A small per-author median cache (`chrome.storage.local`, 24h TTL)
  lets a hashtag/search page badge confidently once the user has visited that author's profile
  history at least once.

**A single runaway post never gets to define its own author's baseline.** `robustMedian()` computes a
preliminary median over every one of an author's posts, then excludes anything more than **15×** that
preliminary median before computing the final median (PRD §7) — this happens in the calculation
itself, not just in the display cap. The displayed ratio is separately capped at `20×+` (true ratio
kept for sort/export), same convention as every other outlier-engine implementation in this
portfolio.

### The badge is inline, not an overlay

LinkedIn's post cards are large blocks, not Instagram's small square grid tiles — an
absolutely-positioned chip over the whole card would either cover content or float disconnected from
it. `badges.ts` instead inserts a small inline shadow-DOM chip immediately after the post's relative-
time label (or the author link, as a fallback), the same "inline next to existing text, no reflow of
anything else" technique [LinkedIn Creator Watchlist](../LinkedInCreatorWatchlist)'s own "+ Watch"
button already uses successfully on this exact DOM shape.

### Reposts and Featured posts

A "X reposted this" container is attributed to the **original author**, never the resharer, and
marked as a repost in the tooltip and export (same decision as LinkedIn Creator Watchlist §7, kept
consistent across this portfolio's two LinkedIn products). A Featured/pinned post is excluded from
its author's median but still scored and badged.

### Failure mode

LinkedIn rewrites its DOM often and undocumented (PRD §5/§7). `dom.ts` isolates every DOM assumption
behind functions that return `null`/`[]` instead of throwing. If three consecutive scans produce post
containers with no readable engagement at all, the overlay shows one quiet in-page notice — never a
broken post list — and bumps the local parse-failure counter, visible in the popup. That counter is
the product's health metric: watch it after any LinkedIn layout change.

## Privacy

No `fetch`, no `XMLHttpRequest`, no `sendBeacon`, no `WebSocket` anywhere in this extension —
enforced by `scripts/selftest.mjs` grepping `src/*.ts` for all four, and verifiable yourself with
devtools' Network tab. Everything read comes from the tab already open in front of the logged-in
user; everything stored stays in `chrome.storage.local`. There is no code path anywhere in this
extension that posts, reacts, comments, follows or connects on LinkedIn on the user's behalf. See
[PRIVACY.md](PRIVACY.md).

## Manual test checklist

The DOM-bound half needs a real, logged-in LinkedIn session and is not exercised by `npm test`:

- [ ] A profile's post history page with 10+ posts, logged in
- [ ] A profile with fewer than 5 posts (header shows "collecting…", no badge claims a baseline)
- [ ] A hashtag page and a content search results page — badges are mostly "— pending" until authors
      repeat or have been visited before
- [ ] Visit a profile's history first, then open a hashtag/search page showing one of their posts —
      confirm the cached median badges it confidently
- [ ] Each of the five post types named in PRD §5 (text, image, document/carousel, poll,
      article/newsletter) — confirm counts parse or the post degrades to "not scored", never a wrong
      number
- [ ] A "X reposted this" post — badged against the original author, marked as a repost, not counted
      toward the resharer's own median
- [ ] An author with one wildly viral post among normal ones — confirm the median calculation itself
      excludes it (not just the display cap)
- [ ] Each filter (`>2×`, `>5×`, 30d, 90d) and each sort (ratio, date, engagement)
- [ ] Export `.csv` and `.md`, with a filter applied — only the visible set is written
- [ ] Navigate profile → hashtag → search via LinkedIn's own in-app links (SPA navigation, no reload)
- [ ] Scroll to load 100+ posts; badges recompute without visible jank, no layout shift in the feed
- [ ] Popup: usage counters populate, export/import/clear-all round-trip correctly
- [ ] Devtools Network tab stays empty the entire time

## Known limits

- Not verified against a live, logged-in LinkedIn session in this build environment — `src/dom.ts`
  was built from the same DOM shape [LinkedIn Creator Watchlist](../LinkedInCreatorWatchlist)'s own
  content.ts already uses successfully (`[data-urn]` containers, `a[href*="/in/"]` author links, a
  visible-text regex over the social-counts bar). Re-validate before the Web Store submission, and
  watch the parse-failure counter after any LinkedIn redesign.
- Article/newsletter shares are the likeliest post type to have unreadable counts on the wrapping
  post (PRD §5) — those degrade to "not scored" rather than a guess.
- The main LinkedIn feed is deliberately out of scope (PRD §4) — open a profile's post history, a
  hashtag page, or a content search result set instead.
- The per-author median cache has a fixed 24h TTL with no visible "cached from" date in V1 (PRD §10
  open question) — a stale cached median could badge a hashtag post against an author's outdated
  baseline until it expires.
