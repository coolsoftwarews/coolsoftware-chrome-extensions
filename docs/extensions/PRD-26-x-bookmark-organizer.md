# PRD — X Local Bookmark Organizer & Search

**Status:** Draft for build
**Owner:** Gabriel
**Date:** 2026-09-02
**Type:** Chrome extension (MV3), standalone Web Store listing
**Platform:** X (Twitter)
**Backend:** None · **Accounts:** None · **Payments:** None

---

## 1. One-line proposition

Turn X's own Bookmarks page into something you can actually organize and search — tags, folders, notes, full-text search and export — without creating an account anywhere.

## 2. The hypothesis

**Will bookmark-heavy X users trade power for zero trust cost?** The two market leaders in this exact niche — Twillot and Dewey — both prove the underlying pain is real: X's native bookmarks are an unsearchable, unsortable pile that becomes useless past a few hundred items. But both of them ask for more than a browser extension install to fix it. Dewey's own Web Store listing walks a new user straight into account creation right after install. Twillot's listing advertises "powerful account actions" as a core selling point — which means it isn't reading your bookmarks, it's acting on your account, and that requires the same trust handoff.

That's a real, closable gap. A meaningful slice of the people who'd bookmark enough posts to need organizing are exactly the people who won't hand a third party an authenticated session with their X account to get it — creators protecting a following, founders/operators wary of automation bans, anyone who has already been burned by an extension asking for more access than the feature needs. The bet: **local-only, no-account bookmark search wins the users who bounce off Twillot/Dewey's signup wall**, even while giving up what an account buys those products — cross-device sync, and (in Twillot's case) direct write-access conveniences like bulk actions on X itself.

This is a genuine trade-off, not a hidden gap in scope, and it's the whole positioning: **"we can see less than they can, and that's the point."**

## 3. Target user

| Segment | Job |
| :-- | :-- |
| Creators | Rediscover a swipe file of hooks/threads buried in hundreds of old bookmarks |
| Researchers / analysts | Keep a working, searchable archive of sourced posts without a vendor relationship |
| Founders / operators | Get bookmark structure without connecting a third party to their X account |
| Heavy X users generally | Anyone whose Bookmarks tab has quietly become "the place things go to die" |

## 4. Scope — V1

### In scope

**Indexing.** The user opens their own native X Bookmarks page; the extension reads whatever's rendered as they scroll (or auto-scrolls a bounded amount on request), extracting each bookmarked post's author, handle, text, post URL, post date, metrics, and media reference. This is **read-only** — the extension reads the Bookmarks page X already rendered for the logged-in user, exactly like every other DOM-reading extension in this portfolio. It is not the X Bookmarks API, and it never will be.

**Organize.**
- **Tag** any indexed bookmark with one or more free-text tags.
- **Fold into collections** — user-created folders, similar to the portfolio's Saver pattern, so a bookmark can live in a folder and carry tags at the same time (folders for broad buckets, tags for cross-cutting themes).
- **Personal note** per bookmark, same as every other Saver in this portfolio.

**Search.** Full-text search across everything indexed so far — post text, author, handle, tags, notes — client-side, instant, no server round-trip (there is no server).

**Export.** CSV, Markdown, and JSON (the JSON is the full re-importable backup).

**Import.** JSON backup import, **merge, not overwrite** — matches the portfolio-wide rule (README.md: "Local storage only... export all / import / clear all").

**Clear all data.**

**Re-index action.** A manual "Re-index my bookmarks page" refresh the user triggers explicitly — see §5 and §7 for why this exists instead of a live sync.

### Explicitly NOT in scope

- **No syncing with X's own bookmark state, in either direction.** Removing an item from this extension's local library does **not** un-bookmark it on X. There is no code path that writes to X at all — this stays permanently read-only, matching every extension in this portfolio (README.md: "Read-only on the platform... It is permanent, not a V1 limit").
- **No bulk-delete-on-X, no bulk-organize-on-X.** That is explicitly Twillot's territory (a write action against the user's account) and this portfolio never takes write actions on a user's behalf.
- **No auto-tagging or AI categorization.** Tags and folders are entirely user-authored in V1.
- **No cross-account bookmark merging.** One browser profile, one X account's bookmarks per local library.
- **No cloud sync, no account, no backend of any kind** — the whole point of the hypothesis in §2.

## 5. Where the data comes from — read before committing

This is the single most important design fact in this PRD, and it is a real trade-off, not a hidden limitation.

X's Bookmarks page is a virtualized feed: it only renders posts as the user scrolls to them, and there is no public, no-auth API this extension can call to fetch "all my bookmarks" in one shot (that's exactly the access Twillot and Dewey are asking for an account/session to get around). So indexing depends entirely on the user having their own Bookmarks page open, and either scrolling it themselves or letting the extension auto-scroll a bounded distance on request (never in the background, never without the tab open and focused — see §6, "foreground only").

