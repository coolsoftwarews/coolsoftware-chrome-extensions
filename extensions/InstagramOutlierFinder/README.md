# Instagram Outlier Finder

Chrome MV3 extension. Badges every post on an Instagram profile grid with how it compares to the
account's own recent median — a 157K-view Reel on an account whose median is 18K is an 8.7× outlier,
which is a finding; a 2M-view post from an account that always does 2M is not. No account, no
backend, no network requests.

Built from
[PRD-06](../../docs/extensions/PRD-06-instagram-outlier-finder.md). The outlier engine
(median baseline, ratio badges, sample-size honesty) is the shared module the portfolio's README
calls out as reused across Instagram, TikTok, X, Pinterest and YouTube Pro Filters — this is its
Instagram implementation, and [YouTubeProFilters](../YouTubeProFilters) is the closest sibling in
shape (injected bar + badges over a platform's own grid, not a side panel).

## Quick start

```bash
npm install
npm run icons          # regenerate src/icons/*.png (no image dependency)
npm run build           # dev build into dist/
npm run build:watch    # rebuild on change
npm run build:prod     # minified, production manifest name
npm test               # headless checks — parsing, median, bands, exports, JSON signals
npm run typecheck
npm run zip            # production build + dist/ packed for the Web Store
```

Node 18+ is required. Load it: `chrome://extensions` → Developer mode → **Load unpacked** → select
`dist/`. Open any Instagram profile and scroll its grid.

## How it works

| File | Job |
| :-- | :-- |
| `src/outlier.ts` | The outlier engine: number parsing, median, band thresholds, ratio scoring — pure, fully tested |
| `src/signals.ts` | Best-effort reader for the JSON Instagram embeds alongside the grid (dates, exact counts) |
| `src/selectors.ts` | Every assumption about Instagram's DOM, isolated in one file, degrade-not-throw |
| `src/scan.ts` | Turns the current grid into `RawPost[]` using selectors.ts + signals.ts |
| `src/filters.ts` | The filter row and sort — pure, fully tested |
| `src/formatters.ts` | CSV and Markdown export, filenames — pure, fully tested |
| `src/badges.ts` | Draws the outlier badge over each grid tile |
| `src/bar.ts` | The injected header strip + filter/sort/export row |
| `src/content.ts` | Wires scan → score → filter → render, watches scroll and SPA navigation |
| `src/background.ts` | Service worker — the only thing content scripts can't do themselves: `chrome.downloads` |
| `src/storage.ts` | Last-used filter, per-profile median cache, backup export/import/clear |
| `src/metrics.ts` | Local usage counters, including the PRD's health metric (parse-failure rate) |
| `src/popup.ts` | Toolbar popup: local counters + data ownership (export all / import / clear all) |

### The outlier ratio, and where it comes from

Instagram renders a grid tile's like/comment counts into the DOM before the hover state that reveals
them — the count nodes exist whether or not the mouse is there. Reels additionally carry a plays
count in a corner chip. Dates never appear on a tile at all, so `signals.ts` also scans nearby
`<script>` tags for the hydration JSON Instagram ships to avoid refetching what it just rendered,
matching by shortcode with a bounded regex window rather than a strict `JSON.parse` of a minified
bundle. Either source failing degrades one field to "unknown" — an unknown value never hides a post
or excludes it from a filter (see `filters.ts`).

The median is computed from whatever's currently loaded, recomputed on scroll, and shown with its
sample size (`median of 24 loaded posts`). Below 12 posts it's shown greyed with "keep scrolling for
a reliable median" rather than presented as an account's baseline. Pinned posts are detected and
excluded from the median but still badged normally. When a post has no view count, the ratio falls
back to a like-based one computed against the *likes* median specifically — never against the views
median — and the badge says `× likes` so the two denominators are never silently mixed.

### Bands

`bandFor()` implements the band list in PRD §4 literally: `≥5×` and `≥2×` both render the 🔥 glyph,
`≥1.5×` renders `↑`, anything under renders `—`. Note the PRD's own illustrative example a few lines
above that list shows a 2.4× post as `↑`, which the band list itself contradicts — the band list is
treated as the spec of record here (see the comment in `outlier.ts`). Worth confirming with real
profiles before shipping, per PRD §10's open question on bands.

### Failure mode

Instagram rewrites its DOM on its own schedule (PRD §7, §9). `selectors.ts` isolates every DOM
assumption behind functions that return `null`/`[]` instead of throwing. If three consecutive scans
produce tiles with no readable counts at all, the overlay shows one quiet in-page notice — never a
broken grid — and bumps the local parse-failure counter, visible in the popup. That counter is the
product's health metric: watch it after any Instagram layout change.

## Privacy

No `fetch`, no `XMLHttpRequest`, no `sendBeacon` anywhere in this extension — verifiable with
`grep -rn "fetch(" src/` and in devtools' network tab. Everything read comes from the tab already
open in front of the logged-in user; everything stored stays in `chrome.storage.local`. See
[PRIVACY.md](PRIVACY.md).

## Manual test checklist

The DOM-bound half needs a real, logged-in Instagram session and is not exercised by `npm test`:

- [ ] A personal account profile and a business/creator account profile, logged in
- [ ] The same profile, logged out (view counts may disappear — badges should degrade, not break)
- [ ] A profile with fewer than 12 posts loaded (header greys out, "keep scrolling" shows)
- [ ] Scroll to load 50+ posts; badges recompute without visible jank, no layout shift in the grid
- [ ] A profile with at least one pinned post (excluded from the median, still badged)
- [ ] A profile mixing Reels, carousels and photo-only posts (some rows fall back to `× likes`)
- [ ] An account with one viral post (its badge reads `20×+`, not a four-digit multiplier)
- [ ] Each filter (`>2×`, `>5×`, Reels, Posts, 30d, 90d, all loaded) and each sort
- [ ] Export `.csv` and `.md`, with a filter applied — only the visible set is written
- [ ] Navigate profile → post → back via Instagram's own in-app links (SPA navigation, no reload)
- [ ] Popup: usage counters populate, export/import/clear-all round-trip correctly
- [ ] Devtools Network tab stays empty the entire time

## Known limits

- Instagram's grid tiles don't expose a date without the hydration JSON landing; when that JSON
  can't be matched to a tile, that post's date is blank in the header/export rather than guessed.
- Selectors were built from the grid's publicly documented shape, not verified against a live,
  logged-in session in this environment — re-validate `src/selectors.ts` against real profiles before
  the Web Store submission, and watch the parse-failure counter after any Instagram redesign.
- Private accounts and profiles the user doesn't follow show whatever grid Instagram renders for that
  viewer (often nothing) — the extension has no way around that, by design (PRD §5).
