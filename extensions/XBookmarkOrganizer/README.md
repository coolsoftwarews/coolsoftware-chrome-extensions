# X Bookmark Organizer

Chrome MV3 extension. Turns X's own Bookmarks page into something you can actually organize and
search — folders, tags, a personal note per bookmark, and an export that isn't locked inside X. No
account, no backend, no network requests, and no sync with X's own bookmark state in either
direction.

Built from [PRD-26](../../docs/extensions/PRD-26-x-bookmark-organizer.md). Storage,
export and import are the "Saver" pattern from
[docs/extensions/README.md](../../docs/extensions/README.md#shared-modules) — the
same shape as [WebHighlighter](../WebHighlighter)'s and [XConversationSaver](../XConversationSaver)'s
storage layers, the closest sibling on this exact platform.

## Quick start

```bash
npm install
npm run icons          # regenerate src/icons/*.png (no image dependency)
npm run build           # dev build into dist/
npm run build:watch     # rebuild on change
npm run build:prod      # minified, production manifest name
npm test                # headless checks — parsing, capture, merge, exports, privacy posture
npm run typecheck
npm run zip              # production build + dist/ packed for the Web Store
```

Node 18+ is required. Load it: `chrome://extensions` → Developer mode → **Load unpacked** →
select `dist/`.

## How it works

| File | Job |
| :-- | :-- |
| `src/parse.ts` | Pure string parsing — count formatting ("1.2K"), status ids, handles, URLs, tag splitting, the Bookmarks-page URL check |
| `src/scrape.ts` | The DOM half: finds bookmarked posts on the Bookmarks page and reads whatever X rendered |
| `src/capture.ts` | Turns a scrape into a bookmark card — index/re-touch, staleness derivation, search, tag listing |
| `src/merge.ts` | Import merge-by-id semantics, pulled out so it's testable without chrome.* |
| `src/formatters.ts` | CSV and Markdown export — pure, fully tested |
| `src/storage.ts` | `chrome.storage.local` records, folders, backup export/import, quota status, indexing-session bookkeeping |
| `src/content.ts` | Passively indexes bookmarks as the user scrolls the Bookmarks page; runs the bounded auto-scroll "Re-index" pass on request |
| `src/panel.ts` | Side panel: library, search, folder/tag filters, Re-index trigger, export, data ownership |

### Why indexing only happens on X's own Bookmarks page

This is the central design fact in [PRD-26 §5](../../docs/extensions/PRD-26-x-bookmark-organizer.md#5-where-the-data-comes-from--read-before-committing):
there is no public, no-auth API this extension can call to fetch "all my bookmarks" in one shot —
that's exactly the access the market's account-based bookmark tools ask for a signup to get around.
So this extension reads only what X has rendered on the Bookmarks page as the user scrolls it (or as
a bounded auto-scroll pass reads further on request). The `content_scripts.matches` pattern in
`scripts/build.mjs` is deliberately scoped to `*/i/bookmarks*` only — narrower than the extension's
own `host_permissions`, which cover the whole site so the side panel's search/organize surface works
from any X tab, not just the Bookmarks page itself.

**Say this plainly wherever it matters, not just here:** "We index what you've scrolled through.
Scroll further, or click Re-index, to add more." That copy is in the panel's empty state, in
STORE_LISTING.md, and in PRIVACY.md — this is a real trade-off for never asking for account access,
not a hidden limitation.

### Update, don't duplicate — and the staleness flag

Indexing the same bookmark twice (scrolling back up and down again) refreshes the captured text and
metrics, but the folder, tags and note the user already set are preserved, and the original indexed
date does not move — see `capture.ts#buildOrTouchItem`.

Un-bookmarking a post on X after it's been indexed here does **not** remove it locally — there is no
live sync (PRD §4/§7, and see "What this extension will never do" below). Instead, every indexing
pass stamps items it observes with the *session's* start time (`sessionAt`, fixed for the whole
visit, not a per-scan-tick timestamp — this is what makes the comparison exact rather than a source
of false positives against items seen earlier in the same session). `capture.ts#isPossiblyRemoved`
flags any item whose last confirmed sighting predates the most recently completed visit as **"Not
seen on your last visit"** — a flag the user can dismiss, never a silent delete, matching PRD §7's
own resolution ("a false negative from partial scrolling is worse than a stale flag").

### The bounded "Re-index" pass

The panel's Re-index button sends one message to the content script on the active tab (only if it's
actually the Bookmarks page — checked via `parse.ts#isBookmarksUrl` before sending; the content
script isn't even injected anywhere else, so there's nothing to receive it otherwise). The content
script scrolls a bounded number of screens (capped at 24, see `MAX_AUTOSCROLL_SCREENS` in
`content.ts`), reading and indexing after each scroll — never unbounded, never a background crawl,
and only while the Bookmarks tab is open and this was explicitly requested (PRD §6/§10).

