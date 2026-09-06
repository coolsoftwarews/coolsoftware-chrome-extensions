# TikTok Media Archiver

Chrome MV3 extension. Adds a **Save (original)** button to your own posted TikToks — saving the
video source the page's own player already loaded, before TikTok's own "Save video" export
watermarks it. Restricted, structurally, to posts the logged-in account itself authored: no toggle,
no exception. No account, no backend, no network requests beyond the download itself.

Built from [PRD-45](../../docs/extensions/PRD-45-tiktok-media-archiver.md). The closest sibling on
this exact platform is [TikTokProductScout](../TikTokProductScout) (same build/manifest/icon-writer
conventions); the local save log is the "Saver-lite" shape from
[XBookmarkOrganizer](../XBookmarkOrganizer)'s and [XConversationSaver](../XConversationSaver)'s
storage layers — `chrome.storage.local`, add/readAll/export CSV+JSON/clear-all, no server.

## Quick start

```bash
npm install
npm run icons          # regenerate src/icons/*.png (no image dependency)
npm run build          # dev build into dist/
npm run build:watch    # rebuild on change
npm run build:prod     # minified, production manifest name
npm test               # headless checks — handle normalization, the ownership gate, filenames, exports
npm run typecheck
npm run zip             # production build + dist/ packed for the Web Store
```

Node 18+ is required. Load it: `chrome://extensions` → Developer mode → **Load unpacked** →
select `dist/`.

## How it works

| File | Job |
| :-- | :-- |
| `src/parse.ts` | Pure string parsing — handle normalization, the ownership-match predicate, id/URL extraction, the filename convention |
| `src/scrape.ts` | The DOM half: finds post tiles, reads the logged-in account's own handle, a post's author handle, and the video source URL the player loaded |
| `src/storage.ts` | `chrome.storage.local` save log (add/readAll/clear) plus pure CSV/JSON export formatting |
| `src/content.ts` | Renders the Save button (gated per post), the click-to-save flow, and the on-page saved-videos log |
| `src/background.ts` | Relays `chrome.downloads.download()` (unavailable to content scripts) and toggles the log from the toolbar icon / `Alt+Shift+S` |
| `src/types.ts` | Shared shapes: the log entry, and the two content↔background message types |
| `scripts/gen-icons.mjs` | Draws the icon PNGs from scratch (no binary assets to maintain) |
| `scripts/selftest.mjs` | Headless checks for everything that does not need a browser |

## The ownership gate (PRD-45 §5) — read this before touching content.ts or scrape.ts

