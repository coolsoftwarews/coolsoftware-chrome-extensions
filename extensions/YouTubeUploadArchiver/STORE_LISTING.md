# Chrome Web Store listing — YouTube Upload Archiver

**This is not a video downloader.** It archives a thumbnail image and text metadata for your own
uploads — never the video file itself. If you're looking for a tool to download a YouTube video, this
isn't it; use YouTube Studio's own Download button (Content → a video → the ⋮ menu), which this
extension links straight to.

## Name

`YouTube Upload Archiver`

## Single purpose

> Archive the thumbnail image, title, description, publish date and displayed view/like counts of the
> user's own YouTube uploads to a local, searchable log, gated to channels confirmed as the signed-in
> account's own. Never downloads, requests or reconstructs the video stream in any form.

## Short description (132 char max)

`Archive your own YouTube uploads' thumbnail + metadata to a local log. Not a video downloader — links to Studio's Download page.`

## Category

Productivity → Workflow & Planning

## Detailed description

**Not a video downloader.** This is a catalog tool for your own YouTube channel — it saves a
thumbnail image and the metadata already displayed on your own uploads (title, description, publish
date, view/like counts) to a searchable local log, and links straight to that video's page in YouTube
Studio, where YouTube's own Download button already lives. It never requests, parses or reconstructs
the actual video stream, for any video, even ones you own.

**Why draw the line there?** YouTube's real video stream is served from signed CDN URLs that aren't
meant to be consumed outside YouTube's own player — reconstructing that stream is a ToS problem no
matter who owns the video. Studio already solves "get the file" correctly. This solves the adjacent
problem Studio doesn't: a fast, searchable record of your own catalog, without opening Studio's slower
per-video views one at a time.

**One click, on your own channel only**

Open your channel's own "Videos" tab, or your Content list in YouTube Studio, and an Archive button
appears next to each video — but only once this extension has confirmed, from YouTube's own
account-switcher or Studio's own channel-identity element, that you're looking at your own channel.
No confirmed match, no button. It never archives anyone else's catalog.

**A searchable record of your catalog**

Every archive is a local entry: thumbnail, title, description, publish date, and view/like counts
exactly as YouTube displayed them at the time. Search across title and description in the popup.
Editing a video's title or description later and archiving it again updates that same entry — it
never creates a duplicate.

**Get it out**

- **CSV** — one row per video, for a spreadsheet.
- **Markdown** — a readable catalog digest.
- **JSON** — a full backup of your archive.

**No account. No cloud. No video stream, ever.**

This extension makes exactly one kind of network-touching request: saving the thumbnail image you
clicked Archive for. No `fetch`, `XMLHttpRequest`, `WebSocket` or `sendBeacon` call exists anywhere in
its source, and no reference to YouTube's video-streaming CDN domain exists anywhere in it either —
both enforced by an automated check on every build, not just claimed in this listing.

**Built for**

Creators auditing their own upload history without waiting on Studio's slower per-video views.
Anyone assembling a portfolio or press kit who needs thumbnails and metadata for their own videos in
one exportable list.

**What it doesn't do**

It never downloads a video file, never offers a format/quality picker, and never archives a channel
that isn't confirmed as your own. It never crawls a whole catalog in the background — every archive is
a single click on a video already on screen.

## Permission justifications (for review)

| Permission | Justification |
| :-- | :-- |
| Host `*://*.youtube.com/*` | Reading a channel's own "Videos" tab and Studio's own Content dashboard — `studio.youtube.com` is a subdomain of `youtube.com`, so this one host pattern covers both pages this extension acts on. No other site is accessed, and no video stream is ever requested from this domain or any other. |
| `activeTab` | Identifying the active tab the Archive action and the ownership check target. |
| `storage` | Persisting the user's archived records locally. |
| `downloads` | Saving the thumbnail image, and the CSV/Markdown/JSON export file the user requests. |

**Not requested:** `tabs`, `scripting`, `sidePanel`, `<all_urls>`. The content script is declared
against the host permission above; the popup calls `chrome.downloads` directly for exports, and the
one thumbnail-image download is relayed through the background worker because it's triggered from the
content script.

**Remote code:** none. All code is bundled in the package; no eval, no remote scripts.
**Data usage disclosures:** none of the categories apply — no data is collected or transmitted, beyond
the one thumbnail-image download itself.

## Screenshots (1280×800)

1. A channel's own "Videos" tab with the Archive button visible next to a video tile
2. YouTube Studio's Content table with the Archive button visible next to a row
3. The popup: an archived entry's thumbnail, title, stats, and the Watch / Open in Studio links
4. Search in the popup, filtered to a keyword from a title
5. The export buttons and "Clear all data" control

## Support and privacy links

- Privacy policy: publish [PRIVACY.md](PRIVACY.md) at a stable URL
- Support: repository issues page
