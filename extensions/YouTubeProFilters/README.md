# YouTube Pro Filters

Chrome MV3 extension. Filters YouTube search results by **views/day**, **channel size** and **outlier ratio** — the signals that tell you what's actually breaking out, rather than what's merely big.

Implements [PRD-03](../../docs/extensions/PRD-03-youtube-pro-filters.md).

## Build

Requires Node 18+ (the repo's global `node` is 12; use nvm to switch).

```bash
npm install
npm run icons        # regenerates public/icons/*.png — only needed if the mark changes
npm run build        # dev build with inline sourcemaps → dist/
npm run build:prod   # minified → dist/
npm run build:watch
npm run typecheck
npm run zip          # production build + release/youtube-pro-filters-<version>.zip
```

Load it via `chrome://extensions` → Developer mode → **Load unpacked** → `dist/`.

## How it resolves the §7 risk

The PRD flagged getting subscriber counts and channel medians as the thing that decides whether this product is good or mediocre. The approach shipped here is **DOM parsing plus opportunistic background enrichment**, with no API key and no backend:

- Views, publish date, duration and Shorts/live status come from the search DOM.
- The service worker fetches each result channel's `/videos` tab once and pulls the subscriber count and the median view count of its ~30 most recent uploads out of the embedded `ytInitialData`. That single fetch yields both the channel-size filter and the 🔥 outlier ratio.
- Results are deduped per channel, capped at 3 concurrent fetches, and cached in `storage.local` for 7 days (1 hour on failure).

Consequences worth knowing:

- View counts are approximate — YouTube renders "1.2M", so a views/day figure inherits that precision.
- The median is *recent form*, not lifetime, which is the right denominator for "is this an outlier" but will read differently from vidIQ's number.
- If enrichment fails, the extension still filters on everything the DOM provides. It never blocks the page and never breaks search.

## Architecture

| Path | Role |
| :-- | :-- |
| [src/content/selectors.ts](src/content/selectors.ts) | **Every** DOM assumption, isolated and fail-soft. The only file an A/B layout test should require touching. |
| [src/content/scan.ts](src/content/scan.ts) | Result element → `ResultData` |
| [src/content/index.ts](src/content/index.ts) | Orchestration: scan → filter → sort → badge → enrich; SPA and infinite-scroll rebinding |
| [src/content/bar.ts](src/content/bar.ts) | The injected filter bar |
| [src/content/badges.ts](src/content/badges.ts) | `2.4K/day` and `🔥 4.2×` thumbnail overlays |
| [src/lib/filters.ts](src/lib/filters.ts) | Pure metric derivation, predicates and sort comparators |
| [src/lib/parse.ts](src/lib/parse.ts) | Pure parsers for YouTube's display strings |
| [src/background/channel.ts](src/background/channel.ts) | Channel scrape and extraction |
| [src/background/index.ts](src/background/index.ts) | Fetch dedupe, concurrency cap, cache |

Two rules the code holds to throughout:

1. **An unknown value never excludes a result.** A bound only rejects a result whose value is known — otherwise items would flicker out of the page as enrichment landed.
2. **Nulls sink in a sort.** Results missing the sort key go to the bottom instead of being scattered by a null-as-zero comparison.

## Scope

V1 is search results only (`/results`). Channel pages, the watch page, the homepage, alerts, exports and accounts are all explicitly out — see §4 of the PRD.

## Instrumentation

Local only. Counters live in `chrome.storage.local` and are visible in the toolbar popup, which also resets them. Nothing is transmitted, and no counter records a video, channel or query.