**The Save button must never appear on a post the logged-in account did not author.** This is the
one non-negotiable requirement in this extension, and it is enforced in exactly one place:
`content.ts#isOwnPost`, called fresh for every post tile on every render pass (never cached across
renders — TikTok's feed is virtualized and an account switch mid-session must be re-checked, PRD §7):

1. `scrape.ts#readOwnHandle` reads the logged-in account's own handle from TikTok's own nav — the
   "Profile" link, which resolves to `/@<own-handle>` — by accessible name first (the link's own
   text or `aria-label`, not a class name TikTok can rename without notice), then a couple of
   historical `data-e2e` hooks as a fallback.
2. `scrape.ts#readPostAuthorHandle` reads the post's own byline off the tile itself, never off the
   page URL (a profile page's URL is not proof of who posted a particular tile in its feed).
3. `parse.ts#handlesMatch` compares the two, case-insensitively. **Either lookup returning null —
   or the two not matching — means no button. There is no other outcome.**

This is why `isOwnPost` returns a plain `boolean` and is the *only* function that decides whether a
Save button exists: nothing downstream (rendering, the click handler, the download request) has its
own opinion about ownership, and nothing re-derives it from a cache. `handleSave` re-runs the same
check at the moment of the click, not just at render time, so a tile recycled by TikTok's own
virtualization between render and click can't slip a save through.

## Why the download comes from the player, not TikTok's own export

TikTok's native "Save video" produces a file burned with TikTok's watermark and username overlay —
fine for re-sharing, useless as a clean master copy. Instead, `scrape.ts#readVideoSourceUrl` reads
the `<video>` element's own `currentSrc`/`src` inside the tile — the same file TikTok's player
already streamed to render the post. If that URL isn't ready yet (still buffering, or a lower-res
placeholder TikTok shows before the real source loads), `waitForVideoSourceUrl` polls for up to 6
seconds rather than saving whatever's there; if nothing usable appears in that window, the button
says so instead of silently saving a placeholder (PRD-45 §7).

## Why the download and the log export both go through background.ts

Content scripts do not have access to `chrome.downloads` — it isn't part of the content-script API
surface. So both privileged writes (the video file, and a CSV/JSON export of the log) are relayed as
one-shot messages to the service worker, which is the only place `chrome.downloads.download()` is
ever called. The service worker never decides *whether* to save something — that decision is made
entirely in `content.ts` before a message is ever sent.

## Why there's no popup or side-panel page

Keeping `permissions`/`host_permissions` in `scripts/build.mjs` exactly to PRD-45 §6's list
(`activeTab`, `downloads`, `storage` + the TikTok host) means not adding a `sidePanel` permission or
a popup page just to show a log. Instead, the toolbar icon (or `Alt+Shift+S`) sends a one-way
"toggle" message to the content script, which shows a small panel inside the same shadow root the
Save buttons already live in — the same drawer-in-page pattern TikTokProductScout uses for its
product board.

## Shadow-root-only UI — never TikTok's own tree

TikTok is a heavily virtualized, React-style app: tiles get recycled as the user scrolls, and any DOM
node an extension inserts *inside* TikTok's own tree can be wiped on the next re-render. So, exactly
like XConversationSaver's and WebHighlighter's content scripts, this extension never inserts anything
into TikTok's own tree. One shadow root is appended to `document.documentElement`, and every Save
button and the log panel are absolutely-positioned elements floating over the page, repositioned from
`getBoundingClientRect()`. Because the ownership check and the video-source read both happen live —
at render time and again at click time — a recycled tile is a non-issue: whatever is on screen right
now is what gets evaluated.

## What this extension will never do

Read-only against TikTok, permanently. There is no code path anywhere in this extension that posts,
edits, likes or follows — see PRD-45 §4's explicit out-of-scope list. And there is no code path,
setting, or toggle that offers Save on a post the logged-in account did not author — see the
ownership gate section above.

## Manual test checklist

The DOM-bound half (`scrape.ts`, `content.ts`) needs a real, logged-in TikTok session and cannot be
covered by `npm test`.

- [ ] Open a video posted by the logged-in account — "Save (original)" appears within a couple of
      seconds
- [ ] Open a video posted by a *different* account — no Save button appears anywhere on the page,
      on first paint or after the retry pass
- [ ] Scroll a feed containing a mix of the logged-in account's own reposts/duets and other
      creators' videos — the button appears only on the account's own tiles, and only on those
- [ ] Click Save — the file lands in Downloads as `tiktok-<handle>-<post-id>.mp4`, and it is not
      watermarked with TikTok's own export overlay
- [ ] Click Save on a video that is still buffering — the button shows "Finding source…" and either
      resolves once playback starts or reports it couldn't find a source within the bound, never a
      silent no-op
- [ ] Log out and log back in as a different account mid-session (same tab, no reload) — buttons
      already on screen re-evaluate to match the new logged-in account within the next scan pass
- [ ] Open the saved-videos log via the toolbar icon and via `Alt+Shift+S` — both toggle the same
      panel
- [ ] Export CSV and export JSON from the log — both files write correctly and open cleanly
- [ ] Clear all — the log empties immediately; previously downloaded video files are unaffected
- [ ] Delete a post from TikTok after it's been logged — the log entry persists (PRD §7); the
      already-saved file is unaffected
- [ ] Navigate between a feed, a profile, and a single-video page without reloading — the gate and
      the button set stay correct on each

## Known limits

- TikTok ships markup with `data-e2e` attributes that can be renamed on redesign; every selector in
  `scrape.ts` is a best-effort heuristic with a fallback, and a selector miss degrades to "no button"
  (never a false positive) rather than breaking the page.
- V1 is video-only — slideshow/photo posts and live replays are explicitly out of scope (PRD-45 §4)
  and are not read or saved.
- The video-source read depends on TikTok having actually loaded a playable source into the tile's
  `<video>` element at save time; on a very slow connection the 6-second wait can still time out, in
  which case the button reports it rather than saving a placeholder.
