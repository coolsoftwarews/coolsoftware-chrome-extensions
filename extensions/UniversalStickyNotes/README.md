# Universal Sticky Notes

Chrome MV3 extension. Drop a draggable, resizable, colored sticky note anywhere on any page. Notes
persist per-URL and reappear in the same spot next time you visit. No account, no backend, no network
requests.

Built from [PRD-40](../../docs/extensions/PRD-40-universal-sticky-notes.md). The build
system, `src/storage.ts`'s per-page-record/backup pattern and `src/url.ts`'s normalization are ported
directly from [WebHighlighter](../WebHighlighter), this portfolio's other cross-platform, `<all_urls>`
extension — see PRD-40 §2 for how the two products deliberately don't overlap: WebHighlighter marks up
existing text and exports a document; this one places a freestanding note anywhere on the page,
independent of any selection.

## Quick start

```bash
npm install
npm run icons          # regenerate src/icons/*.png (no image dependency)
npm run build           # dev build into dist/
npm run build:watch     # rebuild on change
npm run build:prod      # minified, production manifest name
npm test                # headless checks — url, position math, export/import/merge
npm run typecheck
npm run zip              # production build + dist/ packed for the Web Store
```

Node 18+ is required. Load it: `chrome://extensions` → Developer mode → **Load unpacked** → select
`dist/`.

## How it works

| File | Job |
| :-- | :-- |
| `src/position.ts` | Percentage-based position math — the whole mitigation for layout drift between visits (pure, fully tested) |
| `src/url.ts` | URL normalization, ported from WebHighlighter — same page reached two ways shares its notes |
| `src/content.ts` | The note overlay: renders, drags, resizes, recolors and deletes notes in a shadow root |
| `src/storage.ts` | `chrome.storage.local` records, backup export/import/merge, quota status |
| `src/formatters.ts` | The one export format — Markdown, across every page at once |
| `src/panel.ts` | Side panel: this page's notes, a cross-page searchable list, export, data ownership |
| `src/background.ts` | Turns the toolbar icon / keyboard shortcuts into "create a note" or "open the panel" |

### Position math, which is the whole ballgame

A note's spot is stored as a **percentage of the document's scroll width/height** at save time, not
raw pixels (PRD §5). On load, that percentage is reapplied against the *current* document size. This
survives ordinary layout drift — an ad loading, a sidebar resizing, a responsive breakpoint the user
didn't hit last visit — far better than a fixed pixel coordinate would.

It will **not** survive a full site redesign; a note may land somewhere that needs a drag back into
place. That's accepted (PRD §5): position is best-effort, but a note's **text is never lost** —
`clampToDocument` (in `src/position.ts`) also guarantees a note dragged toward an edge is always still
reachable, never permanently off-screen.

### Two writers, kept in sync

The content script is the writer while a tab is open and visible — dragging, resizing, recoloring,
editing text, all persist through it. The side panel manages the *cross-page* list (PRD's whole
reason to exist: search every note across every page, not just this one), including pages that have
no tab open at all, so it writes to `storage.ts` directly instead of routing through a content script
that might not exist. Both sides listen for `chrome.storage.onChanged` on their own page's key, so
whichever one didn't make the change re-renders to match. The accepted trade-off: two edits to the
exact same note in the exact same second, from the panel and the live page simultaneously, could race
— last write wins. Given the volume this product sees, that's a fair bet for V1.

## Privacy

No `fetch`, no `XMLHttpRequest`, no `sendBeacon` — verifiable with a search of `src/` and in devtools'
network tab. Notes, page metadata and usage counters live in `chrome.storage.local` and are never
transmitted. `<all_urls>` exists only so notes can be restored on whatever you're looking at. See
[PRIVACY.md](PRIVACY.md).

## Manual test checklist

- [ ] Drop a note via the toolbar icon, and via `Alt+Shift+N`; both land near the current viewport
- [ ] Drag a note, reload the page — it comes back in roughly the same spot
- [ ] Drag a note near the left/top/right/bottom edge — it's always still grabbable, never lost
- [ ] Resize a note down toward the minimum — it stops shrinking rather than becoming unusable
- [ ] Recolor a note through the swatch popover
- [ ] Arrow-key nudge a focused note's header; Delete/Backspace removes it — keyboard only, no mouse
- [ ] Type in a note, switch tabs before the debounce fires, come back — the text is still there
- [ ] "Hide notes on this page" toggle in the panel hides/reveals every note on that page
- [ ] Dropping a new note while hidden is on: the note appears immediately (deliberate act wins)
- [ ] Side panel: search finds a note by its text, and by the page's title/URL
- [ ] Side panel: "jump to page" activates an already-open tab, or opens a new one, and scrolls
- [ ] Delete a note from the panel while its page is open in another tab — the live page updates too
- [ ] Export Markdown — grouped by page, colors and text intact, empty notes labelled
- [ ] Export all data → clear all → import → everything comes back, notes matched by id (no dupes)
- [ ] Same page via `?utm_source=…` and via a bare URL — notes are shared, not duplicated
- [ ] A page with 30+ notes — panel and page both stay responsive
- [ ] `chrome://extensions`, the Chrome Web Store, and a `file://` page — toolbar icon does nothing,
      no error
- [ ] A page whose content changes dramatically since the note was placed — note reappears somewhere
      reasonable rather than vanishing, text intact

## Known limits

- Position is best-effort (percentage-based, not content-anchored) — a dramatic layout change can
  still misplace an old note. The text is never lost; see PRD §5.
- Concurrent edits to the exact same note from the panel and the live page in the same instant can
  race; last write wins. Documented above, not expected to matter at this product's actual usage
  volume.
- Cross-origin iframed pages are out of scope — the content script only runs in the top frame.
- Plain text only in V1; no rich text or images inside a note (PRD §4).
