# Pinterest Competitor Pin Research

Chrome MV3 extension. Save competitor pins into a local research library — title, full description,
destination domain/URL, board, creator, saves count and your note — organized into collections, and
export the lot as CSV, Markdown or JSON. No account, no backend, no network requests.

Built from
[PRD-17](../../docs/extensions/PRD-17-pinterest-competitor-research.md). This is the
**Saver** pattern from [the extensions README](../../docs/extensions/README.md) — same
shape as [WebHighlighter](../WebHighlighter)'s storage layer and
[InstagramResearchSaver](../InstagramResearchSaver) — wearing Pinterest's clothes.

## Quick start

```bash
npm install
npm run icons          # regenerate src/icons/*.png (no image dependency)
npm run build           # dev build into dist/
npm run build:watch     # rebuild on change
npm run build:prod      # minified, production manifest name
npm test                # headless checks — ids/urls, capture, search, exports, import merge
npm run typecheck
npm run zip              # production build + dist/ packed for the Web Store
```

Node 18+ is required. Load it: `chrome://extensions` → Developer mode → **Load unpacked** → select
`dist/`.

## How it works

| File | Job |
| :-- | :-- |
| `src/capture.ts` | Pure logic: pin id/URL normalization, `buildCapture` (dedupe/update-in-place), search, domain grouping |
| `src/merge.ts` | Pure import-merge logic (matched by id, incoming file wins) — split out so it's testable without mocking `chrome.*` |
| `src/thumbnail.ts` | Size-capping math (pure) + canvas-based downscale to a JPEG data URI (DOM-bound) |
| `src/formatters.ts` | CSV and Markdown export — pure, fully tested. JSON export is the backup itself |
| `src/storage.ts` | `chrome.storage.local` records, collections CRUD, backup export/import, quota status |
| `src/content.ts` | Injects the "+ Save to research" control on grid tiles and pin detail pages, scrapes and saves |
| `src/background.ts` | Opens the side panel from the toolbar icon |
| `src/panel.ts` | The research panel: search, group by collection or domain, notes, export, data ownership |

### The library is global, not per-page

WebHighlighter's panel shows one page's highlights, so it has to ask the content script "what's the
state of *this* page?" on every tab change. This product's library isn't page-scoped — it's every pin
you've ever saved — so the panel reads `chrome.storage.local` directly and re-renders on
`chrome.storage.onChanged`, which also picks up saves made by `content.ts` on a Pinterest tab in the
background. No message passing between panel and content script is needed at all.

### Grid capture vs. detail capture (PRD §6)

Pinterest's grid tiles essentially never expose the full description or destination URL — only the
pin detail page does. A grid save is still useful (fast, one click, gets the image and title into a
collection) but is always marked `descriptionTruncated: true` so the research file never quietly
passes off a partial capture as complete; the panel and the Markdown export both surface that flag.
Saving the same pin again from its detail page fills in the rest without creating a duplicate card —
matching by the pin's numeric id, not the whole URL, means a UTM parameter or a regional subdomain
never fools the dedupe.

### Thumbnails

Captured via canvas from the already-rendered `<img>` (no fetch), downscaled to fit within 240px on
the longer side and re-encoded as a JPEG data URI — same approach as
[PRD-07](../../docs/extensions/PRD-07-instagram-research-saver.md)'s Instagram saver. If the
image is cross-origin without CORS headers the canvas is "tainted" and capture fails; the card falls
back to storing the remote CDN URL instead and is flagged `imageIsRemote`, so a 1,000-pin library stays
inside `chrome.storage.local`'s budget rather than growing unboundedly.

### Regional domains

Pinterest's ccTLDs (`pinterest.de`, `pinterest.co.uk`, …) 308-redirect to a locale subdomain of
`pinterest.com` (e.g. `de.pinterest.com`, `uk.pinterest.com`) — verified directly rather than assumed.
`*://*.pinterest.com/*` already covers every one of those subdomains, so it's the only host permission
this extension needs; Chrome match patterns don't support a wildcard top-level domain (`pinterest.*`
is not valid syntax), which is why the PRD's shorthand had to be translated into this concrete pattern.

## Manual test checklist

The DOM-bound half — reading Pinterest's live markup, positioning the save button on a tile — needs a
real browser and cannot be exercised by `npm test`. Before shipping, walk this on the live site:

- [ ] Home feed grid: hover a tile, the save button appears, click saves without navigating away
- [ ] Search results grid and a board's grid — same check
- [ ] A pin's own detail page: the floating save button appears, captures the full description
- [ ] A pin with no description, and one with a very long description
- [ ] An idea pin (no single destination URL) — saves without a destination, doesn't throw
- [ ] A promoted pin
- [ ] Save the same pin from the grid, then again from its detail page — one card, richer data, no duplicate
- [ ] Infinite scroll: keep scrolling, new tiles keep getting a save button (virtualized grid re-render)
- [ ] A cross-origin image with no CORS headers — thumbnail falls back to the remote URL, no console error
- [ ] Panel: search, switch between "By collection" and "By domain", move a pin, edit a note, delete a pin
- [ ] Export each of CSV / Markdown / JSON; open the CSV in a spreadsheet; open the Markdown digest
- [ ] Export all data → clear all → import → everything comes back, including notes and collections
- [ ] 500+ saved pins: panel still opens quickly and search stays responsive (PRD §7 target: <600ms / <150ms)

## Known limits

- Pinterest's DOM is undocumented and changes without notice; `content.ts` scrapes defensively with
  multiple fallbacks (meta tags first, DOM heuristics second) but selectors may need updating after a
  Pinterest redesign — this is the accepted cost of not using their API (PRD explicitly rules that out).
- Cross-origin images without CORS headers can't be downscaled by canvas; the card keeps working with
  the remote URL instead (PRD §6 accepts that some images may later rot if the CDN URL expires).
- No write actions of any kind against Pinterest — this is permanent, not a V1 limit (see the extensions
  portfolio's hard constraints).
