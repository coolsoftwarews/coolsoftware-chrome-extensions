# TikTok Creator Outlier Finder

Chrome MV3 extension. Open any TikTok profile and see instantly which videos broke out against that
creator's own median — badged on the grid, with a hook panel that lists what the outliers' captions,
hashtags, length and posting time have in common. No account, no backend, no network requests.

Built from
[PRD-09](../../docs/extensions/PRD-09-tiktok-creator-outliers.md). Same outlier-engine shape
(median baseline, ratio badges, sample-size honesty) the portfolio's other outlier finders share, built
against this PRD's own thresholds rather than assumed to match its Instagram sibling.

## Quick start

```bash
npm install
npm run icons          # regenerate src/icons/*.png (no image dependency)
npm run build          # dev build into dist/
npm run build:watch    # rebuild on change
npm run build:prod     # minified, production manifest name
npm test               # headless checks — parsing, outlier engine, filters, hooks, export
npm run typecheck
npm run zip            # production build + a zip for the Web Store
```

Node 18+ is required.

Load it: `chrome://extensions` → Developer mode → **Load unpacked** → select `dist/`. Then open a
creator's profile, e.g. `https://www.tiktok.com/@handle`.

## How it works

| File | Job |
| :-- | :-- |
| `src/parse.ts` | Pure text parsing — compact numbers, durations, video/profile ids, hashtags, hook patterns |
| `src/selectors.ts` | Every assumption about TikTok's DOM, isolated so a layout change touches one file |
| `src/scan.ts` | Turns the loaded grid into `ScannedVideo[]`, never throwing |
| `src/outlier.ts` | The outlier engine — median, ratio, badge band, sample-size honesty, the 20×+ cap |
| `src/filters.ts` | >2×/>5×, last 30/90 days, length band, sort — pure functions over the snapshot |
| `src/hooks.ts` | The hook panel: observations with counts, gated behind a minimum sample |
| `src/export.ts` | CSV and Markdown writers + filenames — pure, fully tested |
| `src/badges.ts` | Paints the per-tile badge and hides tiles the current filters exclude |
| `src/panel.ts` | The injected header strip: median/sample, filter chips, hook panel, export buttons |
| `src/content.ts` | Orchestrates scan → filter → sort → render on load, scroll and SPA navigation |
| `src/background.ts` | The one privileged hop an export needs: content script → download |
| `src/storage.ts` | `chrome.storage.local` — cached medians per creator, last-used filter, backup export/import/clear |
| `src/metrics.ts` | Local-only usage counters — never transmitted |
| `src/popup.ts` / `popup.html` | Usage counters and data ownership controls |

### The outlier engine (PRD §4, §5, §7)

The median is computed over **loaded, non-pinned videos with a readable view count**. Pins are excluded
from the median — a creator's pinned best work would otherwise drag every account's median up and make
it look flat (§5) — but a pinned video still gets badged against that median, since a pinned outlier is
still an outlier.

Badge bands: **🔥 fire** at ≥2× the median, **↑ up** at 1–2×, **— flat** below 1×. Ratios are capped at
`20×+` for display (§7's one-hit-account case) without losing the underlying number for sort/export.
Under 12 loaded videos, the median is shown but flagged low-sample rather than hidden — sample size is
always visible, never implied.

### The hook panel (PRD §4, §10)

For whatever set of outliers is currently on screen, the panel counts — never advises:

- Captions ending in `?` ("opens with a question") and captions opening with a digit — punctuation-based,
  not a grammar parse, so it holds across languages (§7).
- Hashtags used by ≥50% of the outliers but ≤20% of the full loaded baseline.
- The length band of the outliers vs. the baseline, when enough durations are readable.
- Posting hour/day buckets, when enough dates are readable.

Below **8 outliers** (PRD §10's open question, resolved to 8) the panel says so instead of showing noise
from a handful of videos.

### What TikTok's grid actually exposes — read this before shipping

PRD §5 calls for a half-day spike confirming that view counts, durations, captions and dates are
readable from the profile grid without opening each video, before committing to this UI shape. That spike
was **not run against a live TikTok session** as part of this build — there's no browser available here to
verify current selectors against TikTok's real, frequently-changing DOM. What's implemented instead:

- View counts are read via `data-e2e="video-views"` (TikTok's own test hook), which is what §5 predicts
  will be reliably present.
- Captions are read from the thumbnail `<img alt>` when TikTok sets one, with a `data-e2e` fallback.
  **This is the one most likely to come back empty in practice** — if it does, the hook panel's caption
  observations simply don't appear (see "No captions were readable" below) rather than breaking anything.
- Durations and post dates are read defensively (a duration badge on the tile, a `<time>` element) but
  TikTok's profile grid is not known to expose either reliably. Filters and observations that depend on
  them degrade to "not available" rather than excluding videos on missing evidence — see `filters.ts` and
  `hooks.ts` for exactly where that line is drawn.

**Before publishing:** load a real profile, open devtools, and confirm `src/selectors.ts`'s selectors
still match. If TikTok has moved the caption/duration/date off the grid entirely (the case §5 flags as
requiring an on-demand, click-per-video redesign), that is a real product-shape decision, not a
selector tweak — see PRD §5's fallback plan before changing the UI to match.

## Privacy

No `fetch`, `XMLHttpRequest` or `sendBeacon` anywhere in this extension — verify with
`grep -rn "fetch(" src/` or the network tab. Everything lives in `chrome.storage.local` and is never
transmitted. See [PRIVACY.md](PRIVACY.md).

## Manual test checklist

The DOM-bound half needs a real TikTok session.

- [ ] A creator profile with 50+ videos: badges appear within ~400ms of the grid rendering, no layout shift
- [ ] Scroll to lazy-load more videos: the median recomputes, sample size grows, badges update in place
- [ ] A profile with fewer than 12 videos: median still shows, flagged low-sample
- [ ] A profile with a pinned video: the pin doesn't drag the median down for everything else
- [ ] A profile with a genuine one-hit video: badge caps at `20×+`, doesn't blow out the layout
- [ ] Each filter chip (ratio, date, length) and each sort option
- [ ] Hook panel below 8 outliers: "not enough data" message, no noise
- [ ] Hook panel at 8+ outliers: observations read as counts, not advice
- [ ] Export CSV and Markdown; open both and confirm the hook column is populated
- [ ] A private/age-gated/region-blocked profile: no console errors, notice shown if the grid can't be read
- [ ] Photo/slideshow posts mixed into the grid: badged like any other post, no crash
- [ ] Popup off TikTok: shows the "open a profile" gate, not a blank usage list
- [ ] Export all data → clear all → import → the median cache and filter come back

## Known limits

- Duration and posted-date filters (and the hook panel's length/timing observations) are only as good as
  what TikTok's grid exposes for those fields on a given day — see "What TikTok's grid actually exposes"
  above. Nothing is faked or guessed to fill the gap.
- No tracking of a creator over time — that needs a server, which is explicitly out of scope (PRD §4).
- No AI-generated "why this worked" summary. The hook panel is observations with counts; turning those
  into advice is a different, riskier product this one deliberately isn't.
