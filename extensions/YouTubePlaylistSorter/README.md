# YouTube Sign-in-Free Playlist Sorter

Chrome MV3 extension. Sort *any* YouTube playlist — yours, someone else's, or a public one you just
found — by duration, title or date, from a side panel. No sign-in, no OAuth, no API key, no backend.

Built from [PRD-30](../../docs/extensions/PRD-30-youtube-playlist-sorter.md). The
scaffold (build system, side-panel shape, storage/export layers) is copied from
[WebHighlighter](../WebHighlighter) and [YouTubeSubcription](../YouTubeSubcription); the DOM-reading
technique (`ytInitialData`-adjacent row scraping, degrade-field-by-field selectors) follows
[YouTubeProFilters](../YouTubeProFilters)'s `content/selectors.ts` pattern, the closest architectural
sibling for reading a YouTube video-list renderer without an API.

## Why this exists

A well-reviewed competitor, **Cleangarden — YouTube Playlist Sorter**, already does playlist sorting
— but it requires signing in with Google (OAuth via the YouTube Data API), and its "pick a playlist"
flow only ever lists playlists the signed-in account owns. That's not a bug, it's how the product is
built, and it structurally excludes anyone who wants to sort a playlist they don't own — a public
"best of" list, a course, a competitor's tutorial series. This extension reads only the *rendered
playlist page's DOM*: zero OAuth, zero API key, works on any playlist currently open in the tab, at
the honest cost that it only sees what YouTube has actually loaded into the page (see PRD §5 and
"Known limits" below).

## Quick start

```bash
npm install
npm run icons          # regenerate src/icons/*.png (no image dependency)
npm run build          # dev build into dist/
npm run build:watch    # rebuild on change
npm run build:prod     # minified, production manifest name
npm test               # headless checks — parsing, sorting, greedy pack, exports
npm run typecheck
npm run zip            # production build + dist/ packed for the Web Store
```

Node 18+ is required. Load it: `chrome://extensions` → Developer mode → **Load unpacked** → select
`dist/`. Then open any `youtube.com/playlist?list=...` page and click the toolbar icon (or use the
side panel) to open the panel.

## How it works

| File | Job |
| :-- | :-- |
| `src/parse.ts` | Duration/view-count/relative-date parsing — pure string logic, fully tested |
| `src/sort.ts` | Sorting the loaded rows by duration/title/date/YouTube's own order |
| `src/pack.ts` | The greedy "fits N minutes" packer |
| `src/exporters.ts` | CSV + Markdown export, filenames — pure, fully tested |
| `src/storage.ts` | `chrome.storage.local` preferences (last sort, last time budget), backup export/import/clear |
| `src/metrics.ts` | Local-only usage counters |
| `src/content/selectors.ts` | Every assumption about the playlist page's DOM, isolated in one file |
| `src/content/scan.ts` | Reads rows from the DOM; drives the bounded auto-scroll "load full playlist" |
| `src/content/index.ts` | Content script entry — SPA navigation, messaging, live state broadcasts |
| `src/background.ts` | Enables the side panel only on playlist-shaped YouTube URLs |
| `src/panel/panel.ts` | The side panel: sort controls, load-full, budget filter, table, exports, data ownership |

### Where every field comes from

Everything is read from the **currently rendered `/playlist?list=...` page** — there is no YouTube
Data API call, no OAuth, no API key, anywhere in this codebase (`npm test` greps `src/*.ts` for
`fetch`/`XMLHttpRequest`/`sendBeacon`/`WebSocket` and fails the build if any exist). A field YouTube
hasn't rendered in a parseable form is `null`, never guessed:

- **Duration** — `9:41` / `1:02:03` badge text. `null` for live/premiere rows or ones with no badge.
- **Views** — only when YouTube prints a views string on the row. Often absent on playlist rows.
- **Upload date** — only ever a *relative* string ("2 years ago"). There is no absolute date on a
  playlist row, so "sort by date" is a relative-recency order, not a true chronological sort — see
  PRD §5/§10, an open question worth re-checking against live YouTube before shipping.
