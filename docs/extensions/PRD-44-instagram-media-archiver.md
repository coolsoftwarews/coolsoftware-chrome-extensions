# PRD — Instagram Own-Post Media Archiver

**Status:** Draft for build
**Owner:** Gabriel
**Date:** 2026-09-06
**Type:** Chrome extension (MV3), standalone Web Store listing
**Platform:** Instagram
**Backend:** None · **Accounts:** None · **Payments:** None

---

## 1. One-line proposition

Save the photos and videos from **your own** Instagram posts to your device in one click — Instagram has no bulk "download my media" button, and this is not a tool for saving anyone else's content.

## 2. Why "your own posts only," and why that's the whole product

Instagram's Terms of Use prohibit scraping or downloading other users' content outside the app; a generic "save any post's media" extension is a copyright and ToS problem regardless of how it's marketed, and the Web Store routinely removes exactly that kind of listing. This product does something narrower and genuinely legitimate instead: **a creator's own account is the one archive Instagram doesn't hand back to them in bulk.** Instagram's official data-export tool ("Download your information") is slow (can take days), bundles everything into one dump, and re-encodes media — it is not a "grab this one photo I just posted" tool. This extension is that tool, restricted to posts the logged-in account itself authored.

That restriction is enforced in code, not just policy: see §5.

## 3. Target user

| Segment | Job |
| :-- | :-- |
| Creators / small businesses | Keep a local, original-quality backup of their own posted photos/videos without waiting on Instagram's data export |
| Anyone who lost the original file | Recover a specific post's media without requesting a full account archive |

## 4. Scope — V1

### In scope

- A **Save** button injected next to a post's existing action row (like/comment/share), visible **only** on posts the ownership check (§5) confirms belong to the logged-in account.
- Single image posts, multi-image carousels (each image offered individually), and video posts (Reels included) — saved via `chrome.downloads.download()` against the same media URL the page already loaded to display the post. No re-encoding, no re-hosting, no network request beyond the download itself.
- A small local log (`chrome.storage.local`) of what's been archived — post URL, date, media type, saved filename — so the user has a record without re-opening every post. Export as CSV/JSON. Clear-all supported.
- Filename convention: `instagram-<handle>-<post-id>-<n>.<ext>`.

### Explicitly NOT in scope

- **Any post not authored by the logged-in account.** Not gated behind a setting, not a "power user" toggle — there is no code path that offers Save on someone else's post. This is the entire premise; see §5.
- **Stories or Highlights.** Ephemeral by design and a materially different ownership/consent surface; V2 conversation at most.
- **Bulk "archive my whole profile in one click."** V1 is per-post, triggered from a post the user is already viewing — a bulk crawl of even your own profile starts to look like the automated-scraping pattern Instagram's ToS targets, regardless of whose content it is.
- **Any account-level action** — no posting, no deleting, no editing. Read-only against the DOM, same as every extension in this portfolio.

## 5. The ownership gate — read before building

This is the load-bearing design decision. The Save button must never appear on a post the logged-in account did not author, and that check happens against the DOM the page itself rendered, not the URL:

1. Read the logged-in account's own handle from Instagram's own nav (the profile icon/link in the app's own sidebar, which points at `/​<own-handle>/`) — the same "logged-in identity" signal every extension in this portfolio that needs it reads from the platform's own chrome, never from a cached/assumed value.
2. Read the post's author handle from the post's own header.
3. Save only renders if the two match, normalized case-insensitively. No match, no button — fail closed, not open.

If the logged-in handle can't be read at all (selector drift, logged out), **no post gets a Save button** — an extension that can't confirm ownership must default to doing nothing, not to trusting the URL.

## 6. Non-functional requirements

| Requirement | Target |
| :-- | :-- |
| Permissions | `activeTab`, `downloads`, `storage` + host permission `*://*.instagram.com/*`. No `<all_urls>`, no `tabs` |
| Privacy | No network requests beyond the download itself — no analytics, no telemetry endpoint |
| Ownership check | Re-evaluated per post render (Instagram is a heavily virtualized SPA); never cached across posts |
| Storage | Log only (URLs/filenames/dates), never the media itself — `chrome.storage.local` stays well under quota |
| Foreground only | No background crawling of the user's own feed or profile |

## 7. Edge cases

- **Handle changed since a post was made.** The check is against the *current* logged-in handle vs. the *current* rendered author handle on the post — both read live, so a rename doesn't break it as long as Instagram's own header reflects the new handle consistently.
- **Multi-account (switched profiles in the same browser session).** Re-check on every render; never assume the account that was logged in a minute ago still is.
- **Carousel with mixed media types.** Offer Save per slide, not one button for the whole post.
- **Post deleted after being logged locally.** The log entry keeps its record; the saved file is unaffected either way since it already lives on disk.

## 8. Success metrics (30 / 90 day)

| Metric | 30d | 90d |
| :-- | :-- | :-- |
| Installs | 150 | 1,200 |
| Users who save ≥ 1 item | 60% | 70% |
| 7-day retention | 20% | 30% |

## 9. Kill criteria

Under 200 installs at 90 days, or fewer than 40% of installs ever clicking Save — the second would mean the ownership-gated framing found the wrong audience (people expecting to save others' posts, bouncing off a locked-down tool that won't do that).

## 10. Open questions

- **Should the log's export include a re-import path**, matching the portfolio's Saver pattern, or is a log genuinely disposable here since the real artifact is the downloaded file itself, not the log? Default to export-only (no import) until a real user asks to restore a log on a new machine.
