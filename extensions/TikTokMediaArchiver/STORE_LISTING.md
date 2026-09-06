# Chrome Web Store listing — TikTok Media Archiver

## Name

`TikTok Media Archiver`

## Single purpose

> Let a TikTok creator save the videos they themselves posted, in the original quality their own
> browser already loaded — never any other creator's video — and keep a local log of what's been
> saved, exportable as CSV or JSON.

## Short description (132 char max)

`Save your own posted TikToks in original quality. Ownership-gated to your own videos only. Local log, CSV/JSON export. No account.`

## Category

Productivity → Workflow & Planning

## Detailed description

**Get a clean copy of your own videos.**

TikTok Media Archiver adds a **Save (original)** button to your own posts — the ones you posted,
under your own account, nothing else. Click it and the video file your own browser already loaded to
play the post is written straight to your device via Chrome's download manager, filed as
`tiktok-<your-handle>-<post-id>.mp4`.

**Why this is different from TikTok's own "Save video."** TikTok's built-in export burns its own
watermark and username overlay onto the file — fine for re-sharing, useless as a clean master copy.
This extension saves the source the player itself loaded, before any export step touches it, so
you get your own footage back in the quality you posted it.

**Your own videos, and only your own videos.** Before the button ever appears, this extension
checks that the logged-in account's own handle (read from TikTok's own "Profile" nav link) matches
the post's own author byline, case-insensitively. No match, or no confirmed login at all, means no
button — full stop. There is no setting anywhere that offers this on someone else's video. This
extension is a personal-archive tool for creators reclaiming their own footage, not a way to strip
watermarks off content that isn't yours.

**A simple local log.** Every save is recorded — post URL, handle, post id, filename, date — in a
small on-page log (toolbar icon or Alt+Shift+S to open it). Export the whole thing as CSV or JSON,
or clear it, any time.

**No account. No cloud. No network.**

This extension makes no network requests beyond the download itself — verifiable in devtools in
about ten seconds. The log lives in your browser's local storage; nothing is ever transmitted.

**Built for**

Creators repurposing their own content for another cut or another platform. Anyone who lost their
original edit and needs their own posted video back without a watermark baked in.

## Permission justifications (for review)

| Permission | Justification |
| :-- | :-- |
| `activeTab` | Lets the toolbar icon or keyboard shortcut reach the active tab, to toggle the on-page saved-videos log. |
| `storage` | Persisting the local save log (post URL, handle, post id, filename, date). |
| `downloads` | Writing the saved video file and the CSV/JSON log export the user requests. |
| Host `*://*.tiktok.com/*` | The extension's entire function — reading the logged-in handle, a post's author handle, and the video source the player loaded, and rendering the Save button — happens on tiktok.com. No other site is accessed, and no data leaves the device except the download itself. |

**Remote code:** none. All code is bundled in the package; no eval, no remote scripts.
**Data usage disclosures:** none of the categories apply — no data is collected or transmitted.

**Test instructions for the reviewer**

> Log in to a TikTok account and open one of that account's own posted videos. A "Save (original)"
> button appears once the ownership check confirms authorship. Open a video posted by a *different*
> account — no button appears anywhere on the page. Click the toolbar icon to open the saved-videos
> log and try Export CSV / Export JSON / Clear all.

## Screenshots (1280×800)

1. A creator's own video with the "Save (original)" button visible
2. Another creator's video, side by side, with no Save button present
3. The saved-videos log open, showing a few entries
4. A CSV export open in a spreadsheet beside the log
5. The filename convention visible in a Downloads folder listing

## Support and privacy links

- Privacy policy: publish [PRIVACY.md](PRIVACY.md) at a stable URL
- Support: repository issues page
