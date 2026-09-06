# YouTube Upload Archiver

**This is not a video downloader.** It never touches YouTube's video stream, never builds a
format/quality picker, and never reconstructs a playable file — for any video, even ones you own.
What it archives is a thumbnail **image** (a static asset, not the stream) and text metadata — title,
description, publish date, and view/like counts as currently displayed — for your own uploads, into a
local, searchable log. A one-click link takes you to that video's page in YouTube Studio, where
YouTube's own Download action already lives.

Chrome MV3 extension. Built from
[PRD-47](../../docs/extensions/PRD-47-youtube-upload-archiver.md). No backend, no accounts, no
analytics leaving the device.

## Why this one deliberately doesn't download the video file

YouTube serves the real video stream from fragmented, signed CDN URLs that aren't meant to be
consumed outside the player — reconstructing that stream is a ToS problem regardless of who owns the
video. YouTube Studio already has the correct, sanctioned fix for creators: a Download button on any
video you own (Content → a video → the ⋮ menu). This extension doesn't re-solve a problem Studio
already solves correctly. It solves the adjacent one Studio doesn't: a fast, local, searchable record
of a channel's own upload history, for someone auditing or referencing their own catalog — not
extracting a specific file. See [PRD-47 §2](../../docs/extensions/PRD-47-youtube-upload-archiver.md#2-why-this-one-deliberately-does-not-download-the-video-file).

## Quick start

```bash
npm install
npm run icons          # regenerate src/icons/*.png (no image dependency)
npm run build          # dev build into dist/
npm run build:watch    # rebuild on change
npm run build:prod     # minified, production manifest name
npm test               # headless checks — parsing, ownership gate, exports, the stream guardrail
npm run typecheck
npm run zip            # production build + dist/ packed for the Web Store
```

Node 18+ is required. Load it: `chrome://extensions` → Developer mode → **Load unpacked** →
select `dist/`.

## How it works

| File | Job |
| :-- | :-- |
| `src/parse.ts` | Pure logic — channel-key normalizing, the ownership-match predicate, video id/URL parsing, displayed-count parsing, record assembly (archive + "update in place"), search, filenames, CSV/Markdown export |
| `src/scrape.ts` | The DOM half: which page this is, the viewed channel's identity, the account-switcher/Studio identity elements the ownership gate reads, and per-row metadata extraction |
| `src/storage.ts` | `chrome.storage.local` records, search, export (CSV/Markdown/JSON), clear-all |
| `src/content.ts` | Injects the Archive button on a channel's own "Videos" tab or Studio's own Content table, gated on a confirmed ownership match; relays the thumbnail download to the background worker |
| `src/background.ts` | The only place that calls `chrome.downloads` — saves the thumbnail **image** the content script already scraped a URL for |
| `src/popup.ts` | The archive: search, per-item Watch/Studio links, export, clear all |

### The ownership gate (PRD §5)

The Archive button only ever renders when the channel being viewed is confirmed to be the signed-in
account's own — read from YouTube's own account-switcher menu (on youtube.com) or from Studio's own
channel-identity element (on studio.youtube.com), never assumed from the URL alone. See
`scrape.ts#readOwnChannelKeys` and `parse.ts#isOwnChannelMatch`. **No confirmed match, no button** —
this fails closed on every ambiguous case: an unreadable identity element, an empty owned-channels
list, or a channel that simply isn't in it. `npm test` covers the matching predicate directly with
plain string inputs; the DOM reads that feed it are covered by the manual checklist below.

### Never the video stream — enforced, not just documented

Nothing in `src/` builds, requests, or even names YouTube's signed video-streaming CDN domain. That
domain is deliberately not spelled out anywhere under `src/` — it's named in this README and in
PRIVACY.md instead — so `scripts/selftest.mjs` can grep every file in `src/` for it and fail the build
if it ever shows up, the same "say it plainly, verify it structurally" approach XBookmarkOrganizer's
own network-call guardrail uses. The one legitimate network-touching call in this whole extension is
`chrome.downloads.download()` in `background.ts`, called with exactly one kind of URL: the thumbnail
image (`i.ytimg.com/vi/<id>/....jpg`) already scraped off the page.

### Update, don't duplicate

Archiving the same video a second time — title or description edited since, a stat that moved —
updates that video's stored record in place (`parse.ts#buildRecord`): every captured field refreshes,
but the original archive date never moves, and it's never a second entry (PRD §7).

### A missing thumbnail never blocks the entry

A just-published video's thumbnail sometimes isn't generated yet. The metadata entry saves regardless;
`thumbnailSavedAt` stays `null` until a download actually succeeds, and re-archiving the same video
later retries it (PRD §7).

## Privacy

No `fetch`, `XMLHttpRequest`, `sendBeacon` or `WebSocket` anywhere in this extension — enforced in
`npm test` and verifiable in devtools' network tab. The only outbound request of any kind is the
thumbnail image download itself, made by Chrome's own download manager, not by this extension's code.
See [PRIVACY.md](PRIVACY.md).

## What this extension will never do

Read-only, permanently, and video-stream-free, permanently — not a V1 limit, the one hard line in
[PRD-47 §2/§4](../../docs/extensions/PRD-47-youtube-upload-archiver.md#4-scope--v1). There is no code
path anywhere in this extension that requests, parses or reconstructs a video stream, offers a
format/quality picker, or reaches into a video's player response — for any video, including ones you
own. It also never archives a channel that isn't confirmed as the signed-in account's own, and it
never crawls a whole catalog in the background — every archive is a single, user-triggered click on a
video that's already rendered on screen (PRD §4).

## Manual verification

The DOM-bound half (`scrape.ts`, `content.ts`) needs a real browser, a signed-in YouTube account, and
live YouTube/Studio markup — `npm test` cannot reach it, and this markup could not be verified against
a live page in this build environment (no network access) — walk this list before shipping a build:

- [ ] On your own channel's "Videos" tab (`/@you/videos`), the Archive button appears next to each
      video tile
- [ ] On someone else's channel's "Videos" tab, the Archive button does **not** appear anywhere
- [ ] On your Content list in YouTube Studio (`studio.youtube.com/channel/…/videos`), the Archive
      button appears next to each row
- [ ] Click Archive on a video with a title, description and visible view/like counts — all captured
      correctly in the popup's list
- [ ] Click Archive on a video with likes hidden by the creator — likes shows as "not shown", never 0
- [ ] Click Archive on a just-published video with no thumbnail yet — the metadata entry still saves;
      re-archiving later after the thumbnail exists fills it in
- [ ] Edit a video's title/description in Studio, then Archive it again — the stored entry updates in
      place, no duplicate entry appears
- [ ] Click "Open in YouTube Studio" from the popup — lands on that video's Studio editor page, where
      Download lives in the ⋮ menu
- [ ] Search the popup's list by a word from a title and by a word from a description
- [ ] Export CSV, Markdown and JSON; open each and confirm the fields line up
- [ ] Switch signed-in Google accounts (or brand accounts) mid-session, then revisit a channel you no
      longer own — the Archive button disappears without a page reload (SPA navigation re-runs the
      ownership gate)
- [ ] Clear all data, confirm the popup's list goes back to "Nothing archived yet"
- [ ] Open devtools' Network tab while archiving — the only request YouTube/Studio doesn't already make
      on its own is the one thumbnail image download

## Known limits

- The ownership gate's DOM reads (the account-switcher menu, Studio's channel-identity element) are
  best-effort selectors against markup that changes without notice, and could not be verified live in
  this build environment. If a selector stops matching, the gate fails closed — no Archive button — by
  design; it never renders on a guess. Report a stale selector rather than working around the gate.
- There is no public deep link straight into YouTube Studio's Download *action* (it lives behind a
  video's ⋮ menu) — the Studio link this extension provides opens that video's Studio editor page,
  one click short of Download itself, not the download flow directly.
- The public channel "Videos" grid doesn't render a description or a like count per tile — those
  fields save as empty/`null` there. Studio's Content table shows richer per-video metadata; archive
  from Studio when you want the fuller record.
- Archiving is per-video (or per-visible-batch on a listing), user-triggered. This is not, and will
  never be, a background crawl of a channel's whole upload history (PRD §4).
