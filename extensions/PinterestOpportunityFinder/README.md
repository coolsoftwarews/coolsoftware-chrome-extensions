# Pinterest Opportunity Finder

Chrome MV3 extension. On a Pinterest search, badges each pin with an outlier ratio against the
median of the loaded results, and builds a keyword table from what the outlier pins have in
common — the words and phrases, the domains, and the formats. No account, no backend, no network
requests.

Built from [PRD-16](../../docs/extensions/PRD-16-pinterest-opportunity-finder.md). The
CSV/Markdown export layer follows the same pattern as
[WebHighlighter](../WebHighlighter)'s and [YouTubeTranscription](../YouTubeTranscription)'s.

## Quick start

```bash
npm install
npm run icons          # regenerate src/icons/*.png (no image dependency)
npm run build           # dev build into dist/
npm run build:watch     # rebuild on change
npm run build:prod      # minified, production manifest name
npm test                # headless checks — outlier engine, keywords, filters, exports
npm run typecheck
npm run zip              # production build + dist/ packed for the Web Store
```

Node 18+ is required. Load it: `chrome://extensions` → Developer mode → **Load unpacked** →
select `dist/`. Then open a Pinterest search and click the toolbar icon.

## How it works

| File | Job |
| :-- | :-- |
| `src/domains.ts` | The full list of Pinterest ccTLDs, plus URL/query helpers |
| `src/extract.ts` | DOM extraction — anchors on `/pin/<id>/` links, degrades quietly on markup drift |
| `src/outlier.ts` | The outlier engine — median baseline, ratio badges, sample-size honesty |
| `src/keywords.ts` | Keyword/phrase over-representation, domain and format stats, repin grouping |
| `src/filters.ts` | Min ratio, domain, text-overlay and last-N filters |
| `src/formatters.ts` | CSV (pins, keywords) and Markdown report + filenames — pure, fully tested |
| `src/content.ts` | Scans the grid, paints badges on cards, re-scans on scroll and navigation |
| `src/storage.ts` | `chrome.storage.local`: last filter, cached median per query, backup export/import |
| `src/metrics.ts` | Local-only usage counters matching the PRD's success metrics |
| `src/panel.ts` | The toolbar popup: filters, pin list, keyword panel, exports, data ownership |

### The outlier engine, which is the whole ballgame

Pinterest exposes engagement inconsistently — save counts show up on some pins and not others, and
the numbers aren't always current (PRD §5). So the engine never guesses:

1. Only pins with a **readable, numeric** save count feed the median. Promoted pins and idea pins
   are excluded — they aren't comparable to a standard pin — and shown with their own label instead
   of a score.
2. The median is only trusted when **at least half** of the eligible pins expose a number, and there
   are **at least 5** of them. Below that, the whole result set's badges fall back to the pin's
   position in Pinterest's own result order — labelled as a rank, never presented as a save count.
3. Every badge carries the sample size it was computed from, visible on hover.

The keyword panel treats **repins of the same source image** (recognised across Pinterest's CDN size
variants) as one entry, so a single popular image reposted under five domains can't dominate the
phrase counts — while the results list still shows each of those five pins separately, since they
are different opportunities to chase.

### Extraction, and its known fragility

Pinterest's internal component names and class hashes change often. `src/extract.ts` anchors on the
one thing that has stayed stable — the `/pin/<id>/` URL — rather than any CSS class, and every
per-card extraction step is wrapped so one malformed card degrades to "no data" for that card
instead of aborting the whole scan. When Pinterest changes markup enough that no pins are found, the
panel shows an empty state, never a wrong number.

Two things it cannot do reliably, by design, rather than guess and be wrong:

- **Text-overlay detection** is a light heuristic on alt-text length and punctuation, not OCR. Most
  pins report "Not detected" rather than a guessed true/false.
- **Save counts** depend entirely on what Pinterest renders. If a result set doesn't expose enough of
  them, the ratio badge is dropped for that entire set (see the outlier engine above) — this was the
  PRD's stated go/no-go spike, implemented as a runtime check rather than a one-time decision.

## Privacy

No `fetch`, `XMLHttpRequest` or `sendBeacon` anywhere in this extension — verifiable with
`grep -rn "fetch(" src/` and in devtools' Network tab while it runs. Filters, cached medians and
usage counters live in `chrome.storage.local` and are never transmitted. See [PRIVACY.md](PRIVACY.md).

## Manual test checklist

DOM extraction needs a real Pinterest page and cannot be checked headlessly. Before shipping:

- [ ] A search with visible save counts on most pins → ratio badges, red 🔥 tone, correct median
- [ ] A search where saves are mostly hidden → every badge falls back to rank, never a number
- [ ] Scroll to trigger infinite scroll → new pins get badges, the median updates, no layout shift
- [ ] A search containing at least one promoted pin → labelled "Promoted", excluded from the median
- [ ] A search containing at least one idea pin → labelled "Idea pin", excluded from the median
- [ ] A non-English query (e.g. a French or Japanese search term) → keyword table still populates
- [ ] Two repins of the same image from different domains → results list shows both, keyword panel
      counts the image once
- [ ] Apply each filter individually and in combination; "Clear filters" resets them
- [ ] Each export button (Pins .csv, Keywords .csv, Report .md) opens cleanly in Excel/Obsidian
- [ ] Data → export all data → clear all data → import → filters and cached medians come back
- [ ] A non-search Pinterest page (home feed, a pin's own page) → panel explains why there's nothing
- [ ] A Pinterest regional domain (e.g. pinterest.co.uk) → content script still runs

## Known limits

- Extraction is heuristic DOM scraping. Pinterest can change markup at any time; the extension is
  built to degrade to an empty state rather than crash or show wrong numbers, but a periodic check
  against live Pinterest is still needed.
- Text-overlay detection is best-effort (PRD §4: "where detectable") — most pins will read "Not
  detected" rather than a guessed answer.
- No search volume, no scheduling, no board actions, no image download, no tracking over time — all
  explicitly out of scope for V1 (PRD §4).
