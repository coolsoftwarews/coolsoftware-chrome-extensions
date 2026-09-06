# X Card Exporter

Chrome MV3 extension. Turn any X (Twitter) post — or a short thread — into a clean, branded PNG
card. Rendered entirely on your device with `<canvas>`: no upload, no server, no account.

Built from [PRD-28](../../docs/extensions/PRD-28-x-card-exporter.md). See that PRD's §2
for why this is client-side by design (the incumbents in this category — TwitterShots, Pikaso,
PostSpark, TweetPik — all render server-side; this product bets that "instant and private" beats
"polished and server-rendered" for the common "screenshot this post" job).

## Quick start

```bash
npm install
npm run icons          # regenerate src/icons/*.png (no image dependency)
npm run build          # dev build into dist/
npm run build:watch    # rebuild on change
npm run build:prod     # minified, production manifest name
npm test               # headless checks — text/script detection, wrapping, layout, templates, filenames
npm run typecheck
npm run zip            # production build + dist/ packed for the Web Store
```

Node 18+ is required.

Load it: `chrome://extensions` → Developer mode → **Load unpacked** → select `dist/`.

## How it works

| File | Job |
| :-- | :-- |
| `src/text.ts` | Script detection (RTL/CJK), count formatting, date labels — pure |
| `src/layout.ts` | Word-wrapping + full card geometry, driven by an injected `measure` function — pure, no canvas |
| `src/templates.ts` | The three style templates (Light / Dark / Minimal) as plain data |
| `src/avatar.ts` | Avatar URL upgrade, CDN-domain check, initials fallback — pure |
| `src/filenames.ts` | Single-card and sequential thread filenames — pure |
| `src/scrape.ts` | The DOM half: finds a post's `<article>`, reads author/handle/avatar/text/date/metrics, gathers a thread |
| `src/render.ts` | The canvas half: loads the avatar (with CORS/taint handling), calls `computeCardLayout`, draws, exports a PNG data URL |
| `src/content.ts` | Floating "Save as image" / "Save thread" badges, the export panel (template picker + live preview), keyboard handling |
| `src/background.ts` | The download relay — `chrome.downloads` isn't available inside a content script |
| `src/popup.ts` / `popup.html` | Usage counters, last-used template, clear-local-data |

### Why the pure/DOM split matters here specifically

There is no canvas in Node, so `render.ts` itself can never be unit-tested in this build's CI. The
fix used across this portfolio (WebHighlighter's `anchor.ts`/`quote.ts`, Etsy's `extract.ts`/
`stats.ts`) applies here too: every number that decides *what* to draw — where the avatar circle
sits, how many lines the body text wraps to, whether the card grew taller, where the ellipsis lands
— lives in `layout.ts` as pure functions with an injected `measure(text) => width` callback.
`render.ts` just calls `ctx.measureText(s).width` as that callback and draws exactly what
`computeCardLayout` says. `scripts/selftest.mjs` exercises `layout.ts` with a deterministic
monospace `measure` function (`s => s.length * 10`) and gets full coverage of the wrapping/
truncation/geometry logic without ever touching a real `CanvasRenderingContext2D`.

### The avatar CORS/taint problem (PRD §5)

Drawing a cross-origin image (the post's avatar, from `pbs.twimg.com`) onto a canvas without a
CORS-permitted load **taints** the canvas — the browser still lets you draw and display it, but
`canvas.toDataURL()` then throws instead of producing a file. `render.ts` handles this in three
layers, none of which can block an export:

1. The avatar `<img>` is always requested with `crossOrigin = "anonymous"`.
2. If it fails to load (or takes more than 2.5s), the card renders an initials circle instead —
   no blocked/broken export waiting on a slow image.
3. Even if the image *did* load, the final `toDataURL()` call is wrapped in `try/catch`. On a
   caught `SecurityError` the card is silently re-rendered without the avatar and that clean canvas
   is what gets exported.

**This could not be verified against a live x.com session in this build environment** (no network
access to x.com). The `avatar_fallback` usage counter (visible in the popup, and named explicitly in
PRD §8/§9) is the intended live signal for whether path 2/3 above turns out to be the common case —
see the PRD's own spike note before treating the avatar path as production-verified.

### DOM selectors that need live verification before shipping

`scrape.ts` follows the same `data-testid`-first convention as this portfolio's other X extension
(`XConversationSaver`) for author/handle/text/date/metrics, which is a confirmed-working pattern
in this codebase. The one selector that extension didn't need and this one does —
`[data-testid="Tweet-User-Avatar"] img` for the avatar, with a `img[src*="profile_images"]`
fallback — is a best-effort guess, not verified against a live page in this build environment. Check
it first on a real x.com session before relying on the real-avatar path in production; the
initials-circle fallback means a wrong guess here degrades the product, it does not break it.

## Manual test checklist

`scrape.ts`, `render.ts` and `content.ts` are DOM/canvas-bound and need a real browser + a live X
session:

- [ ] A short reply, a long post (triggers wrapping + truncation), a media-only post with little text
- [ ] A post whose author display name is missing/empty (protected/deleted account edge case)
- [ ] A thread of 3+ posts, all one author — "Save thread" produces N sequential PNG downloads
- [ ] A reply chain with mixed authors — thread detection still gathers what's rendered
- [ ] RTL text (Arabic/Hebrew post) — card renders right-aligned, right-to-left
- [ ] CJK text (Japanese/Chinese/Korean post, no spaces) — wraps by character, doesn't overflow
- [ ] A post whose avatar fails to load (slow network, blocked image) — initials circle, no broken export
- [ ] All three templates, checking Minimal genuinely omits the metrics row
- [ ] Scrolling the timeline fast — badges track the right post, no stale/duplicate badges after X
      recycles list-cell DOM nodes
- [ ] Keyboard-only: Tab into a badge, Enter to open the panel, Tab cycles inside the panel and wraps,
      Escape closes and returns focus to the badge that opened it
- [ ] `chrome://extensions` and non-X tabs — no badges, no errors (host permissions don't match)

## Known limits

- Quote-tweets render only the quoting post's own text/author, not a nested inset card for the
  quoted post (PRD §4/§7 — a deliberate V1 scope cut).
- Thread export is N separate PNG downloads, not one stacked image or a ZIP (PRD §4's own V1
  decision, with the reasoning written out there).
- No video/GIF export, ever — this is a static-image product by design, not a V1 gap.
