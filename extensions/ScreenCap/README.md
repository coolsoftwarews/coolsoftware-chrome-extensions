# Screen Capture

Capture → annotate → share. A full-page screenshot extension (MV3) that stays out of your way.

Built to [PRD-02](../../docs/extensions/PRD-02-screen-capture.md). This is the
shipping repackage of an internal ScreenCapture project — a deliberately
smaller product, not a port of everything that was there.

**Positioning:** privacy + no account, ever. No upload, no sign-in, no watermark. Captures
never leave the device, which is why there is no backend in this directory.

## Build

Requires Node 20+ (the repo's default `node` on PATH is v12; use nvm to select a newer one).

```bash
npm install
npm run build     # icons → typecheck → vite build, output in dist/
npm run dev       # rebuild on change
npm run zip       # dist/ → screencap-<version>.zip for the Web Store
```

Load `dist/` via `chrome://extensions` → Developer mode → **Load unpacked**.

Icons are generated from `scripts/make-icons.mjs`, so `public/icons/*.png` is gitignored.

## What ships

| Area | Included |
| :-- | :-- |
| Capture modes | Full page, visible area, selected region |
| Editor | Crop, rectangle, arrow, blur, text (S/M/L) |
| Export | PNG, JPEG, PDF, copy to clipboard |
| Shortcut | `Alt+Shift+P` for full page |

Keyboard shortcuts in the editor: `V` select, `C` crop, `R` rectangle, `A` arrow, `B` blur,
`T` text, `Ctrl+Z` undo.

## The subtraction pass

Everything below existed in the old build and is **not** in this one. Nothing is
feature-flagged off — it is absent, including from the permission list and the store copy.

| Cut | Why |
| :-- | :-- |
| Screen/audio recording | Out of scope per PRD; it also drove the `<all_urls>` and media permissions |
| Cloud upload, share links, accounts, `api/` + `SPA/` | Reverses the privacy positioning |
| Ellipse, polygon, emoji, image-paste, presets, layers, multi-select | Past the 20% that defines the product |
| Draft autosave, settings page, per-tool shortcut remapping | A settings page for a tool with four tools is a tell |
| PDF page-size options (A4/Letter) | One page, sized to the image |

**Permissions after the pass:** `activeTab`, `scripting`, `downloads`, `storage`, `offscreen`.
`<all_urls>` and `tabs` are gone — the extension only ever sees a page the user explicitly
invoked it on. Adding a permission back needs a KEEP feature behind it.

## Architecture

```
popup ──START_CAPTURE──▶ service worker ──inject──▶ page agent (content script)
                              │                        measure / scroll / hide sticky / region select
                              ├──frames──▶ offscreen document (canvas stitch + crop)
                              └──payload──▶ editor tab (annotate + export)
```

The finished capture is handed to the editor tab **in memory** (`GET_CAPTURE`), never
written to `chrome.storage`, so a multi-megabyte screenshot never touches disk. If the
service worker is evicted before the editor asks, the editor says so and the user recaptures.

### Edge cases handled

- **Sticky headers** — the first frame keeps the real header; every frame after hides
  `fixed`/`sticky` elements via one injected stylesheet, so they don't repeat down the stitch.
- **Lazy images** — each scroll step waits for pending images, capped at 1.2 s per frame.
- **Inner scroll containers** — the agent finds the element that actually owns the scroll
  instead of measuring a phantom document height.
- **Rate limiting** — `captureVisibleTab` is throttled by Chrome; frames are spaced 520 ms.
- **Short last frame** — frames are placed at the scroll offset the page actually landed on,
  so the final overlapping frame overwrites cleanly rather than leaving a seam.
- **Pages past ~32,767 px** — truncated, with a banner in the editor saying so.
- **`chrome://`, Web Store, PDF viewer** — a plain "can't capture this page" message, plus a
  badge on the toolbar icon when triggered by the keyboard shortcut (no popup to show it in).
- **Cross-origin iframes** — a documented limitation; `captureVisibleTab` grabs whatever the
  compositor shows, so cross-origin frames render as the user sees them but cannot be scrolled.

## Instrumentation

Counters only, in `chrome.storage.local` under `metrics`, never transmitted. Read them from
the extension console with `chrome.storage.local.get('metrics')`. Tracked: capture by mode,
capture failure by reason, editor tool used, export by format, copy used — the inputs to the
PRD's 30/90-day metrics, including the "is annotation usage near zero?" decision.

## Not planned

Cloud share links and team libraries are the credible paid path in this category and are
exactly what V1 excludes. Revisit above ~5,000 active users, and only as an opt-in Pro tier —
turning it on for the free product would reverse the positioning the listing is built on.
