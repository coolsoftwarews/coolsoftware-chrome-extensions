# Web Highlighter & Markdown Export

Chrome MV3 extension. Highlight text on any page, attach notes, and export the page — or just your
marks — as Markdown, clean HTML, PDF or TXT. No account, no backend, no network requests.

Built from [PRD-05](../../docs/extensions/PRD-05-web-highlighter-markdown.md). The export
and PDF layers are ported from [YouTubeTranscription](../YouTubeTranscription), which is what makes
this a 1–1.5 week build rather than a three-week one.

## Quick start

```bash
npm install
npm run icons          # regenerate src/icons/*.png (no image dependency)
npm run build          # dev build into dist/
npm run build:watch    # rebuild on change
npm run build:prod     # minified, production manifest name
npm test               # headless checks — anchoring, exports, filenames, PDF bytes
npm run typecheck
npm run zip            # production build + dist/ packed for the Web Store
```

Node 18+ is required (the repo's default `node` may be older — this project was verified on v22).

Load it: `chrome://extensions` → Developer mode → **Load unpacked** → select `dist/`.

## How it works

| File | Job |
| :-- | :-- |
| `src/quote.ts` | Text-quote anchoring — pure string logic, three passes (exact → whitespace → fuzzy) |
| `src/anchor.ts` | The DOM half: flatten the page to text, translate offsets ⇄ ranges, paint `<mark>` |
| `src/content.ts` | Restores highlights, selection toolbar, highlight editor, persistence |
| `src/extract.ts` | Reader-view extraction and page metadata |
| `src/markdown.ts` | HTML → Markdown (headings, lists, tables, code, `<mark>` → `==…==`) |
| `src/formatters.ts` | The four export formats + filenames — pure, fully tested |
| `src/pdf.ts` | Dependency-free PDF writer (ported verbatim from the transcript extension) |
| `src/storage.ts` | `chrome.storage.local` records, backup export/import, quota status |
| `src/panel.ts` | Side panel: highlight list, export controls, data ownership |

### Anchoring, which is the whole ballgame

A highlight is stored as the quoted text plus 32 characters of prefix and suffix — never an XPath or
a node index, both of which break the moment a site reshuffles an ad slot. On load the content
script re-finds each quote by searching the page's flattened text:

1. **exact** — substring match, disambiguated by context and a position hint
2. **whitespace** — same, after collapsing all whitespace (survives a re-render or a rebuild)
3. **fuzzy** — matches the quote's first and last 24 characters and accepts the span between them,
   so an edited paragraph still anchors. Scored at half weight so it can never beat a real match.

A quote that cannot be found is **kept**, shown in the panel as "couldn't locate on the page", and
still exported in full with its note. Losing a note is the one unrecoverable failure this product
can have.

The restore/failure split is counted locally (panel → **Usage**). Watch that number: if the restore
rate drops, the product is rotting quietly.

## Privacy

No `fetch`, no `XMLHttpRequest`, no `sendBeacon` — verifiable with `grep -rn "fetch(" src/` and in
devtools' network tab. Highlights, notes and usage counters live in `chrome.storage.local` and are
never transmitted. `<all_urls>` exists only so marks can be restored on whatever you're reading.
See [PRIVACY.md](PRIVACY.md).

## Manual test checklist

The DOM-bound half needs a real browser. Before shipping, walk this on ~20 real sites (PRD §7 sets a
>90% restore target on revisit):

- [ ] News article, docs site, personal blog, Wikipedia, GitHub README, Substack, a heavy-ad site
- [ ] An SPA (highlight, navigate away in-app, navigate back — marks return)
- [ ] Infinite scroll (highlight far down, reload, scroll — the mark appears when content loads)
- [ ] Selection spanning multiple paragraphs, a list, a table cell, a code block
- [ ] Overlapping and nested highlights
- [ ] A dark-mode site (colours stay legible — light background, forced dark text)
- [ ] A site with strict CSP (toolbar still renders; it lives in a shadow root)
- [ ] Same article via `?utm_source=…` and `#fragment` (marks are shared, not duplicated)
- [ ] `chrome://extensions` and a `file://` page (panel says the page is unsupported, no errors)
- [ ] 10K-word page with 50 highlights (panel stays responsive, no layout shift on the page)
- [ ] Export all data → clear all → import → everything comes back
- [ ] Each of the four formats, in both scopes, with each option toggled

## Known limits

- Cross-origin iframe text cannot be highlighted (documented rather than half-supported).
- `file://` pages are unsupported unless the user grants file access; the panel says so.
- PDF export uses standard PDF fonts (WinAnsi), so non-Latin scripts are flagged and the panel
  points at `.md`/`.html` instead.
- PDF *file* annotation is a different problem entirely (canvas text layer) and is out of scope —
  see PRD §12, it is the most likely V2.
