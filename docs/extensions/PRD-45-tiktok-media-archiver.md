# PRD — TikTok Own-Post Media Archiver

**Status:** Draft for build
**Owner:** Gabriel
**Date:** 2026-09-06
**Type:** Chrome extension (MV3), standalone Web Store listing
**Platform:** TikTok
**Backend:** None · **Accounts:** None · **Payments:** None

---

## 1. One-line proposition

Save your own posted TikToks to your device without the export watermark TikTok's own "Save video" leaves on them.

## 2. Why this is worth building given TikTok already has a Save button

TikTok's native share-sheet "Save video" exists, but the file it produces is burned with TikTok's watermark and username overlay — fine for re-sharing, useless as a clean master copy. Creators re-editing, re-cutting for another platform, or just keeping an original-quality personal archive need the file TikTok's own player already loaded into the page, before any export/watermarking step touches it. That's what this extension saves — restricted, same as every other extension in this batch, to posts the logged-in account itself authored. It is not a way to strip watermarks from anyone else's video; the ownership gate in §5 is what keeps it that.

## 3. Target user

| Segment | Job |
| :-- | :-- |
| Creators repurposing their own content | Get a clean master file of their own video to re-cut or re-upload elsewhere |
| Anyone who lost their original edit | Recover their own posted video without TikTok's watermark baked in |

## 4. Scope — V1

### In scope

- A **Save (original)** button on a post's action rail, shown only when the ownership check (§5) confirms the logged-in account authored it.
- Saves the video source the page's own player already loaded (`chrome.downloads.download()` against that URL) — the same file TikTok streamed to render the post, not a re-encode.
- A local log (`chrome.storage.local`): post URL, date, saved filename. Export CSV/JSON, clear-all.
- Filename convention: `tiktok-<handle>-<post-id>.mp4`.

### Explicitly NOT in scope

- **Any post not authored by the logged-in account** — no toggle, no exception; see §5.
- **Slideshow/photo posts** are a V2 candidate once the video path is proven; V1 is video-only.
- **Live replays.** Different content type, different consent/retention rules on TikTok's side; out of scope.
- **Any account action** — no posting, no editing, read-only against the DOM.

## 5. The ownership gate — read before building

Same non-negotiable shape as PRD-44 (Instagram) and PRD-46 (X):

1. Read the logged-in account's own handle from TikTok's own nav ("Profile" link, which resolves to `/@<own-handle>`).
2. Read the post's author handle from the post's own byline.
3. Save only renders on a match, case-insensitive. No match — or no confirmed logged-in handle at all — means no button. Fail closed.

## 6. Non-functional requirements

| Requirement | Target |
| :-- | :-- |
| Permissions | `activeTab`, `downloads`, `storage` + host permission `*://*.tiktok.com/*`. No `<all_urls>`, no `tabs` |
| Privacy | No network requests beyond the download itself |
| Ownership check | Re-evaluated per post render; TikTok's feed is virtualized/infinite-scroll like every other platform in this portfolio |
| Storage | Log only, never the media itself |
| Foreground only | No background crawling of the user's own profile |

## 7. Edge cases

- **Video source unavailable at save time** (still buffering, or TikTok serves a lower-res preview before the full source loads) — the button waits for a real source URL rather than saving a low-quality placeholder; if none appears within a short bound, it says so rather than silently saving nothing.
- **Deleted-after-logging posts** — log entry persists; already-saved file is unaffected.
- **Multi-account switch mid-session** — re-check live per render, same as PRD-44 §7.

## 8. Success metrics (30 / 90 day)

| Metric | 30d | 90d |
| :-- | :-- | :-- |
| Installs | 150 | 1,200 |
| Users who save ≥ 1 item | 65% | 75% |
| 7-day retention | 20% | 30% |

## 9. Kill criteria

Under 200 installs at 90 days, or fewer than 40% of installs ever clicking Save.

## 10. Open questions

- **Does "no watermark" need to be the headline claim on the store listing**, or does it read as inviting exactly the misuse (stripping watermarks from others' videos) the ownership gate exists to prevent? Lead the listing with "your own videos," not with "no watermark," and let the gate itself do the restricting.
