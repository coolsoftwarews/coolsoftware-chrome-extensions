# PRD — Instagram Creator Research Saver

**Status:** Draft for build
**Owner:** Gabriel
**Date:** 2026-08-15
**Type:** Chrome extension (MV3), standalone Web Store listing
**Platform:** Instagram
**Backend:** None · **Accounts:** None · **Payments:** None
**Pair:** [Instagram Content Outlier Finder](PRD-06-instagram-outlier-finder.md) — that one tests intelligence, this one tests workflow.

---

## 1. One-line proposition

A swipe file built into Instagram: save any post to a collection with its numbers and your note, then export the lot.

## 2. The hypothesis

**Will marketers pay for workflow?** Instagram's own "Save" is a bookmark with no context — no numbers, no note, no export, and it's stuck inside the app. The claim is that the missing piece isn't storage, it's *structured* capture: the post plus why you saved it plus the metrics at the time you saw it.

Read this result against its pair. Same platform, same buyer, different problem class. That comparison is the actual experiment.

## 3. Target user

| Segment | Job |
| :-- | :-- |
| Creators | Build a hook/idea file from what's working |
| Agencies | Collect reference for a client pitch |
| Marketers | Track competitor angles over a campaign |
| Freelancers | Assemble a mood board that survives leaving the app |

## 4. Scope — V1

### In scope

**Save button** injected on posts and Reels (grid hover and detail view):

```
+ Save to Research
```

Captures, at the moment of saving:

| Field | Source |
| :-- | :-- |
| Creator handle | Page |
| Post URL | Page |
| Thumbnail | Post image (stored as a size-capped data URI) |
| Views / likes / comments | Whatever the page exposes |
| Caption | Post |
| Post date | Post |
| Saved date | Now |
| My note | User, optional, inline |

**Collections.** Ships with four, all renameable, plus "new collection":
`Hooks` · `Competitors` · `Ad Ideas` · `Reel Ideas`

**Library panel** (side panel, opened from the toolbar icon)
- Cards grouped by collection, newest first
- Search across caption, handle and note
- Move between collections, edit note, delete
- Click through to the original post

**Export**
- **CSV** — one row per saved post, every field above
- **Markdown** — one section per post: thumbnail, handle, numbers, caption, note, link
- **JSON** — full backup, re-importable

**Data ownership.** Export all / import / clear all. Non-negotiable: this is a research file someone builds over months, in browser storage. Warn at 80% of quota with a one-click export.

### Explicitly out of scope for V1

No account, no sync, no cloud, no backend. No AI captioning, scoring or "why this worked". No scheduling or posting. No team sharing. No auto-capture of anything the user didn't explicitly save. No mobile.

## 5. Relationship to SavePosty — decide before building

SavePosty is the cloud library with an account: sync, search across everything, RAG over the collection. This is deliberately the opposite: a local, Instagram-only swipe file that exits through a file.

If V1 scoping starts wanting sync, cross-platform saving and a web dashboard, then it isn't a separate product — it's SavePosty's Instagram clipper, and it should ship inside SavePosty. **Revisit at the end of V1 scoping, not after launch.** Thumbnail storage is the smell to watch: the moment images need a server, this has become SavePosty.

## 6. Where the data comes from

Only what Instagram has rendered for the logged-in user in the current tab, at the moment they click Save. No API calls, no background crawling, no write actions against the account. Thumbnails are re-encoded to ~320px WebP data URIs to keep a 500-item library inside `chrome.storage.local`; if that budget doesn't hold, store the remote thumbnail URL and accept that some images rot — but tell the user that's what happens.

## 7. Non-functional requirements

| Requirement | Target |
| :-- | :-- |
| Save → confirmation | < 200 ms, no navigation away from the post |
| Library panel with 500 items | Opens < 500 ms, scrolls smoothly |
| Permissions | `activeTab`, `storage`, `downloads` + `*://*.instagram.com/*` |
| Storage | Warn at 80% quota; thumbnails capped; per-item budget documented |
| Privacy | No network requests of any kind |

## 8. Edge cases

- Carousels (save which slide? — save the first, note the count)
- Posts with no visible view count
- Saving the same post twice (update, don't duplicate)
- Very long captions (store in full, truncate in the card)
- Deleted or private posts in an old collection — the card keeps working, the link may not; say so
- Instagram DOM rewrites breaking the injected button
- Storage quota reached mid-save — fail loudly with an export prompt, never drop the item silently

## 9. Success metrics (30 / 90 day)

| Metric | 30d | 90d |
| :-- | :-- | :-- |
| Installs | 200 | 2,000 |
| 7-day retention | 30% | 40% |
| Users who save ≥ 3 posts | 45% | 60% |
| Users who create/rename a collection | 25% | 35% |
| Export used ≥ once | 25% | 35% |
| Median saves per active user / week | 4 | 10 |

Retention and saves-per-week matter most: a swipe file is a habit, and a habit that doesn't form is a dead product regardless of installs.

## 10. Kill criteria

Under 300 installs at 90 days, **or** fewer than 30% of installs saving a single post. The second number failing means the value wasn't legible on the page — a positioning failure that more collections won't fix.

## 11. Open questions

- **Note-first or save-first?** Prompting for a note at save time gets richer data but adds friction to the one action that must be frictionless. Default to save-first with an inline note field; measure how many notes get written.
- **Does CSV or Markdown dominate?** CSV means these people live in spreadsheets and the V2 is more columns. Markdown means they live in Notion/Obsidian and the V2 is integrations.
- **Collections vs. tags.** Collections are simpler and match how agencies talk. If people start naming collections like tags (`hook-ugc-fitness`), that's the signal to switch.
