# PRD — YouTube Own-Upload Archiver (thumbnail + metadata only)

**Status:** Draft for build
**Owner:** Gabriel
**Date:** 2026-09-06
**Type:** Chrome extension (MV3), standalone Web Store listing
**Platform:** YouTube
**Backend:** None · **Accounts:** None · **Payments:** None

---

## 1. One-line proposition

Archive the thumbnail, title, description and stats of your own YouTube uploads to a local, searchable log — without touching the actual video stream.

## 2. Why this one deliberately does not download the video file

The other three archivers in this batch (Instagram, TikTok, X) save media the browser already loaded to render the post — the same thing "right-click → Save As" does, just gated to the logged-in account's own content. YouTube doesn't work that way: the real video stream is served from fragmented, signed `googlevideo.com` URLs that aren't meant to be consumed outside the player, and reconstructing that stream is a ToS problem regardless of who owns the video. YouTube already has the correct fix for creators: **Studio has an official Download button for videos you own** (Content → a video → the ⋮ menu). This product doesn't re-solve a problem YouTube's own tooling already solves correctly — it solves the adjacent one Studio doesn't: a fast, local, searchable record of a channel's own upload history (thumbnail, title, description, stats, publish date), built for someone reviewing or auditing their own catalog, not extracting a specific file.

## 3. Target user

| Segment | Job |
| :-- | :-- |
| Creators auditing their own catalog | Search/skim years of their own upload titles, descriptions and stats without opening Studio's slower per-video views |
| Anyone drafting a portfolio or press kit | Pull thumbnails + metadata for their own videos into one exportable list |

## 4. Scope — V1

### In scope

- On the logged-in user's own channel/Studio pages, an **Archive** action per video that logs: video URL, title, description, publish date, view/like counts as currently displayed, and the thumbnail **image** (a static image asset, `i.ytimg.com/vi/<id>/...jpg` — not the video stream) saved via `chrome.downloads.download()`.
- A local log (`chrome.storage.local`), searchable client-side by title/description text. Export CSV/Markdown/JSON, clear-all.
- A one-click link to that video's Studio Download page, so the actual video file is one more click away through YouTube's own sanctioned path — this extension gets the user to the door, not through it.

### Explicitly NOT in scope, permanently (not a V1 limit)

- **The video file itself, in any form.** No stream reconstruction, no `googlevideo.com` requests, no format/quality picker for the video. This is the one hard line in this PRD — see §2.
- **Any channel that isn't the logged-in account's own.** Same ownership gate shape as the other three archivers (§5), even though the object here is metadata rather than a media file — auditing someone else's catalog without their involvement is the same overreach, just against different data.
- **Bulk crawl of the whole catalog in one action.** Per-video (or per-visible-batch on a channel's own uploads listing), user-triggered — not a background scrape of upload history.
- **Comments, analytics dashboards, or monetization data.** Out of scope; this is a catalog record, not a Studio replacement.

## 5. The ownership gate — read before building

Lighter than the media archivers' version (no media file is ever touched), but still required:

1. Confirm the channel being viewed is the logged-in account's own channel — read from YouTube's own account-switcher UI or Studio's own channel-identity element (whichever page the Archive action is offered on), the same "don't trust the URL alone" rule as PRD-44/45/46.
2. Archive only renders on a confirmed match. No confirmed identity, no button.

## 6. Non-functional requirements

| Requirement | Target |
| :-- | :-- |
| Permissions | `activeTab`, `downloads`, `storage` + host permission `*://*.youtube.com/*`. No `<all_urls>`, no `tabs` |
| Privacy | No network requests beyond the thumbnail-image download itself |
| Storage | Log entries only; thumbnails saved to disk via `chrome.downloads`, never held as blobs in `chrome.storage.local` |
| Foreground only | No background crawling of the channel's upload history |

## 7. Edge cases

- **Unlisted/private videos** on the owner's own channel — archiving still requires the ownership check to pass; visibility state doesn't change the gate, only what's visible to archive in the first place (the owner can already see their own unlisted/private videos).
- **Thumbnail not yet generated** (just-published video) — the archive log records the metadata immediately and retries the thumbnail save, rather than blocking the whole entry on one missing asset.
- **Title/description edited after archiving** — the log keeps the snapshot from archive time; re-archiving the same video updates it in place (same "update, don't duplicate" rule as every Saver in this portfolio), it does not create a second entry.

## 8. Success metrics (30 / 90 day)

| Metric | 30d | 90d |
| :-- | :-- | :-- |
| Installs | 100 | 800 |
| Users who archive ≥ 1 video | 55% | 65% |
| 7-day retention | 15% | 25% |

## 9. Kill criteria

Under 150 installs at 90 days, or fewer than 30% of installs archiving anything — the second would likely mean people installed expecting a video downloader despite the listing, and bounced off finding out it deliberately isn't one.

## 10. Open questions

- **Should the store listing say "not a video downloader" explicitly**, given how many search queries in this category expect exactly that? Yes, plainly, in the first two lines — the same honesty-over-conversion call this portfolio already makes elsewhere (README.md, portfolio-wide constraints) rather than let an install bounce on discovering the restriction after the fact.