### No content-script↔panel messaging for reads

Like XConversationSaver and RedditVoiceOfCustomer, the panel reads/writes `chrome.storage.local`
directly and subscribes to `chrome.storage.onChanged` (fires in every extension context on any
write, including the panel's own) rather than polling or relaying through custom messages. The one
real message in this extension is the one-way "start a bounded re-index" command described above —
everything else is plain storage reads.

## Privacy

No `fetch`, no `XMLHttpRequest`, no `sendBeacon`, no `WebSocket` — enforced in `npm test` (greps
`src/*.ts` for network call sites and fails the build if any exist) and verifiable in devtools'
network tab. Indexed bookmarks, tags, notes and usage counters live in `chrome.storage.local` and
are never transmitted. See [PRIVACY.md](PRIVACY.md).

## What this extension will never do

Read-only, permanently. There is no code path anywhere in this extension that writes to X — no
un-bookmarking, no posting, liking, following or messaging. Deleting a bookmark from this extension's
local library removes it **only** from this local library; it does not touch the bookmark on X. This
is a structural property, not a policy — see PRIVACY.md and PRD-26 §4's explicit out-of-scope list.

## Manual test checklist

The DOM-bound half needs a real browser and X's live Bookmarks markup — `npm test` cannot reach it.

- [ ] Open the Bookmarks page — bookmarks already on screen get indexed within ~1s
- [ ] Scroll down — newly rendered bookmarks get indexed as they appear, no duplicates on scroll-back-up
- [ ] A bookmark with an image/video and no text — indexes with a thumbnail reference, no crash
- [ ] Click "+ New folder", rename a folder, move a bookmark between folders
- [ ] Add tags to a bookmark (comma-separated), confirm they show as chips and filter correctly
- [ ] Search across text, author, handle, tag and note
- [ ] Click "Re-index bookmarks" while on the Bookmarks tab — bounded auto-scroll runs, status updates, new items appear
- [ ] Click "Re-index bookmarks" while on a *different* X tab — panel shows "open your Bookmarks page" hint, no crash
- [ ] Un-bookmark a post on X, then re-open Bookmarks and let a new session index — the removed post's card shows "Not seen on your last visit" in the panel, and is not deleted
- [ ] Export as .md, .csv and .json; import the .json back in (merge, not overwrite)
- [ ] Clear all data, confirm the four default folders come back empty
- [ ] Fill storage near 80% (thousands of bookmarks) — the quota warning appears in the Data sheet

## Known limits

- X's markup uses `data-testid` attributes rather than stable class names; every selector in
  `scrape.ts` is a best-effort heuristic, and a field X didn't render becomes empty rather than
  failing the whole indexing pass.
- Indexing depth is exactly what's been scrolled (passively) or auto-scrolled (on request) — this
  extension cannot see a bookmark it hasn't rendered, by design (PRD §5). It is not, and will never
  be, a full-history import on first install.
- The "Not seen on your last visit" flag is a heuristic, not a certainty — it can also fire for a
  bookmark that's still on X but simply wasn't scrolled to on the most recent visit. Treat it as "go
  check", not "this is gone."
- Media beyond a thumbnail reference is not downloaded — the extension stores the CDN URL, not the
  file.
