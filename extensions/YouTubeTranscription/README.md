# YouTube Transcript Export

Chrome MV3 extension. Turns any YouTube video transcript into a clean document — Markdown, TXT or PDF — in two clicks.

Built to [PRD-01](../../docs/extensions/PRD-01-youtube-transcript-export.md). Standalone: no backend, no accounts, no analytics leaving the device.

## Build

The repo's default `node` is v12, which cannot run esbuild or tsc. Use Node 18+:

```bash
npm install
npm run icons          # regenerates src/icons/*.png (already committed)
npm run build          # dev build  -> dist/
npm run build:prod     # minified, production manifest name
npm run typecheck
npm test               # headless checks for formatting, filenames, PDF byte layout
npm run zip            # production build + dist/ packed for the Web Store
```

Load `dist/` via `chrome://extensions` → Developer mode → Load unpacked.

Production build weighs ~35 KB against the PRD's 500 KB budget; `npm run build` prints the number and flags an overrun.

## How it works

The hard part is caption access. YouTube requires a Proof-of-Origin Token (`pot`) on every `/api/timedtext` request; without it the endpoint returns 0 bytes from every context — MAIN world, ISOLATED world, service worker, XHR alike.

So the extension never builds a timedtext URL from scratch. It:

1. fetches `youtube.com/watch?v=…` as plain HTML from the service worker and reads `playerCaptionsTracklistRenderer` out of the embedded player JSON;
2. injects into the page's MAIN world, toggles the CC button on and straight back off, and lifts the `pot` parameter off YouTube's own request via `performance.getEntriesByType('resource')`;
3. re-requests the caption track with `&c=WEB&pot=…` appended, and parses the timedtext XML.

This is the approach proven in production in the SavePosty extension (a separate, private project; not part of this repo). All SavePosty backend and auth coupling was stripped during the port — the service worker refuses any fetch whose host is not `youtube.com`.

## Layout

| File | Role |
| :-- | :-- |
| `src/background.ts` | side panel lifecycle, youtube.com-only fetch proxy |
| `src/content.ts` | under-player "Transcript" button, player seeking, SPA navigation events |
| `src/panel.ts` | panel UI: load, search, language switch, options, exports |
| `src/transcript-extractor.ts` | POT dance, watch-page parsing, timedtext parsing, grouping |
| `src/formatters.ts` | Markdown / TXT / PDF-input shaping, filename convention |
| `src/pdf.ts` | dependency-free PDF writer (Helvetica, WinAnsi) |
| `src/metrics.ts` | local-only counters |
| `scripts/gen-icons.mjs` | draws the icon PNGs from scratch (no binary assets to maintain) |
| `scripts/selftest.mjs` | headless checks for everything that does not need a browser |

## Design notes

**PDF without a dependency.** A real PDF library or an embedded font would eat the bundle budget on its own, so `pdf.ts` writes PDF 1.4 by hand using the two standard Helvetica faces every viewer ships with. The trade-off is WinAnsi encoding: glyphs outside Latin-1 (Cyrillic, CJK, Greek…) cannot be drawn. Those are replaced with `?`, reported back through `unsupportedCharacters`, and the panel tells the user to take Markdown or TXT instead. `npm test` verifies the cross-reference table, which is the part most likely to silently corrupt a hand-rolled PDF.

**Metrics.** The PRD asks for instrumented events with no PII and no server. Every event is a counter in `chrome.storage.local`; the panel footer's "Usage" link shows them and offers a reset. Nothing is transmitted.

**Rendering long transcripts.** A 3-hour podcast is thousands of lines, so the list renders in 250-line chunks across animation frames rather than in one blocking pass. A newer render invalidates an in-flight one via a token.

**Permissions.** `scripting`, `storage`, `downloads`, `sidePanel`, plus host permission for `*://*.youtube.com/*` — that host permission is what lets `chrome.tabs.query` read the active tab's URL without also requesting the broader `tabs` permission. No broad host access — this is the store-review posture the PRD asks for.

## Manual verification

The extraction path needs a live tab and cannot be covered headlessly. Before shipping a build, walk this list:

- [ ] Video with manual captions loads in under ~4 s cold
- [ ] Video with auto-generated captions only
- [ ] Video with no captions → "This video has no captions available", not a blank panel
- [ ] Live stream and an upcoming premiere → unsupported message
- [ ] Age-restricted video → unsupported message
- [ ] Multiple tracks sharing a language code → manual and auto listed distinctly
- [ ] Language switch, including a translated (not native) language
- [ ] 3h+ podcast → panel stays responsive while rendering
- [ ] Click a line → player seeks to that point
- [ ] Search → filters and highlights; clearing restores the full list
- [ ] Each of Copy / .md / .txt / .pdf, with each combination of the three options
- [ ] Filename is `{channel} - {title} - transcript.{ext}`, ≤120 chars
- [ ] Navigate to another video without reloading → panel reloads itself
- [ ] Toolbar icon, under-player button and `Alt+Shift+T` all open the panel
- [ ] Panel is disabled on non-YouTube tabs

## Out of scope for V1

No AI, no summarization, no chat-with-video, no notes, no accounts, no cloud sync, no backend, no subscription, no bulk or playlist export. Per the PRD, those are V2 conversations that only happen if V1 gets traction.

## Open items from the PRD

- **Firefox/Edge builds** — deferred until Chrome review passes. The extension uses `chrome.sidePanel`, which Firefox does not implement; a Firefox port needs `browser.sidebarAction` and a manifest fork.
- **Under-player button and store review** — implemented behind a single `content_scripts` entry on youtube.com. If review pushes back, delete the injection block in `src/content.ts` and the toolbar path still covers the feature.
