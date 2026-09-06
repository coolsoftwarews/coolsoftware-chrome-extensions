# PRD — X Prospect & Conversation Saver

**Status:** Draft for build
**Owner:** Gabriel
**Date:** 2026-08-15
**Type:** Chrome extension (MV3), standalone Web Store listing
**Platform:** X (Twitter)
**Backend:** None · **Accounts:** None · **Payments:** None
**Pair:** [X Velocity Finder](PRD-12-x-velocity-finder.md) — that one tests intelligence, this one tests workflow.

---

## 1. One-line proposition

Save the posts, threads and people worth coming back to — with the full thread text, your note, and an export that isn't locked in X.

## 2. The hypothesis

**Will founders and creators pay for a workflow tool on X?** X's bookmarks are a black hole: no notes, no structure, no export, and threads collapse to a single post. The claim is that structured capture — full thread, context, note, collection, export — is worth an install.

If the [Velocity Finder](PRD-12-x-velocity-finder.md) spike comes back badly, **this is the one X product we ship**, because it depends only on text the user is already reading.

## 3. Target user

| Segment | Job |
| :-- | :-- |
| Founders | Keep the threads and people relevant to the business |
| Creators | Build a swipe file of hooks and formats that worked |
| Sales | Note prospects who posted something worth replying to |
| Writers / researchers | Collect source material with context intact |

## 4. Scope — V1

### In scope

**Save control** on any post:

```
+ Save   ·   + Save thread
```

- **Save** captures one post: author, handle, text, metrics, date, link
- **Save thread** captures the whole visible thread in order — this is the feature bookmarks don't have and the reason someone installs this

**Collections.** Four defaults, all renameable: `Hooks` · `Prospects` · `Ideas` · `Reference`. Plus a note per saved item.

**People view.** Saved items grouped by author, with a `saved 6 posts from this person` count and a per-person note. That's the whole "prospect" affordance — no CRM, no pipeline, no statuses beyond a note.

**Library panel** (side panel)
- Search across text, author and note
- Filter by collection
- Click through to the original post

**Export**
- **Markdown** — a readable digest, threads rendered as threads. The primary export
- **CSV** — one row per post, for the spreadsheet users
- **JSON** — full backup, re-importable

**Data ownership:** export all / import / clear all; quota warning at 80%.

### Explicitly out of scope for V1

No account, no backend, no X API. No write actions — no posting, replying, liking, following, DMing. No auto-capture (nothing is saved that the user didn't click to save). No AI summaries of threads. No cross-platform saving (that's SavePosty — see §5). No media download beyond a thumbnail.

## 5. Relationship to SavePosty

SavePosty is the cloud library with an account: sync, cross-platform, search everything, RAG. This is a local, X-only capture tool that exits through a file.

The boundary test is the same one [PRD-05](PRD-05-web-highlighter-markdown.md#3-relationship-to-saveposty--read-this-before-building) and [PRD-07](PRD-07-instagram-research-saver.md) apply: if V1 scoping starts wanting sync, cross-platform capture and a dashboard, this is SavePosty's X clipper and belongs inside SavePosty. Decide at the end of V1 scoping.

## 6. Where the data comes from

Only what X renders for the user in the current tab, at the moment they click save. No API, no background collection, no automation. A thread is captured from what's on screen — if X hasn't loaded the whole thread, we save what's there and record `12 of 30 posts captured`, because a silently truncated thread is worse than an honest partial one.

## 7. Non-functional requirements

| Requirement | Target |
| :-- | :-- |
| Save → confirmation | < 200 ms, no navigation |
| Save a 30-post thread | < 1 s |
| Library with 2,000 items | Panel opens < 600 ms; search < 150 ms |
| Permissions | `activeTab`, `storage`, `downloads` + `*://*.x.com/*`, `*://*.twitter.com/*` |
| Privacy | No network requests |

## 8. Edge cases

- Threads that continue behind "Show more replies"
- Quote posts (save both the quote and the quoted post's text)
- Posts deleted after saving (the saved copy stands — that's the point)
- Protected accounts
- Media-only posts with no text
- Long threads with mixed authors (a conversation, not a thread — group and label it as such)
- Saving the same post twice (update, don't duplicate)
- X DOM rewrites

## 9. Success metrics (30 / 90 day)

| Metric | 30d | 90d |
| :-- | :-- | :-- |
| Installs | 200 | 2,000 |
| 7-day retention | 30% | 40% |
| Users who save ≥ 3 items | 45% | 60% |
| Users who save a thread (not just a post) | 30% | 45% |
| Export used ≥ once | 25% | 35% |
| Store rating | ≥ 4.2 | ≥ 4.4 |

Thread-save rate is the differentiator metric: if nobody uses it, we built a nicer bookmark and X already has one.

## 10. Kill criteria

Under 300 installs at 90 days, **or** under 25% of installs ever saving a thread. The second means the one thing bookmarks can't do isn't the thing people wanted.

## 11. Open questions

- **Markdown or CSV first?** Founders and writers want Markdown; sales users want CSV. Ship both, watch which dominates — the answer tells us which buyer actually showed up, which is more valuable than the export itself.
- **How much thread should "Save thread" chase?** Auto-expanding replies edges toward automation. Default to what's rendered, and let the user expand manually first.
- **Prospects in the same product as hooks.** One collection list serving both sales and content use may satisfy neither. If the collections split cleanly along that line in usage data, that's a signal to split the product.