The honest way to describe this to the user, everywhere it matters (first-run state, README, store listing): **"We index what you've scrolled through. Scroll further (or hit Re-index) to add more."** This is fundamentally different from an API-based tool that could see a user's full bookmark history instantly on first connect. That's the trade this product is making deliberately, in exchange for never asking for account access — say so plainly, don't bury it in a FAQ.

## 6. Non-functional requirements

| Requirement | Target |
| :-- | :-- |
| Indexing a scrolled batch → items appear in the library | < 500 ms after each scroll-triggered render settles |
| Library panel with 2,000 items | Opens < 500 ms, search stays responsive while typing |
| Permissions | `activeTab`, `storage`, `downloads`, `sidePanel` + host permissions `*://*.x.com/*`, `*://*.twitter.com/*` |
| Storage | Warn at 80% of `chrome.storage.local`'s 10 MB quota; per-item budget documented; export prompt on warn |
| Privacy | No network requests of any kind — no `fetch`, `XMLHttpRequest`, `sendBeacon`, `WebSocket` anywhere in the codebase |
| Platform safety | Zero code paths that write to X — no click-simulation, no un-bookmark action, no post/like/follow/message action, ever |
| Foreground only | Indexing only runs while the user has the Bookmarks tab open and (for auto-scroll) focused; no background polling, no alarms |

## 7. Edge cases

- **Un-bookmarking on X after it's indexed locally.** The local copy goes stale — this extension has no way to know a bookmark was removed on X's side unless the user re-visits the Bookmarks page and re-indexes. There is deliberately no live sync (see §4/§5); the fix is a manual "still bookmarked?" refresh pass during re-indexing, which checks whichever previously-indexed items are still visible in the current scroll session and flags the rest as "not seen on your last re-index" rather than silently deleting them (a false negative from partial scrolling is worse than a stale flag the user can dismiss).
- **Duplicate indexing on re-scroll.** Scrolling back up and back down re-renders posts already indexed. Dedupe by the post's status id (parsed from its permalink), update-in-place rather than duplicate — same "update, don't duplicate" rule as XConversationSaver's capture cards.
- **Very large bookmark collections (thousands of items) and local storage quota.** `chrome.storage.local`'s 10 MB budget is finite; a heavy bookmarker's thousands of posts (each with text, metrics, a thumbnail reference) can approach it well before "thousands" sounds like it should. Cap what's stored per item (no full-size media, only a thumbnail URL reference, never downloaded), warn at 80% with a one-click export, and never fail a save silently — same rule as every Saver in this portfolio.
- **Posts that get deleted on X after being bookmarked and indexed.** The local card keeps working (text/metrics/note/tags all survive), the "Open on X" link may 404 — say so, don't hide the card.
- **Media-only bookmarks with no text.** Index them anyway; search still works on author/handle/tags/note.
- **Re-indexing mid-scroll interruption** (tab closed, navigated away). Whatever was captured before the interruption stays in the library — no partial-batch rollback.

## 8. Success metrics (30 / 90 day)

| Metric | 30d | 90d |
| :-- | :-- | :-- |
| Installs | 200 | 2,000 |
| 7-day retention | 25% | 35% |
| Users who index ≥ 20 bookmarks | 50% | 65% |
| Users who tag or fold ≥ 1 bookmark | 30% | 40% |
| Search used ≥ once | 35% | 50% |
| Export used ≥ once | 20% | 30% |

Search-used and index-depth matter most: if people index a handful of bookmarks and never search, the product read as "a nicer bookmark list," not "I finally found that thing from three months ago" — the actual value proposition.

## 9. Kill criteria

Under 300 installs at 90 days, **or** fewer than 25% of installs indexing more than 20 bookmarks. The second number failing means the core mechanic — scroll your own Bookmarks page to build the index — was too much friction for the value on offer, and no amount of tagging/export polish fixes that; it's a positioning or onboarding failure, not a feature gap.

## 10. Open questions

- **How much should auto-scroll do on its own?** Too little and the product feels broken on first use ("I opened it and nothing happened"); too much and it starts to resemble the background crawling this portfolio explicitly rules out. Default to a bounded, user-triggered auto-scroll (a fixed number of screens per click, foreground only, visible progress) rather than either extreme — revisit the bound after watching real re-index session lengths.
- **Do collections or tags dominate usage?** If users overwhelmingly use one and ignore the other, that's a real signal about how bookmark-heavy X users think about their own archive — worth tracking the same way PRD-07's "collections vs. tags" open question does for Instagram.
- **Is the "still bookmarked?" staleness flag worth the UI complexity**, or do users simply not care that a local copy outlives the X-side bookmark? If nobody ever looks at the flag, drop it in V2 rather than build it out further.
- **Does the honest "we only index what you've scrolled" framing help or hurt conversion** on the Web Store listing, next to competitors that imply full-history access? Worth an early store-listing A/B once there's install volume to test against.
