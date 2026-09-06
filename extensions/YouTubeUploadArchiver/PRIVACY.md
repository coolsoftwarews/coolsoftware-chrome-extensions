# Privacy Policy — YouTube Upload Archiver

**Last updated:** 2026-09-06

## The short version

This is not a video downloader, and it makes no network requests of its own beyond one: saving a
thumbnail **image** — a static picture, never the video stream — when you click Archive. Nothing you
archive, search or export is ever sent anywhere else, because there is nowhere for it to be sent —
there is no server, no account and no analytics service behind this product.

## What is stored, and where

Everything is stored in your browser's own local storage (`chrome.storage.local`) on this device,
built only from what YouTube or YouTube Studio has already rendered on a video you clicked Archive on:

| Data | Why |
| :-- | :-- |
| The video's title, description, publish date, and view/like counts, exactly as displayed | The archived record itself |
| The thumbnail image's URL, and the image file once downloaded | Shown in the popup's list, and saved to your Downloads folder under a dedicated subfolder |
| The channel key (id or handle) confirmed as your own at archive time | Kept with the record, not re-checked on read |

## What is never collected, and never touched

No account, email address or name. No browsing history beyond the one video page you archived from.
**No video stream, in any form.** This extension never requests, parses or reconstructs a video's
signed streaming URLs — the domain YouTube serves actual video bytes from (`googlevideo.com`) is never
contacted, referenced, or built into a request anywhere in this extension's source. That absence is
enforced structurally, not just claimed: `npm run test` greps every file under `src/` for that domain
and fails the build if it's ever present. No advertising or tracking identifiers. Nothing is sold,
shared or transmitted.

## Why a video downloader wouldn't be safe to ship, and isn't what this is

YouTube's real video stream is served from fragmented, signed CDN URLs that aren't meant to be consumed
outside YouTube's own player — reconstructing that stream is a Terms of Service problem regardless of
who owns the video. YouTube Studio already provides the correct, sanctioned way to get the file: a
Download action on any video you own (Content → a video → the ⋮ menu). This extension's "Open in
YouTube Studio" link takes you to that video's Studio page, one click short of Download — it gets you
to the door, never through it.

## The ownership gate

The Archive button only ever appears when the channel being viewed is confirmed to be your own
signed-in account's channel — read from YouTube's own account-switcher menu, or from YouTube Studio's
own channel-identity element. If that can't be confirmed, no button appears, on any channel, including
one you might actually own but that this extension couldn't verify. This extension never archives
someone else's catalog.

## Permissions, and what each is for

| Permission | Why it is needed |
| :-- | :-- |
| Host access to `*://*.youtube.com/*` | Reading a channel's own "Videos" tab and Studio's own Content dashboard (`studio.youtube.com` is a subdomain of `youtube.com`, so this one pattern covers both) — the only sites this extension acts on. |
| `activeTab` | Identifying the tab the Archive click and the ownership check act on. |
| `storage` | Saving your archived records locally. |
| `downloads` | Saving the thumbnail image, and the file when you export CSV, Markdown or JSON. |

## Your data is yours

**Export CSV / Markdown / JSON** in the popup writes your whole archive to a file on your device.
**Clear all data** deletes every archived record immediately and permanently. There is no import in
this product — an archive is rebuilt by re-visiting your own videos, not restored from a file.

Because storage is local and per-device, uninstalling the extension or clearing your browser data
removes your archive. Export a copy first if you want to keep it.

## Verifying this yourself

Open devtools on YouTube or YouTube Studio with the extension active and watch the Network tab — the
only request you'll see that YouTube/Studio wasn't already going to make is the thumbnail image
download itself, triggered only when you click Archive. The source is auditable: no `fetch`,
`XMLHttpRequest`, `WebSocket` or `sendBeacon` call exists anywhere in it, and no reference to the video-
streaming CDN domain exists anywhere under `src/` — both are enforced by a grep-based check on every
`npm test` run, not just claimed here.

## Contact

Questions about this policy: raise an issue on the extension's support page.
