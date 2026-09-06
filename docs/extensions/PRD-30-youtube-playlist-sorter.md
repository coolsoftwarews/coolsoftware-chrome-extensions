# PRD — YouTube Sign-in-Free Playlist Sorter

**Status:** Draft for build
**Owner:** Gabriel
**Date:** 2026-09-02
**Type:** Chrome extension (MV3), standalone Web Store listing
**Platform:** YouTube
**Backend:** None · **Accounts:** None · **Payments:** None

---

## 1. One-line proposition

Sort *any* playlist you're looking at — yours, someone else's, or a public one you just found — by duration, title or date, without ever signing in.

## 2. The hypothesis

There is already a well-reviewed, free, ad-free competitor doing playlist sorting: **Cleangarden — YouTube Playlist Sorter** (Paintingstack Technologies SpA, 3.7★, updated 2026, 8 languages). It adds a side panel that sorts a playlist by views, duration, date or title, shows total duration and video count, and lets you play straight from the sorted list. It has no ads and doesn't sell data. On paper it's a strong incumbent — the kind of listing PocketTube is in the sibling YouTube Subscriptions PRD, where cloning into an already-served niche is explicitly called the weakest bet.

But Cleangarden's own store listing states the mechanism plainly: **"sign in with Google, pick a playlist from the dropdown, sort it, and watch."** That sign-in is not incidental — it's how the product is built: it goes through the YouTube Data API with OAuth, and the "pick a playlist from the dropdown" flow only ever lists playlists the signed-in account can manage (its own). That architecture has two structural consequences, not bugs to be patched later:

1. **It requires a Google sign-in.** Every install has to hand over OAuth access to a third-party developer's app just to sort a list of video titles. That's a real trust cost for a utility this small, and it's the exact category of friction the README's hard constraints rule out for every extension in this portfolio.
2. **It only works on playlists the signed-in user owns.** The Data API's per-user playlist listing is built around "your content" — it has no reason to expose someone else's public playlist, a channel's uploads-as-playlist, or Watch Later (which the API doesn't expose as an ordinary playlist at all). A user who wants to sort a public "100 best 2026 songs" playlist someone else made, or a competitor's tutorial series, or their own Watch Later, is a user Cleangarden cannot serve — not "hasn't gotten to yet," structurally cannot, because the whole product is scoped to API-visible owned playlists.

**The hypothesis:** a version built entirely from the *rendered playlist page's DOM* — zero OAuth, zero API key, zero sign-in screen — can sort **any playlist currently open in the tab**, including ones the user doesn't own, at zero trust cost to install. That's a materially different, and larger, address space than "your own playlists," and it's the exact user Cleangarden's architecture excludes by design, not by omission.

**The honest cost, disclosed rather than hidden:** the DOM only contains what YouTube has actually rendered. Long playlists lazy-load as you scroll, so a freshly opened 400-video playlist shows the tool only the first ~100 or so until more is loaded. This product's answer is an explicit "load more before you trust this list" action with a visible progress readout — never a silent undercount presented as the whole playlist. Cleangarden's API-based approach doesn't have this specific limitation (the API returns the full list in one call), so this is a real trade-off being made in exchange for working sign-in-free on any playlist — not a strictly-better product, a differently-shaped one aimed at a user Cleangarden can't reach at all.

## 3. Target user

| Attribute | Detail |
| :-- | :-- |
| Who | Anyone who opens a long YouTube playlist — their own or someone else's — and wants it in a useful order or a useful subset |
| Concrete scenarios | Sorting a stranger's "top 100 lo-fi tracks" playlist by length to find short ones; sorting a conference's public talk playlist by upload date to watch it in order; building a 45-minute commute set from a long tutorial series without owning it |
| Why not Cleangarden | Won't or can't sign in with Google for a sorting utility, or the playlist in question isn't theirs to begin with (public, another creator's, Watch Later) |
| Buyer | None — free consumer utility, same monetization posture as the rest of this portfolio's V1 |

## 4. Scope — V1

### In scope

