# X Media Archiver

Chrome MV3 extension. Save the photos and videos from **your own** X (Twitter) posts to your
device — X has no bulk media-download button, and its official "Download an archive of your data"
tool is a slow, all-or-nothing export. This is the missing, narrower piece: recover the media from
one post you posted, on request.

Built from [PRD-46](../../docs/extensions/PRD-46-x-media-archiver.md). Same ownership restriction as
every other archiver in this batch (Instagram/PRD-44, TikTok/PRD-45), enforced the same way: a Save
button never appears on a post the logged-in account did not author — no setting, no exception, no
code path that offers it.

## Quick start

```bash
npm install
npm run icons          # regenerate src/icons/*.png (no image dependency)
npm run build          # dev build into dist/
npm run build:watch    # rebuild on change
npm run build:prod     # minified, production manifest name
npm test               # headless checks — parsing, ownership gate, filenames, exports, privacy posture
npm run typecheck
npm run zip            # production build + dist/ packed for the Web Store
```

Node 18+ is required. Load it: `chrome://extensions` → Developer mode → **Load unpacked** → select
`dist/`.

## How it works

| File | Job |
| :-- | :-- |
| `src/parse.ts` | Pure logic: handle normalization, filenames, CSV/JSON export — **and the ownership gate itself** (`isOwnPost`, `resolveMediaAuthor`, `evaluateMediaOwnership`), factored out of the DOM layer so it can be tested with plain fixtures |
| `src/scrape.ts` | The DOM half: reads the logged-in account's handle off X's left-nav, and one post's media + byline(s), telling a post's own media apart from a nested quoted post's media |
| `src/content.ts` | Floats a Save control (+ "Save all" on multi-media posts) next to a post's action row for exactly the media the gate confirmed is owned; re-evaluates every sync pass |
| `src/background.ts` | The download relay — `chrome.downloads` isn't available inside a content script |
| `src/storage.ts` | The local save log: add / read all / export CSV / export JSON / clear all |
| `src/popup.ts` / `popup.html` | The log view: table, export buttons, clear-all |
| `src/types.ts` | Shared shapes |

### The ownership gate — where it actually lives, and why it can't drift

PRD-46 §5 is the one non-negotiable requirement in this build, so it is deliberately implemented as
**pure functions in `parse.ts`**, not buried inside `content.ts`'s DOM-walking code:

- `isOwnPost(viewerHandle, authorHandle)` — the whole comparison, case-insensitive, and **fails
  closed** (`owned: false`) whenever either handle is empty. There is no code path where a missing
  handle defaults to "allow."
- `resolveMediaAuthor(mainAuthor, quotedAuthor, source)` — PRD §4/§5's repost/quote rule: media
  tagged `source: 'quoted'` resolves to the *quoted* post's author, never the outer post's, even when
  the outer post is unmistakably the viewer's own quote-tweet.
- `evaluateMediaOwnership(tweet, viewerHandle)` — runs both of the above over every media item on one
  scraped post and is the single function `content.ts` calls before rendering anything.

**The repost case, specifically:** there is no "who reposted this" field anywhere in this extension's
data model. `scrape.ts#extractTweet` reads a post's author from the `<article>`'s own
`[data-testid="User-Name"]` block, and X renders a repost as the *original* post's own article (with
a separate "so-and-so reposted" decoration living outside any `User-Name` block) — so the reposting
account's handle is never captured, anywhere, by any function in this codebase. It structurally cannot
leak into an ownership decision. `scripts/selftest.mjs`'s "repost/quote authorship resolution" suite
exercises this directly: a post whose original author is `ada`, evaluated against a viewer handle of
`jack` (the one who reposted it), must never be owned — and isn't.

**The quote-tweet case:** a single post can contain two independently-owned media items — the
viewer's own attached image (`source: 'main'`) and the quoted post's image (`source: 'quoted'`) —
and the gate decides each independently. `scripts/selftest.mjs` covers this split-ownership scenario
explicitly.

