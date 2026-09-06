# Universal Citation & Link Copier

Chrome MV3 extension. Press a shortcut — or open the popup and pick a format — and the current page
is on your clipboard as a Markdown link, a plain URL, or an APA/MLA/Chicago citation. No account, no
backend, no network requests.

Built from
[PRD-41](../../docs/extensions/PRD-41-universal-citation-copier.md). Cross-platform, like
[WebHighlighter](../WebHighlighter) and [ScreenCap](../ScreenCap) — it works on any website, not a
platform allowlist.

## Quick start

```bash
npm install
npm run icons          # regenerate src/icons/*.png (no image dependency)
npm run build          # dev build into dist/
npm run build:watch    # rebuild on change
npm run build:prod     # minified, production manifest name
npm test               # headless checks — citation formatting, fallback chains
npm run typecheck
npm run zip            # production build + dist/ packed for the Web Store
```

Node 18+ is required (verified on v22/v24).

Load it: `chrome://extensions` → Developer mode → **Load unpacked** → select `dist/`.

## How it works

| File | Job |
| :-- | :-- |
| `src/citation.ts` | Pure logic: field fallback chains, name inversion, date rendering, and all five formatters. No DOM — fully unit tested |
| `src/extract.ts` | The one DOM-touching function (`collectRawMeta`), injected into the active tab via `chrome.scripting.executeScript({ func })` |
| `src/background.ts` | Service worker — handles the `quick-copy` keyboard shortcut only |
| `src/offscreen.ts` / `offscreen.html` | Gives the service worker a document context so it can write to the clipboard (MV3 service workers have no DOM) |
| `src/popup.ts` / `popup.html` / `popup.css` | Toolbar popup — live preview of all five formats, one click to copy any of them |
| `src/storage.ts` | The extension's entire local footprint: one value, the last-used format |

### Why there's an offscreen document

`navigator.clipboard.writeText()` needs a document with focus. The popup has one, so it writes to the
clipboard directly. The keyboard shortcut does **not** open the popup — it copies silently in the
background, using whatever format was last used — and a service worker has no DOM at all. The
offscreen document exists solely to give it one, per Chrome's documented pattern for this exact case
(`chrome.offscreen.Reason.CLIPBOARD`).

### Why `collectRawMeta`'s helpers live inside the function, not beside it

`chrome.scripting.executeScript({ func })` serializes only that function's own source text and
re-runs it in the page's isolated world. A call out to a sibling module-level helper would be
undefined there — so every helper `collectRawMeta` needs (`metaContent`, `bylineHeuristic`) is a
nested function declaration inside it. Nested declarations travel with the outer function's source;
siblings don't.

### Field fallback chains (PRD §5)

| Field | Chain | Terminal fallback |
| :-- | :-- | :-- |
| Title | `og:title` → `<title>` → first `<h1>` | `"Untitled page"` |
| Site name | `og:site_name` | hostname (always available) |
| Author | `article:author` / `meta[name=author]` → `link[rel=author]` → byline heuristic | omitted — the citation reformats to start at the title |
| Published date | `article:published_time` → `meta[name=date]` → `<time datetime>` | omitted — APA/MLA drop the date; Chicago substitutes "Accessed {today}" |
| URL | `link[rel=canonical]` → `location.href` | always available |

The rule the whole file is built to satisfy: **no missing field may ever produce a visible
artifact** — no `undefined`, no empty `()`, no dangling `, ,` or `. .`. `scripts/selftest.mjs` checks
every formatter with every field individually missing, and with author *and* date both missing at
once, against that exact rule.

## Manifest, verified

- **No `clipboardWrite` permission is declared, because none exists.** Chrome MV3 has no
  `clipboardWrite` (or `clipboardRead`) manifest permission — clipboard access is the standard Web
  Clipboard API (`navigator.clipboard`), gated by document focus and user-activation rules, not by
  anything in `manifest.json`. Verified against Chrome's extension permissions reference during this
  build; both the popup (a focused document, click = user gesture) and the offscreen document (an
  approved exception for background clipboard writes, declared via `chrome.offscreen.Reason.CLIPBOARD`)
  satisfy those rules without an extra permission string.
- **No `downloads` permission.** The only output is a clipboard write — nothing is ever saved to
  disk, so this extension needs one permission fewer than the portfolio's file-exporting siblings.
- **No `tabs` permission.** `chrome.commands.onCommand`'s callback receives the active tab, and its
  `url` is populated because the extension already holds `<all_urls>` host permission — a `tabs`
  permission grant is only needed when there's no host-permission match, which is never true here.
- Final permission set: `activeTab`, `scripting`, `storage`, `offscreen` + host permission
  `<all_urls>`.

## Privacy

No `fetch`, no `XMLHttpRequest`, no `sendBeacon` — verifiable with `grep -rn "fetch(" src/` and in
devtools' Network tab. The one value this extension stores (the last-used format) lives in
`chrome.storage.local` and is never transmitted. See [PRIVACY.md](PRIVACY.md).

## Manual test checklist

The DOM-bound half (`extract.ts`) needs a real browser:

- [ ] A page with complete Open Graph tags — all five formats read correctly
- [ ] A page with no metadata at all (a bare local test HTML file) — title falls back to `<h1>` or
      `"Untitled page"`, author is omitted, date is omitted/"Accessed today" as appropriate, nothing
      reads "undefined"
- [ ] A page with `article:author` vs. one with only a `rel="author"` link vs. one with only a
      byline-class element — each fallback level is exercised
- [ ] An SPA that changes its `<title>` after initial load (e.g. a client-routed app) — copy after
      navigating in-app reflects the *current* title, not the one from first load
- [ ] The keyboard shortcut on a fresh install (no format used yet) defaults to Markdown, copies
      silently, and flashes the toolbar badge
- [ ] The keyboard shortcut on `chrome://extensions` or a `file://` page — badge shows the error
      state, no broken clipboard write
- [ ] Popup on the same two cases above — the loading state briefly appears, then either the format
      list or a plain-language error message, never a blank popup
- [ ] Copying from the popup updates which row is marked "Shortcut" (the new default), and the next
      shortcut press uses it
- [ ] Screen reader: copy confirmation is announced (ARIA live region), all buttons are reachable and
      operable by keyboard alone

## Known limits

- Author-name inversion ("First Last" → "Last, First") is a best-effort heuristic for two/three-token
  Western names; organizational bylines and non-Latin/no-space names are left as given rather than
  mangled. See PRD §10.
- No PDF or non-HTML page support — this reads DOM `<meta>` tags on a rendered HTML page only.
- No citation library, no saving across pages, no bibliography assembly — this is a one-shot "copy
  this one now" tool by design. See PRD §4.
