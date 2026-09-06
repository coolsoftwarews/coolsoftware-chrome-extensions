# PRD — Universal Tab Stash & Reading-List Export

**Status:** Draft for build
**Owner:** Gabriel
**Date:** 2026-09-02
**Type:** Chrome extension (MV3), standalone Web Store listing
**Platform:** Cross-platform (any website)
**Backend:** None · **Accounts:** None · **Payments:** None

---

## 1. One-line proposition

You have 40 tabs open. Name them as a group, close them, and get them back — or export them as a
reading list — whenever you're ready.

## 2. The hypothesis

Tab-management tools have long-proven demand: OneTab, Toby and their peers have millions of combined
installs solving the exact problem "I have too many tabs open and need to save this set and close
them." The demand isn't in question. What's worth testing is the shape of the offer.

The pattern in that category is a free local tier that works fine at first, followed by a push toward
a cloud-sync account to unlock the second device, the searchable library, or the "don't lose this if
you clear your browser" safety net. That's a reasonable business, but it re-introduces the exact
friction — sign up, trust a server with your open tabs, hope it's still around next year — that made
someone want a tab tool instead of just leaving 40 tabs open in the first place.

The hypothesis: a version that stays permanently, deliberately local-only — no account, ever, and
data ownership is literally a file on disk — serves the real segment of that market who want tab
decluttering without another login. Export/import already solves cross-device movement without a
server in the middle; it's slower than sync, but it's a file the user controls, not a trust
relationship with a company. If that segment is large enough to sustain installs and retention on its
own, it validates "permanently local" as a durable position in a category every competitor eventually
monetizes away from.

## 3. Target user

| Segment | Job |
| :-- | :-- |
| Research-heavy knowledge workers | Save 30 tabs of open threads for a project, close the browser, come back to exactly that set |
| Students | Stash the term's worth of reading per class or per paper without losing any of it |
| Online shoppers | Save a comparison-shopping tab set, close it, revisit before buying |
| Privacy-conscious professionals | Want tab decluttering without handing a browsing snapshot to a cloud account |
| Anyone mid-context-switch | "I need these 15 tabs gone right now, but not gone-gone" |

## 4. Scope — V1

### In scope

- **Stash all tabs (or a selection)** in the current window into a named, timestamped collection.
  Each stashed tab keeps its title, URL and favicon reference.
- **Optional close-after-stash.** Stashing can close the stashed tabs immediately after saving, but
  only behind a clear, deliberate confirmation — this reads as "I meant to do that," never as an
  accidental mass-close of a browser window.
- **A side panel** listing every stash: name, tab count, notes, created date, searchable.
- **Restore.** Reopens a stash's tabs — all at once, or one tab at a time from the stash's detail
  view. Restoring never deletes the stash; a stash is a record, not a one-time-use ticket.
- **Search** across every stashed tab's title and URL, across all stashes at once.
- **Export**, per stash or for everything: Markdown reading list, or CSV.
- **JSON export / import (merge) / clear all** — the full data-ownership set, same pattern as every
  other product in this portfolio.
- **Notes per stash** — free text, e.g. "research for Q3 project."

### Out of scope

- No cloud sync across devices or browsers. Export/import is the cross-device story.
- No automatic or scheduled stashing. Every stash is a deliberate, user-triggered action.
- No duplicate-tab detection across the whole browsing history — only within what's explicitly
  stashed. This is not a history tool.

## 5. Where the data comes from — read before committing

This extension uses the `tabs` API to read the current window's open tabs — titles, URLs and favicon
references — **only when the user explicitly triggers a stash action.** It never reads tab content,
never injects into a page, and never runs in the background scanning tabs the user hasn't asked
about. There is no polling, no `alarms`, no listener that fires without a user gesture behind it.

This is a **low-technical-risk product.** Unlike the platform-specific extensions in this portfolio,
there is no DOM to scrape and no site redesign that can break it — `chrome.tabs` is a stable,
first-party browser API, not a page's markup. Say that plainly in the listing: this is one of the
simplest, most durable builds in the set.

## 6. Non-functional requirements

