# Instagram Creator Research Saver

Chrome MV3 extension. A swipe file built into Instagram: save any post or Reel to a collection with
its numbers and your note, then export the lot as CSV, Markdown or JSON. No account, no backend, no
network requests.

Built from [PRD-07](../../docs/extensions/PRD-07-instagram-research-saver.md). The
storage layer is the "Saver" pattern from
[docs/extensions/README.md](../../docs/extensions/README.md#shared-modules) — the
same shape as [WebHighlighter](../WebHighlighter)'s `storage.ts` (capture card, collections, notes,
search, CSV/MD/JSON export, import, clear), wearing Instagram's clothes.

## Quick start

```bash
npm install
npm run icons          # regenerate src/icons/*.png (no image dependency)
npm run build          # dev build into dist/
npm run build:watch    # rebuild on change
npm run build:prod     # minified, production manifest name
npm test               # headless checks — capture cards, exports, storage/import
npm run typecheck
npm run zip            # production build + dist/ packed for the Web Store
```

Node 18+ is required.

Load it: `chrome://extensions` → Developer mode → **Load unpacked** → select `dist/`.

## How it works

| File | Job |
| :-- | :-- |
| `src/capture.ts` | Pure capture-card logic — count parsing, id/URL normalization, dedupe-on-resave, search matching |
| `src/scrape.ts` | The DOM half: finding posts/Reels on the page, reading whatever Instagram rendered, resizing the thumbnail |
| `src/content.ts` | Injects the "+ Save to Research" pill (grid hover) and floating button (detail view), wires capture → storage |
| `src/formatters.ts` | CSV and Markdown export — pure, fully tested |
| `src/storage.ts` | `chrome.storage.local` records: posts, collections, backup export/import, quota status |
| `src/metrics.ts` | Local-only usage counters |
| `src/background.ts` | Seeds the four starter collections, opens the side panel |
| `src/panel.ts` | Side panel: the whole library, search, move/edit/delete, export, data ownership |

### Save first, note second

PRD §11 asks this explicitly and decides it: prompting for a note before saving adds friction to the
one action that has to be instant, so the click on **+ Save to Research** saves immediately — no
navigation, target well under the PRD's 200 ms budget since it's a single `chrome.storage.local`
write. A small card then appears with an optional note field and a collection picker, so richer data
is one extra (skippable) step, not a gate on the save itself.

### The four fields Instagram might not give you

Views, likes, comments and the caption are read from whatever Instagram has rendered for the signed-in
user in that moment (PRD §6) — there is no API call to ask for what isn't there. A missing count
becomes `null` and renders as an em dash, never a misleading `0`. A carousel saves its first slide and
records the slide count. All of this logic is pure and covered by `scripts/selftest.mjs`; the DOM
reading itself is best-effort against Instagram's frequently-changing markup and needs the manual
checklist below.

### Thumbnails: data URI first, remote URL when that fails

Thumbnails are re-encoded client-side to a ~320px WebP data URI so a library of saved posts survives
independent of Instagram's CDN (PRD §6). Instagram's CDN does not grant cross-origin pixel access, so
drawing the image onto a canvas commonly throws a `SecurityError` — that's an expected outcome, not a
bug, and `scrape.ts#captureThumbnail` falls back to storing the remote URL when it happens. The panel's
**Usage** sheet tracks the capture-vs-fallback rate as the health number to watch: if it drops, images
are quietly rotting.

## Privacy

No `fetch`, no `XMLHttpRequest`, no `sendBeacon` — verifiable with `grep -rn "fetch(" src/` and in
devtools' network tab. Saved posts, notes and usage counters live in `chrome.storage.local` and are
never transmitted. Host access is scoped to `*.instagram.com` only. See [PRIVACY.md](PRIVACY.md).

## Manual test checklist

The DOM-bound half needs a real, logged-in Instagram session and cannot be checked headlessly:

- [ ] Profile grid: hover a post tile and a Reel tile — the pill appears and positions correctly
- [ ] Explore page and hashtag page grids (no profile-page fallback handle available — note captured blank)
- [ ] Open a single post (permalink page `/p/{code}/`) and a Reel (`/reel/{code}/`) — the floating button appears
- [ ] Open a post from a feed as a dialog (not a permalink navigation) — the floating button still appears
- [ ] Save the same post twice — one card, numbers refreshed, note and collection untouched
- [ ] A carousel post — first slide's thumbnail saved, slide count shown
- [ ] A post with likes/comments hidden by the creator — those fields show "—", not 0
- [ ] A very long caption — stored in full, truncated with "click to expand" in the panel
- [ ] SPA navigation from grid → detail → back to grid, and via the browser back button
- [ ] Move a saved post between collections from the confirmation card and from the panel
- [ ] Rename a collection, add a new one
- [ ] Search across caption, handle and note
- [ ] Export CSV, Markdown and JSON; re-import the JSON backup and confirm no duplicates
- [ ] Clear all data, confirm the four default collections come back empty
- [ ] 500 saved posts — panel opens in under 500 ms and scrolls smoothly (PRD §7)

## Known limits

- Instagram's DOM is obfuscated and changes without notice; selectors are best-effort with graceful
  fallback to empty/null fields rather than a thrown error, per PRD §8.
- Cross-origin thumbnails without CORS headers cannot be read pixel-for-pixel; those posts store the
  remote CDN URL instead, and that URL can go stale if the post is deleted or the CDN edge expires it.
- No API access and no background crawling — a post's numbers are a snapshot from the moment you
  clicked Save, not a live figure (this is the point of the product, not a bug).
- Deleted or made-private posts keep their saved card; the "Open post" link may 404. The extension
  cannot detect this without making a network request, which it will never do.
