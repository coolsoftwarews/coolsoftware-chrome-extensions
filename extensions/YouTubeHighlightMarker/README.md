# YouTube Highlight Marker & Clip-Index Exporter

Chrome MV3 extension. Mark in/out highlights while a YouTube video plays, and export a timestamped, thumbnailed shot list as Markdown or CSV.

Built to [PRD-33](../../docs/extensions/PRD-33-youtube-highlight-marker.md). Standalone: no backend, no accounts, no analytics leaving the device. It produces a *list*, never a video file — actually cutting the clips is a different, internal product (ClipWizard), and this extension is fully useful without it.

## Build

The repo's default `node` is v12, which cannot run esbuild or tsc. Use Node 18+:

```bash
npm install
npm run icons          # regenerates src/icons/*.png (already committed)
npm run build          # dev build  -> dist/
npm run build:prod     # minified, production manifest name
npm run typecheck
npm test               # headless checks: mark ordering, export formatting, filenames, backup merge
npm run zip            # production build + dist/ packed for the Web Store
```

Load `dist/` via `chrome://extensions` → Developer mode → Load unpacked.

Production build weighs ~38 KB against the 500 KB budget; `npm run build` prints the number and flags an overrun.

## How it works

1. **Marking.** `src/content.ts` puts a "Mark in" / "Mark out" button pair under the player (mirrored in the side panel) and listens for `Alt+Shift+I` / `Alt+Shift+O`. Pressing a button captures `video.currentTime`, clamped to `[0, video.duration]`, plus a best-effort thumbnail. Two presses — of either kind, in either order — combine into one clip candidate; `src/marks.ts` sorts them into `in`/`out` by timestamp and flags the pair as `swapped` if that required correcting which button was pressed first (PRD §7).
2. **Thumbnails.** `src/thumbnail.ts` draws the live `<video>` frame onto a `<canvas>` and reads it back with `toDataURL()` — no network request. This is the one real technical risk in the product (PRD §5): cross-origin/DRM'd media can taint the canvas and throw `SecurityError` on read-back, with no fix available from content-script code. The grab is wrapped in a `try/catch` with no retry; on any failure the mark still saves, timestamp-only.
3. **Storage.** `src/storage.ts` keys every clip list by video id in `chrome.storage.local`. The panel only *shows* the currently open video's list, but all videos' marks persist and are included in the full backup export.
4. **Navigation.** YouTube is an SPA and never does a full page load between videos. If an in-point is set but no out-point yet when the video changes, the unfinished mark is discarded — but the user is warned with an on-page toast and a panel status line, not left to notice it silently gone (PRD §7).
5. **Export.** `src/export.ts` writes Markdown (thumbnails embedded as data URIs, so the file is one self-contained document) and CSV (timestamps and notes only, no images, per PRD §4).

## Layout

| File | Role |
| :-- | :-- |
| `src/background.ts` | side panel lifecycle, forwards the two keyboard commands to the active tab's content script |
| `src/content.ts` | on-page mark buttons, thumbnail capture trigger, player seeking, SPA navigation handling |
| `src/thumbnail.ts` | the canvas frame-grab, isolated so its one failure mode is easy to find |
| `src/marks.ts` | pure logic: pending-press state machine, in/out ordering, short-clip flagging |
| `src/export.ts` | Markdown / CSV formatting, filename convention |
| `src/storage.ts` | `chrome.storage.local` wrapper, per-video keys, full backup export/import/clear |
| `src/metrics.ts` | local-only usage counters |
| `src/panel.ts` | side panel UI: mark controls, clip list, notes, seek, export, data sheet |
| `scripts/gen-icons.mjs` | draws the icon PNGs from scratch (no binary assets to maintain) |
| `scripts/selftest.mjs` | headless checks for everything that does not need a browser tab |

## Design notes

**Marks are DOM-free logic wrapped in a thin DOM shell.** Every rule the PRD's edge cases describe — out-of-order marks, short clips, clamping near the ends of a video, backup merge-by-id — lives in `marks.ts`/`export.ts`/`storage.ts`'s pure functions and is covered by `npm test`. `content.ts` and `panel.ts` are glue: they read `video.currentTime`, call the pure functions, and render the result. Nothing DOM-dependent is where the actual decision-making happens.

**The panel never owns pending-mark state.** It lives in `content.ts`, per tab, so marking still works with the side panel closed — the whole point of an on-page button pair plus keyboard shortcuts. The panel reflects it via a ping on load and a small set of broadcast messages (`YHM_PENDING_CHANGED`, `YHM_CLIP_ADDED`, `YHM_NAVIGATED`, `YHM_PENDING_DISCARDED`).

**Metrics.** Local-only counters in `chrome.storage.local`, viewable and resettable from the panel's Data sheet. No video ids, no notes, no thumbnails — counts and the day they happened, nothing else.

**Permissions.** `activeTab`, `storage`, `downloads`, `sidePanel`, plus `*://*.youtube.com/*`. No `scripting`, no broad `tabs` grant — the content script is declared statically against the host permission, and the panel only queries the active tab's URL (which `activeTab` already covers).

**ClipWizard cross-link.** PRD §2/§10: this product is a natural top-of-funnel for ClipWizard, but the link only appears in the panel after a user has exported at least once — after they've found value, not before. The extension has zero runtime dependency on ClipWizard; the link is inert copy, not a feature gate.

## Manual verification

The canvas frame-grab and player interaction need a live tab and cannot be covered headlessly. Before shipping a build, walk this list:

- [ ] Mark in, let the video play, mark out → a clip candidate appears in the panel with a thumbnail
- [ ] Mark out before mark in → the pair is still created, correctly ordered, and shown as "order corrected"
- [ ] Press the same mark button twice before completing the pair → the pending point moves, no duplicate/overlapping clip
- [ ] Mark in and out within under a second → clip is created and flagged "short clip", not blocked
- [ ] Mark at 0:00 and at the final second of the video → both are valid, no clamping error
- [ ] Set an in-point, navigate to another video before marking out → a toast and panel status explain the mark was discarded
- [ ] `Alt+Shift+I` / `Alt+Shift+O` work identically to the on-page and panel buttons
- [ ] Click a clip's timestamp → player seeks to that instant
- [ ] Edit a note inline → persists after closing and reopening the panel
- [ ] Delete a clip → removed from the list and from storage
- [ ] Export Markdown → thumbnails render inline when opened in a Markdown viewer; a clip with a failed thumbnail shows "(thumbnail unavailable)" instead of a broken image
- [ ] Export CSV → opens cleanly in a spreadsheet, no image data anywhere, commas/quotes in notes survive round-trip
- [ ] Data → Export all, then Import into a fresh profile → every video's marks return, no duplicates on a second import
- [ ] Data → Clear all → every mark, on every video, gone
- [ ] Panel gate screen appears on a non-YouTube tab; "Open YouTube" works
- [ ] A page where canvas capture is expected to fail (heavily DRM'd content, if reproducible) still produces a timestamp-only mark rather than a broken export

## Out of scope for V1

No actual video cutting, re-encoding or export of video/audio — that's ClipWizard's job. No cloud rendering. No auto-highlight-detection (silence/scene-change analysis). No playlist-wide marking session. Per the PRD, these are only reconsidered if V1 gets traction.

## Open items from the PRD

- **Cross-video library view** — deferred. All videos' marks persist and are in the full backup export, but the panel only ever shows the currently open video's list, to keep the UI narrow.
- **Notes-only Markdown export (no thumbnails)** — not built; watch for support requests before adding a toggle.
