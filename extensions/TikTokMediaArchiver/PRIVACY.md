# Privacy Policy — TikTok Media Archiver

**Last updated:** 2026-09-06

## The short version

This extension makes no network requests of its own. The only thing that ever leaves your browser
is the download itself — the video file TikTok's own player already loaded into the tab, written to
your device by Chrome's own download manager. There is no server, no account and no analytics
service behind this product.

## What is stored, and where

Everything is stored in your browser's own local storage (`chrome.storage.local`) on this device,
only when you click **Save (original)** on a post:

| Data | Why |
| :-- | :-- |
| The post's URL, the author's handle, the post id, the saved filename, and the date it was saved | The local save log described in the store listing — a record of what was saved, never the media itself |

**The video file is never stored inside the extension.** It is written straight to your Downloads
folder (or wherever Chrome's download settings send it) via `chrome.downloads.download()`. This
extension keeps no copy of it anywhere.

## What is never collected

No account, email address or name. No browsing history beyond the log entries above. No TikTok
credentials or session data — this extension reads the page the same way you do, through your
existing logged-in session, and never touches your account (no posting, liking, following, or any
other write action). No advertising or tracking identifiers. Nothing is sold, shared or transmitted,
because nothing is transmitted at all.

## The ownership gate — the core of this product's privacy and safety posture

**Save (original) only ever appears on a post the logged-in TikTok account itself authored.** This
extension reads the logged-in account's own handle from TikTok's own nav ("Profile" link, resolving
to `/@<own-handle>`), reads the post's author handle from the post's own byline, and shows the button
only when the two match, case-insensitively. If either handle can't be confidently read, no button
is shown at all — the check fails closed, never open. There is no setting, toggle or exception that
offers Save on someone else's video, and there never will be: this is what keeps the extension a
personal-archive tool rather than a way to strip watermarks from other people's content.

## Permissions, and what each is for

| Permission | Why it is needed |
| :-- | :-- |
| `activeTab` | Lets the toolbar icon or the keyboard shortcut reach the tab you're looking at, to toggle the on-page saved-videos log |
| `storage` | Saving your local log of what's been saved |
| `downloads` | Writing the video file, and the CSV/JSON export of your log, to disk |
| Host access to `*://*.tiktok.com/*` | The extension's entire function — reading the logged-in handle, a post's author handle, and the video source the player loaded — happens on tiktok.com. No other site is accessed. |

## Your data is yours

The saved-videos log's **Export CSV** / **Export JSON** buttons write your entire log to a single
file. **Clear all** deletes every log entry immediately and permanently — the video files you've
already downloaded are unaffected either way; this extension only ever manages the log, never the
files themselves.

Because storage is local and per-device, uninstalling the extension or clearing your browser data
removes your log (not your already-downloaded videos). Export a backup first if you want to keep it.

## Verifying this yourself

Open devtools on tiktok.com with the extension active and watch the Network tab — you will see no
requests from the extension beyond the download itself. The source is auditable: no `fetch`,
`XMLHttpRequest`, `WebSocket` or `sendBeacon` call exists anywhere in it (enforced in `npm test`).

## Contact

Questions about this policy: raise an issue on the extension's support page.