**Fail-closed on the viewer side too:** `scrape.ts#readViewerHandle` reads X's left-nav
`[data-testid="SideNav_AccountSwitcher_Button"]` and returns `''` — never a guess, never a cached
value — when the nav hasn't rendered, the account is logged out, or the handle can't be confidently
parsed. `isOwnPost('')` always returns `owned: false`, so a page X hasn't finished rendering never
produces a false-positive Save button.

**Never cached across renders:** `content.ts#syncBadges` re-reads the viewer handle and re-runs the
gate on every sync pass (mutation-observer trigger + a 4s interval), so a multi-account switch
mid-session (PRD §7) is caught on the next pass, not carried over from a stale evaluation.

### Video: highest-bitrate source, never a poster frame (PRD §7)

`scrape.ts` reads every `<source>` a post's `<video>` element rendered (plus `video.currentSrc`),
and `parse.ts#chooseHighestBitrateVideoSource` picks the one with the largest width × height as a
stand-in for bitrate — the only signal X's markup reliably exposes. `blob:` URLs (X's MSE-streamed
videos) are never eligible, since they can't be downloaded outside the page that created them; a post
whose only source is a blob stream simply gets no Save-video button at all, rather than silently
downloading the poster image instead. A later sync pass picks it up automatically once/if a real
source URL becomes available.

### Why nothing here needs a fetch of its own

The Save action downloads the exact media URL the page already rendered, via
`chrome.downloads.download` (called from `background.ts`, since content scripts cannot call
`chrome.downloads` directly — the one message this extension ever sends). That download is the only
network activity this extension ever causes; `scripts/selftest.mjs` greps `src/*.ts` for
`fetch`/`XMLHttpRequest`/`sendBeacon`/`WebSocket` call sites and fails the build if any exist.

## Manual verification

`scrape.ts` and `content.ts` are DOM-bound and need a real browser with a live X session — `npm test`
cannot reach them. **This could not be verified against a live x.com session in this build
environment (no network access)** — every selector in `scrape.ts` is a best-effort, `data-testid`-based
heuristic (the same convention XConversationSaver/XCardExporter already use in this portfolio), not
verified against production markup. Walk this list before shipping a build:

- [ ] Own post with a single image → exactly one "Save image" button, downloads the full-resolution file
- [ ] Own post with a video → exactly one "Save video" button, downloads a real playable file, not a poster/thumbnail frame
- [ ] Own multi-image post (carousel) → one "Save N" button per image, plus one "Save all" button; "Save all" downloads every image
- [ ] **Someone else's post** (never reposted/quoted by you) → no Save button anywhere, regardless of media
- [ ] **A post you reposted from someone else** (plain repost, no added quote text/media) → no Save button — confirms the gate reads the *original* author, not your account, even though the repost appears on your own timeline/profile
- [ ] **A quote-tweet you made of someone else's post, with no media of your own attached** → no Save button (the only media present belongs to the quoted post)
- [ ] **A quote-tweet you made with your own image attached, quoting someone else's post that also has media** → Save button appears only for your own attached image, never for the quoted post's media
- [ ] Log out of X (or switch accounts) mid-session, without reloading the page → previously-shown Save buttons disappear on the next sync pass
- [ ] Scroll a busy timeline fast → badges track the right post, no stale/duplicate badges after X recycles list-cell DOM nodes
- [ ] Popup: saved entries list correctly, Export CSV opens a valid file, Export JSON round-trips, Clear all empties the log
- [ ] `chrome://extensions` and non-X tabs → no badges, no errors (host permissions don't match)

## Known limits

- Every DOM selector in `scrape.ts` is a best-effort guess against X's `data-testid` attributes,
  unverified in this build environment — check each one against a live session first (see the
  checklist above); a wrong guess degrades to no Save button, never a wrong one.
- No bulk/profile crawl — per-post only, triggered from a post already on screen (PRD §4).
- The local log is a record only (post URL, date, media type, filename) — it never stores the media
  file itself, and deleting a log entry never affects the already-downloaded file.
- Video source selection depends on what X's own player has already loaded into the DOM at the
  moment of the click; a video still buffering its full-resolution source may only offer a lower
  bitrate until the page finishes loading it.