- Activates on any playlist page (`/playlist?list=...`), any account state (signed in, signed out, or someone else's playlist) — a side panel showing the videos currently loaded on the page
- Per-row fields: title, duration, position, and views / upload date **only when YouTube has rendered that text** — never fetched, never guessed
- Sort the loaded set by: duration, title (A–Z), upload date (when present), or **YouTube's own order** (see §7 — this is a first-class option, not just "unsorted")
- **"Load full playlist"** action: bounded auto-scroll that keeps loading more rows until either the whole playlist is loaded or a hard cap is hit, with a live progress readout ("142 of ~210 loaded — scrolling…")
- Running total duration of the currently loaded set, always labelled against what's loaded, not against a claimed playlist total
- **"Build a set that fits N minutes"** — a quick filter that greedily packs videos from the loaded set to fit under a user-entered time budget, and shows what it left out
- Export the current sorted/filtered view as CSV or Markdown
- Last-used sort order and last-used time-budget value persisted locally (`chrome.storage.local`) as a convenience default for the next playlist opened — not synced, not account-scoped

### Out of scope for V1

- **No playlist editing or reordering on YouTube itself.** This is read-only end to end — no drag-to-reorder call, no remove-from-playlist button, ever. Sorting only ever changes what the side panel displays, never the playlist YouTube stores.
- No cross-playlist merging or comparison (one playlist per panel session)
- No Watch Later support if it turns out to render on a different DOM shape than a normal playlist page — call that out to the user as a known unsupported case rather than silently showing a broken or empty panel (see §5, §7)
- No account features of any kind — no "my playlists" list, no subscriptions, no history

## 5. Where the data comes from — read before committing

Every field in this product is read from the **currently rendered `/playlist?list=...` page's DOM**. There is no YouTube Data API call, no OAuth, no API key, anywhere in this codebase — that omission is the entire product, not an implementation detail.

Two consequences that shape the build directly:

1. **YouTube lazy-loads playlist items as the user scrolls.** A freshly opened long playlist renders roughly the first page of rows and appends more only as the scroll container nears its end. The "load full playlist" action therefore has to *drive* that scroll behavior itself (scroll the playlist's own scrollable container, not the whole window) and must be **bounded** — a maximum wall-clock time and a maximum scroll-attempt count, both visible as constants, not "just keep going." When the bound is hit before the list stops growing, the panel says so plainly ("stopped after 45s / 60 attempts — N loaded, more may remain") rather than implying completeness.
2. **The panel must never state a total video count it hasn't verified by actually loading that many rows.** YouTube's own playlist header sometimes prints a stated count ("212 videos") — that number can be shown as a *label from YouTube*, clearly attributed, but the panel's own "loaded" count is always the literal number of rows it has actually read out of the DOM, and any UI that implies "this is the whole playlist" is gated on those two numbers matching.

**Spike needed before shipping (same posture as this portfolio's other DOM-scraping PRDs' own §5 requirement):** confirm, against a handful of real, differently-shaped playlists (a small one under 50 videos, a large one over 300, one with age-restricted/unavailable videos mixed in, one sorted by YouTube's own "custom order" vs. upload order), that:
   - duration text parses correctly across its formats (`M:SS`, `H:MM:SS`, and the live-stream/premiere states that don't show a duration at all)
   - view-count text (when shown) parses across its formats ("1.2K views", "3,401 views", localized thousands separators)
   - upload-date text (when shown) is present in a parseable form at all, or whether it's only ever a relative string ("2 years ago") with no absolute date — if the latter, sort-by-date has to be documented as relative-order-only, not a real date sort
   - the row selector survives a scroll-driven append (i.e. newly loaded rows use the same shape as initially rendered ones)

This build could not reach a live YouTube session to run that spike; the DOM reader is written to degrade field-by-field (a row missing a parseable duration is excluded from duration sort and the time-budget packer, never crashes the panel or corrupts the total) and the manual verification checklist lives in the extension's own README as a pre-ship gate, not assumed passed.

## 6. Non-functional requirements

| Requirement | Target |
| :-- | :-- |
| Panel reflects the currently loaded rows | < 300 ms after a scroll-driven DOM append |
| Auto-scroll bound | Hard cap, both dimensions: wall-clock time and scroll-attempt count (exact numbers are build-time constants, tuned during the §5 spike, not user-configurable in V1) |
| Permissions | `activeTab`, `storage`, `downloads`, `sidePanel` + host permission `*://*.youtube.com/*` — nothing broader |
| Sign-in | None, ever. No OAuth, no API key, no Google account access of any kind — this is the entire positioning |
| Data | Never leaves the device; nothing is fetched from any server this extension controls or any third party |
| Platform actions | Strictly read-only — no write call to YouTube exists anywhere in the codebase |

## 7. Edge cases

- **Playlists the user owns:** must still work exactly the same way as any other playlist — the DOM doesn't know or care who owns it, and the product should not special-case ownership at all. (Ownership is Cleangarden's differentiator to lose, not this product's to chase.)
- **Age-restricted, private, or deleted videos inside a playlist:** these render as blank/placeholder rows on YouTube's own page. Show them as a distinct "unavailable" row (title/duration shown as unavailable, excluded from duration sort and the time-budget packer, still counted toward the loaded-row total) rather than silently dropping or silently including them as zero-duration.
- **Very large playlists (500+ videos):** the loaded-row list must stay responsive once fully loaded — virtualize or otherwise cap panel re-render cost, and the auto-scroll bound above exists specifically so this case fails predictably (a clear "stopped early" message) rather than hanging the tab.
- **YouTube's own custom order:** playlist creators can hand-order a playlist in a way that carries meaning (a course sequence, a mixtape's flow) that "upload date" or "title" sort would destroy. "YouTube's own order" is a first-class, always-available sort option precisely so the user can get back to it after trying the others — never a state you can only reach by not touching the sort control.
- **Watch Later:** if it turns out to render on a meaningfully different DOM shape than `/playlist?list=...` pages, the panel says so explicitly ("Watch Later isn't supported yet") rather than showing an empty or broken panel — documented as a known V1 limitation per §4, not silently unhandled.
- **A playlist with zero videos, or a playlist that fails to load at all (deleted, made private after the link was shared):** empty/error state in the panel with plain language, never a blank screen.

## 8. Success metrics (30 / 90 day)

| Metric | 30d checkpoint | 90d "keep investing" bar |
| :-- | :-- | :-- |
| Installs | 150 | 1,200 |
| 7-day retention | 30% | 40% |
| Users who use "Load full playlist" at least once | 40% | 55% |
| Users who use the N-minute quick filter at least once | 15% | 25% |
| Users who sort a playlist they don't own (i.e. genuinely outside Cleangarden's reach) | — | tracked, no target set in V1 — this is the number that validates or kills the hypothesis in §2 |

The last row is the one that actually answers the question this PRD exists to ask. If it's near zero at 90 days, the "Cleangarden can't serve this user" bet didn't pay off and this is functionally just a thinner Cleangarden clone minus sign-in — worth knowing plainly rather than declaring victory on installs alone.

## 9. Kill criteria

Under 300 installs or under 20% 7-day retention at 90 days → stop, same bar this portfolio uses elsewhere. Separately: if the §8 "sorts a playlist they don't own" share stays near zero for two consecutive monthly checkpoints after 90 days, treat the differentiation hypothesis as falsified even if raw install numbers are acceptable — the product would be surviving on being free rather than on the structural gap it was built to fill.

## 10. Open questions

- Is upload date ever exposed as an absolute, parseable value on a playlist row, or only ever as a relative string ("2 years ago")? This determines whether "sort by date" can be a real chronological sort or has to be documented as approximate/relative-only — resolve in the §5 spike before shipping the date sort as if it were exact.
- Does Watch Later render on the same row shape as an ordinary playlist, making it trivially supportable later, or is it a genuinely different component worth a dedicated V2 adapter?
- Cleangarden shows a stated total video count from its API response with confidence; is there a lightweight way to also show YouTube's own header-printed count as a soft cross-check (per §5) without ever implying the panel has verified it — worth a small UI treatment (e.g. "YouTube says 212 — you've loaded 84") rather than omitting the number entirely just because it can't be trusted outright.
- Should the greedy time-budget packer have a "prefer keeping YouTube's own order" mode in addition to its default (presumably duration-optimized) packing, for the course-sequence use case in §7 — deferred to user feedback rather than guessed at in V1.
