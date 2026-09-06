# X Velocity Finder

Chrome MV3 extension. Badges every post on X's timeline, search results and profiles with engagement
per hour since posting — not the raw totals X shows — plus an outlier ratio against the author's own
recent median. No account, no X API, no network requests.

Built from [PRD-12](../../docs/extensions/PRD-12-x-velocity-finder.md). The outlier engine
(median baseline, ratio badges, sample-size honesty) is the same shared module described in the
[extensions README](../../docs/extensions/README.md), applied to velocity instead of an
absolute ratio — see `src/velocity.ts`.

## Quick start

```bash
npm install
npm run icons          # regenerate src/icons/*.png (no image dependency)
npm run build          # dev build into dist/
npm run build:watch    # rebuild on change
npm run build:prod     # minified, production manifest name
npm test               # headless checks — velocity math, badges, filters, exports
npm run typecheck
npm run zip            # production build + dist/ packed for the Web Store
```

Node 18+ is required.

Load it: `chrome://extensions` → Developer mode → **Load unpacked** → select `dist/`.

## How it works

| File | Job |
| :-- | :-- |
| `src/velocity.ts` | The outlier engine — count parsing, engagement/hour, author-median ratio, badge text, filter matching, sort, the thread heuristic. Pure, fully tested. |
| `src/export.ts` | CSV/Markdown formatters, filenames, and the data-URL encoder that lets the content script hand a file to the background worker. Pure, fully tested. |
| `src/selectors.ts` | Every assumption about X's DOM, isolated to one file (see below). |
| `src/scan.ts` | Turns one `<article>` into a `RawPost`, using `selectors.ts` and `velocity.parseCount`. |
| `src/badges.ts` | Renders and updates the badge on a post, keyed by post id so DOM node recycling can't show a stale number. |
| `src/bar.ts` | The injected filter bar: min velocity, min ratio, age band, dim/hide, sort, export. |
| `src/content.ts` | Orchestration — scans the timeline, applies filters, sorts search results, watches for SPA navigation and infinite scroll, relays exports to the background worker. |
| `src/background.ts` | Service worker. Only job: turn a content-script-built data URL into a download — content scripts cannot call `chrome.downloads` directly. |
| `src/storage.ts` | `chrome.storage.local`: author medians, filter settings, local usage counters, backup export/import/clear. |
| `src/popup.ts` / `.html` / `.css` | The action popup — this tab's live status and the data-ownership controls (export all / import / clear all). |

### The formula, stated plainly

```
velocity = (likes + reposts + replies) ÷ hours since posting
ratio    = velocity ÷ the author's median velocity over their last 20 badged posts
```

Likes-only would be more stable; a composite is more accurate and more arguable (PRD §10). This
extension picks the composite and says so everywhere the badge appears — in the badge's tooltip and
in the filter bar — rather than hiding the choice.

### Reading X's DOM without an API (PRD §5, the gate)

There is no X API call anywhere in this extension. Every number comes from the rendered timeline:

- **Counts** come from each action button's `aria-label` (preferring the exact form) or its visible
  text, parsed by `parseCount` — abbreviated forms (`1.2K`) are kept abbreviated and flagged, never
  silently treated as exact (PRD §7).
- **Timestamps** come from the `<time datetime="…">` attribute on the permalink, which is exact even
  when the *visible* text is relative ("2h"). A post with no such element gets no velocity — the
  badge says `age unknown` rather than guessing.
- **Ads** are skipped entirely — no badge, no filtering — by checking for X's promoted-post markers
  before any parsing starts.
- **Reposts** are attributed to the original automatically: X renders a repost as the original post's
  own author block, with a separate "reposted" context line above it that this extension never reads
  as the author.
- **Quote posts** are badged using only their own counts; the embedded quoted post is not itself an
  `article[data-testid="tweet"]`, so it is never separately scanned or double-badged.
- **Threads**: badging every reply in a self-thread would be clutter the PRD explicitly rules out
  (§7). The only signal available without an API is DOM adjacency — consecutive timeline entries by
  the same author are treated as a thread continuation and only the first gets a badge. This is a
  heuristic, not a guarantee; see **Known limits**.

X ships DOM changes constantly with no deprecation courtesy (PRD §5). Every selector lives in
`src/selectors.ts` and returns `null` rather than throwing, so a layout change degrades one field
instead of taking the timeline down. `content.ts` additionally tracks how many consecutive scan
passes yield zero parsed posts on an otherwise populated timeline; past three, it disables badges for
the rest of the session rather than fail loudly on every mutation (PRD §6).

## Privacy

No `fetch`, no `XMLHttpRequest`, no `sendBeacon` — verifiable with `grep -rn "fetch(" src/` and in
devtools' network tab. Author medians, filter settings and usage counters live in
`chrome.storage.local` and are never transmitted. Post text and counts are read into memory for the
current tab only and are never written to storage — only the *derived* velocity number ever joins an
author's baseline. See [PRIVACY.md](PRIVACY.md).

## Manual test checklist

The DOM-bound half needs a real, logged-in X session — headless checks cover the math, not the markup.

- [ ] Home timeline: badges appear on posts within ~250ms of them rendering, no layout shift
- [ ] Infinite scroll: scrolling loads new posts and they get badged; scrolling back up doesn't
      re-badge stale/recycled nodes with the wrong numbers
- [ ] A profile timeline
- [ ] Search results: the "Sort by velocity" toggle appears only here, and reorders in place
- [ ] A promoted/ad post: no badge, not affected by filters
- [ ] A repost (no comment): badge reflects the original author and their numbers
- [ ] A quote post: the quote gets its own badge; the embedded quoted post is not separately badged
- [ ] A self-thread (same author, several posts in a row): only the first gets a badge
- [ ] A post under 5 minutes old: badge reads `too new`, not a huge number
- [ ] A post with an abbreviated count (`1.2K` likes): badge shows a `~`
- [ ] Filter bar: min velocity, min ratio, age band, each excludes the right posts
- [ ] Dim vs. Hide: dim lowers opacity and keeps posts in the DOM; hide removes them from view
- [ ] Export CSV and Markdown: file downloads, contains exactly the currently-filtered posts
- [ ] Popup: status line matches the active tab, export/import/clear round-trip author baselines
- [ ] Dark, dim and light X themes: badge and bar stay legible in all three
- [ ] `twitter.com` URLs behave identically to `x.com`

## Known limits

- The thread heuristic (consecutive same-author entries) can both under- and over-badge on unusual
  layouts (a reply from a different thread happening to follow the same author, or the algorithmic
  timeline interleaving something between two thread posts). It is a best-effort reading of the DOM,
  documented rather than presented as exact — PRD §5 accepts this trade-off for a product with no API.
- Baselines are per-browser-profile. Two devices, or a fresh profile, start with no author history.
- A very active session can build a baseline from a mix of ordinary and viral posts for the same
  author; the rolling window (last 20 samples) bounds how long an outlier keeps distorting the median.
- If X's markup changes enough that badges stop rendering, the extension goes quiet rather than
  breaking the timeline (PRD §6) — this is by design, but it does mean a broken build looks like "no
  badges" rather than an error. Check the popup's usage counters (`dom_layout_changed`) if badges seem
  to have stopped appearing.
