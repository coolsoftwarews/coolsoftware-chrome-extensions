# PRD — X Own-Post Media Archiver

**Status:** Draft for build
**Owner:** Gabriel
**Date:** 2026-09-06
**Type:** Chrome extension (MV3), standalone Web Store listing
**Platform:** X (Twitter)
**Backend:** None · **Accounts:** None · **Payments:** None

---

## 1. One-line proposition

Save the photos and videos from **your own** posts on X to your device — X has no bulk media-download button, and the official archive tool is a slow, all-or-nothing export.

## 2. Why this one, alongside XBookmarkOrganizer and XConversationSaver

This portfolio already has two X products that save *other people's* posts as text/links (a bookmark you chose, a conversation you're saving for reference) — both explicitly read-only, never touching media files. This is the missing, narrower piece: recovering the actual media file from a post **you** posted, which X's own "Download an archive of your data" bundles into a multi-day, whole-account export rather than handing back on request. Same ownership restriction as every other archiver in this batch, enforced the same way (§5).

## 3. Target user

| Segment | Job |
| :-- | :-- |
| Creators / operators | Recover the original image or video from their own post without requesting a full account data export |
| Anyone who lost the source file | Get back a specific photo/video they already posted publicly under their own name |

## 4. Scope — V1

### In scope

- A **Save** button on a post's action row, shown only when the ownership check (§5) confirms the logged-in account authored it.
- Images (including multi-image posts, offered per-image) and video, saved via `chrome.downloads.download()` against the media URL the page already rendered.
- A local log (`chrome.storage.local`): post URL, date, media type, saved filename. Export CSV/JSON, clear-all.
- Filename convention: `x-<handle>-<post-id>-<n>.<ext>`.

### Explicitly NOT in scope

- **Any post not authored by the logged-in account** — see §5; no exception, no setting.
- **Reposts of someone else's media.** A repost is not authorship; the ownership check must key off the *original* post's author, not who reposted it into the logged-in user's timeline.
- **Quote-tweeted media that belongs to the quoted post**, not the quoting post — same distinction as above, and the reason the check reads the specific media-bearing post's own byline, not the timeline entry's outer author.
- **Bulk profile crawl.** Per-post only, same reasoning as PRD-44 §4.

## 5. The ownership gate — read before building

Same shape as PRD-44/PRD-45, with one X-specific addition (repost/quote handling above):

1. Read the logged-in account's own handle from X's own left-nav profile block (the same "logged-in identity" element XBookmarkOrganizer and XConversationSaver already read, for consistency across this platform's three extensions).
2. Read the *specific post's* author handle — for a repost, that means the original author, not the account that reposted it.
3. Save only renders on a match, case-insensitive. No match, no button. Fail closed.

## 6. Non-functional requirements

| Requirement | Target |
| :-- | :-- |
| Permissions | `activeTab`, `downloads`, `storage` + host permissions `*://*.x.com/*`, `*://*.twitter.com/*`. No `<all_urls>`, no `tabs` |
| Privacy | No network requests beyond the download itself |
| Ownership check | Re-evaluated per post render; never cached across the virtualized timeline |
| Storage | Log only, never the media itself |
| Foreground only | No background crawling |

## 7. Edge cases

- **Repost vs. original authorship**, per §4 — get this wrong and the product silently violates its own premise.
- **Deleted-after-logging posts** — log persists, saved file unaffected.
- **Video variants (multiple bitrates in one post)** — save the highest-bitrate source the page loaded, not a preview/poster frame.
- **Multi-account switch mid-session** — re-check live per render.

## 8. Success metrics (30 / 90 day)

| Metric | 30d | 90d |
| :-- | :-- | :-- |
| Installs | 150 | 1,200 |
| Users who save ≥ 1 item | 55% | 65% |
| 7-day retention | 20% | 30% |

## 9. Kill criteria

Under 200 installs at 90 days, or fewer than 35% of installs ever clicking Save.

## 10. Open questions

- **Is per-image-in-a-multi-image-post the right granularity**, or should "Save all" be a V1 affordance rather than a V2 nice-to-have? Default to per-image plus one "Save all" convenience button, since the marginal cost of the second is low once per-image extraction works.