- **Unavailable rows** (private/deleted/age-restricted) — detected by YouTube's own bracketed
  placeholder title and shown as a distinct, dimmed row; excluded from duration sort and the
  time-budget packer, never silently dropped or counted as zero-length.

### "Load full playlist"

YouTube lazy-loads playlist rows as you scroll. The auto-scroll driver (`src/content/scan.ts`) scrolls
the playlist's own list container (falling back to the window) in a loop, watching the row count, and
stops either when growth stalls for a few consecutive attempts (genuinely finished) or a **hard bound**
is hit — `MAX_SCROLL_ATTEMPTS = 60`, `MAX_SCROLL_MS = 45_000`, both named constants in that file, not
user-configurable in V1. When the bound is hit before the list stops growing, the panel says so
explicitly ("stopped after Ns / N attempts — N loaded, more may remain") rather than implying the
playlist is complete. The panel's "loaded" count is always the literal number of rows read out of the
DOM; YouTube's own stated total (when its header prints one) is shown alongside as a labelled,
unverified cross-check, never as ground truth.

## Manual test checklist — read before shipping

This build had no live YouTube session to verify selectors against (PRD §5's own pre-ship spike
requirement). Every DOM lookup in `src/content/selectors.ts` is written to degrade field-by-field
rather than throw, but the selector *chains themselves* are unverified. Walk this before shipping:

- [ ] A small playlist (under 50 videos) — every row's title, duration, position parse correctly
- [ ] A large playlist (300+ videos) — "Load full playlist" completes or hits its bound cleanly, panel
      stays responsive once fully loaded
- [ ] A playlist with age-restricted / private / deleted videos mixed in — they render as a distinct,
      dimmed "unavailable" row, not blank and not silently dropped
- [ ] A playlist sorted in YouTube's own custom (non-chronological) order — "YouTube's own order" in
      the sort dropdown reproduces it exactly
- [ ] Confirm whether upload date ever renders as anything other than a relative string ("2 years
      ago") — if it never does, `src/parse.ts`'s relative-only assumption holds; if it sometimes does,
      `looksLikeRelativeDate`/`relativeDateToMs` need an absolute-date branch
- [ ] Confirm view-count text format(s) actually rendered on playlist rows (or its absence) match what
      `parseViewCount` expects
- [ ] A playlist you don't own, and one you do — both should work identically (ownership is never
      checked)
- [ ] The Watch Later URL (`youtube.com/playlist?list=WL`) — confirm whether it renders on the same
      `ytd-playlist-video-renderer` row shape. If it does, the disclaimer banner can come out; if it
      doesn't, keep it and consider a dedicated adapter (PRD §10, open question)
- [ ] Newly loaded rows (after a scroll) use the same selector shape as initially rendered ones
- [ ] Export CSV and Markdown, both with and without the time-budget filter active
- [ ] Data → Export / Import / Clear all round-trips correctly

## Known limits

- Only sees what YouTube has rendered/loaded into the tab. "Load full playlist" is a bounded
  auto-scroll, not a guarantee — very large playlists or a slow connection can hit the time/attempt
  cap before finishing (the panel says so plainly when this happens).
- "Sort by date" is relative-recency order, not an exact chronological sort — playlist rows don't
  expose an absolute upload date.
- Never writes to YouTube. No reordering, no removing videos from the playlist, no account action of
  any kind — read-only, permanently (not a V1 limit, see PRD §4/§6).
- Watch Later support is unverified — see the manual checklist above.

## Permissions

`activeTab`, `storage`, `downloads`, `sidePanel` + host permission `*://*.youtube.com/*`. No `tabs`,
no `scripting` — the content script is injected declaratively via `content_scripts`, and
`chrome.tabs.query`/`chrome.tabs.sendMessage` work against the active tab without the `tabs`
permission once host permissions cover its domain (confirmed against this portfolio's earlier
extensions — see the panel's `ask()`/`refresh()` pair).
