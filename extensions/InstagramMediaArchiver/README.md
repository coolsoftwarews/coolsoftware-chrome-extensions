# Instagram Media Archiver

Chrome MV3 extension. Save the photos and videos from **your own** Instagram posts to your device in
one click — Instagram has no bulk "download my media" button, and this is not a tool for saving
anyone else's content. No account, no backend, no network requests beyond the download itself.

Built from [PRD-44](../../docs/extensions/PRD-44-instagram-media-archiver.md). The local log follows
the "Saver" pattern from [docs/extensions/README.md](../../docs/extensions/README.md#shared-modules)
(same shape as [WebHighlighter](../WebHighlighter)'s `storage.ts`), minus an import path — per
PRD §10, this log is export-only.

## Quick start

```bash
npm install
npm run icons          # regenerate src/icons/*.png (no image dependency)
npm run build          # dev build into dist/
npm run build:watch    # rebuild on change
npm run build:prod     # minified, production manifest name
npm test               # headless checks — handle normalization, the ownership gate, exports
npm run typecheck
npm run zip             # production build + dist/ packed for the Web Store
```

Node 18+ is required.

Load it: `chrome://extensions` → Developer mode → **Load unpacked** → select `dist/`.

## The ownership gate (read this first)

This is the one non-negotiable rule in the product (PRD §5): **the Save button must never appear on
a post the logged-in Instagram account did not author.** There is no code path, setting or toggle
that offers Save on someone else's post.

The check, run fresh for every post on every scan pass — never cached across posts or across time:

1. `scrape.ts#readLoggedInHandle` reads the signed-in account's own handle from Instagram's own nav
   (the profile icon/link in the app's own chrome) — never from a cached value, a cookie, or the URL.
2. `scrape.ts#readPostAuthorHandle` reads the post's author handle from that post's own header,
   scoped to the post's own container.
3. `parse.ts#handlesMatch` compares the two, case-insensitively. **Either read failing — logged out,
   selector drift, an empty string — fails closed exactly like a mismatch.** There is no "unknown, so
   allow it" branch.

`content.ts#processArticle` is the only call site that wires these three together, and it removes any
existing Save UI for a post the instant the check no longer passes (multi-account switch, virtualized
DOM recycling one card into a different post, etc.).

## How it works

| File | Job |
| :-- | :-- |
| `src/parse.ts` | Pure logic: handle normalization, the ownership-match predicate, the filename convention, post-id extraction — fully tested |
| `src/scrape.ts` | The DOM half: reads the logged-in handle from Instagram's nav, a post's author handle from its header, and a post's media elements |
| `src/content.ts` | Injects the Save button row next to a post's action row, gated by the ownership check; relays the actual download to the service worker |
| `src/background.ts` | The only place `chrome.downloads.download()` is called — content scripts have no access to `chrome.downloads` |
| `src/storage.ts` | `chrome.storage.local` records: the local archive log (add/read/clear) |
| `src/formatters.ts` | CSV and JSON export of the log — pure, fully tested |
| `src/popup.ts` / `popup.html` | Toolbar popup: the log, and Export CSV / Export JSON / Clear all |
| `scripts/gen-icons.mjs` | Draws the icon PNGs from scratch (no binary image assets to maintain) |
| `scripts/selftest.mjs` | Headless checks for everything that does not need a browser, plus a static check of the manifest's permission set and Web Store length limits |

### Why content.ts never calls chrome.downloads directly

Content scripts have access to `chrome.runtime` and `chrome.storage`, but **not** `chrome.downloads` —
only extension pages and the service worker do. So a click on a Save button sends a
`SaveMediaRequest` to `background.ts`, which performs the actual `chrome.downloads.download()` call
and appends the log entry once the download has started. `content.ts` never touches
`chrome.storage.local` or `chrome.downloads` itself.

### Filename convention

`instagram-<handle>-<post-id>-<n>.<ext>` — `<n>` is the 1-based slide position (always `1` for a
single image or video). The extension is read from the media URL when present, and otherwise
defaults by media kind (`jpg` for images, `mp4` for videos) rather than guessing wrong.

### Carousels and video

Each carousel slide gets its own Save button ("Save 1", "Save 2", …) rather than one button for the
whole post (PRD §7). Instagram lazy-loads slides the user hasn't scrolled to yet, so a slide that
hasn't been viewed may simply not be discoverable until the user does — this is a known limit of a
read-only, DOM-only extension, not a bug to work around with a network request.

## Privacy

No `fetch`, no `XMLHttpRequest`, no `sendBeacon`, no `WebSocket` — verifiable with
`grep -rn "fetch(" src/` and in devtools' network tab; `scripts/selftest.mjs` enforces this on every
test run. The archive log lives in `chrome.storage.local` and is never transmitted. Host access is
scoped to `*.instagram.com` only. See [PRIVACY.md](PRIVACY.md).

## Manual test checklist

The ownership gate and everything else in `scrape.ts`/`content.ts` need a real, logged-in Instagram
session and cannot be checked headlessly:

- [ ] Open one of **your own** posts (single image) — Save appears next to the action row
- [ ] Open one of **your own** Reels/videos — Save appears, downloads the video source
- [ ] Open one of **your own** carousel posts — one Save button per slide, each downloads that slide
- [ ] Open **someone else's** post — Save never appears, on any layout (feed card, open dialog,
      permalink page)
- [ ] Log out, or switch to a second account in the same browser session, then revisit a post that
      was previously "yours" — Save disappears the moment the logged-in handle no longer matches
- [ ] Scroll a feed containing a mix of your own and other accounts' posts — Save appears only on
      your own cards, and only next to their own action rows
- [ ] Click Save — button shows "Saving…", then "Saved"; the file lands in Downloads with the
      documented filename
- [ ] Trigger a failed download (e.g. revoke the `downloads` permission mid-session) — button shows
      "Retry" rather than silently doing nothing
- [ ] Save the same post/slide twice — log has one row per slide, not a duplicate
- [ ] Open the toolbar popup — saved items list, Export CSV, Export JSON, Clear all all work
- [ ] SPA navigation from feed → a permalink page → back to feed — stale Save buttons are cleared,
      not left floating over the wrong post
- [ ] Resize/scroll the window while a Save button is visible — it stays anchored to the action row

## Known limits

- Instagram's DOM is obfuscated and changes without notice; every selector in `scrape.ts` is
  best-effort with a fallback to "can't confidently read this" rather than a guess — which, per the
  ownership gate, means no button rather than a wrong one.
- A carousel slide Instagram hasn't rendered yet (not scrolled to) cannot be saved until it has been
  — there is no API call to fetch what isn't already in the DOM.
- No bulk/whole-profile archive, by design (PRD §4): this is a per-post tool triggered from a post the
  user is already viewing, not a crawler.
- No Stories or Highlights support (PRD §4): a materially different ownership/consent surface,
  deferred to a V2 conversation at most.