| Requirement | Target |
| :-- | :-- |
| Permissions | `tabs`, `storage`, `downloads`, `sidePanel` — nothing else |
| Host permissions | None. This extension never injects a content script into any page, so it needs no `activeTab`, no `scripting`, and no host-permission entry at all |
| Stash created → visible in panel | < 200 ms for a 50-tab window |
| Restore initiated → first tab open | < 300 ms; remaining tabs open in responsible batches (§7) |
| Search | Live-filters as you type, no perceptible lag up to 2,000 stashed tabs |
| Storage | Warn at 80% of `chrome.storage.local` quota, with a one-click export |
| Privacy | No network requests of any kind — verifiable in devtools, same standard as every other extension here |

`tabs`-only, zero host permissions, is about as minimal as a tab-management tool can get. Every other
cross-platform extension in this portfolio needs at least `activeTab` or a host permission to read a
page; this one needs neither, because it never looks at a page — only at the browser's own tab list.
Worth calling out explicitly in the store listing as a portfolio-wide discipline example.

## 7. Edge cases

- **Pinned tabs.** Decision: pinned tabs are **excluded by default** from "stash all tabs," since a
  pinned tab is usually a persistent utility (email, calendar, a chat app) the user did not mean to
  sweep up and close. They remain individually selectable in the tab picker for anyone who does want
  to stash one. This is documented in the panel copy, not left to be discovered by accident.
- **Tabs with no title yet (still loading).** Stash the URL regardless; use the URL (or "Untitled
  tab") as a placeholder title rather than blocking the stash action on a slow page.
- **Restoring a stash with 50+ tabs.** Batch-open in groups (8 at a time, with a short pause between
  batches) so the browser and any per-window tab limits stay responsive. Restoring anything above 15
  tabs at once shows a one-line confirmation ("This opens 47 tabs — continue?") before proceeding;
  below that threshold, restore happens immediately, since a moment's undo-friction on every restore
  would make the core loop feel heavy.
- **A stashed URL that 404s or has changed dramatically since capture.** Restore it anyway. This
  extension is not a link checker — it is the user's own historical record of what was open, and
  silently dropping or warning about a dead link on every restore would be noise, not help.

## 8. Success metrics (30 / 90 day)

| Metric | 30d checkpoint | 90d "keep investing" bar |
| :-- | :-- | :-- |
| Installs | 250 | 2,500 |
| 7-day retention | 30% | 40% |
| Users who create ≥ 1 stash | 65% | 75% |
| Users who restore ≥ 1 stash | 35% | 50% |
| Users who export ≥ 1 time | 20% | 30% |
| Store rating | ≥ 4.3 | ≥ 4.5 |

Restore rate matters more than stash rate here: a tool that only ever accumulates stashes nobody
reopens is a tab graveyard, not a workflow tool. Watch the stash-to-restore ratio as the real health
signal.

**Instrumented events (local counters only, no PII, no network):** stash created, tabs closed on
stash, panel opened, stash restored (all), tab restored (single), search used, export by format,
data exported, data imported.

## 9. Kill criteria

Under 400 installs at 90 days, **or** stash-creation rate under 40% of installs → stop investing. A
low creation rate signals the first-run experience failed to explain a genuinely simple product —
more features won't fix that; the listing or the first-open flow needs to.

## 10. Open questions

- **Auto-naming.** A default stash name like "12 tabs — Sep 2, 3:14 PM" removes the one bit of
  friction (typing a name) that could stop someone mid-declutter. Worth deciding before build: default
  to an auto-name the user can edit inline, rather than a required text field that blocks the action.
- **Cross-window stashing.** V1 scope is the current window only (§4). Whether "stash every window"
  belongs in V1 or V2 is worth revisiting once the single-window flow is built — it's a small
  extension of the same `tabs.query` call, but it changes the mental model from "this window" to
  "everything," which deserves its own confirmation language if added.
- **Favicon persistence.** Favicons are stored as the URL Chrome already exposes on the tab object,
  not as downloaded image data — cheap and local, but they can go stale or break if a site changes its
  icon. Acceptable for V1; not worth solving further unless reviews flag it.
