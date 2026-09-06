# TikTok Product Scout

Chrome MV3 extension. Badges TikTok videos with an outlier ratio (this creator's views vs. their
own median) and any commercial marker (shop link, product tag, bio link, discount code), then lets
you track a product across every creator posting it and watch the "distinct creators" count grow.
No account, no backend, no network requests.

Built from [PRD-08](../../docs/extensions/PRD-08-tiktok-product-scout.md). Its pair,
[TikTok Creator Outlier Finder](../../docs/extensions/PRD-09-tiktok-creator-outliers.md),
shares the same Outlier engine — see `src/outlier.ts`.

## Quick start

```bash
npm install
npm run icons          # regenerate src/icons/*.png (no image dependency)
npm run build          # dev build into dist/
npm run build:watch    # rebuild on change
npm run build:prod     # minified, production manifest name
npm test               # headless checks — parsing, outlier engine, markers, filters, export
npm run typecheck
npm run zip            # production build + dist/ packed for the Web Store
```

Node 18+ is required. Load it: `chrome://extensions` → Developer mode → **Load unpacked** → select
`dist/`. Open any tiktok.com tab afterwards (the content script only runs on pages loaded after
install/reload).

## How it works

| File | Job |
| :-- | :-- |
| `src/parse.ts` | Pure string parsing — compact numbers ("340K" → 340000), video ids/handles from URLs, page classification |
| `src/outlier.ts` | The Outlier engine — creator median baseline, ratio, sample-size honesty |
| `src/markers.ts` | Commercial-marker detection — DOM-verified shop links vs. caption-text heuristics, kept clearly separate |
| `src/aggregate.ts` | Turns tracked products + the panel's filters into what the board displays (distinct creators, median ratio, dates) |
| `src/export.ts` | CSV + Markdown summary formatters, filenames — pure, fully tested |
| `src/storage.ts` | `chrome.storage.local` records: tracked products, creator baselines, coverage counter, backup export/import/clear |
| `src/metrics.ts` | Local-only usage counters mapped to PRD §8's success metrics |
| `src/scan.ts` | DOM half: finds video tiles on feed/search/hashtag/profile pages, reads what it can off them |
| `src/badge.ts` | Renders and positions the per-video badge overlay (never inserted into TikTok's own layout) |
| `src/shell.ts` | Shared shadow root + toast, so nothing here leaks TikTok's CSS in or ours out |
| `src/drawer.ts` | The product board — a slide-in drawer inside the page's own shadow root, not a `chrome.sidePanel` |
| `src/content.ts` | Boots on every TikTok page: scanning loop, mutation observer, profile baseline updates, drawer wiring |
| `src/background.ts` | Service worker — forwards a toolbar click to the active tab to toggle the drawer, nothing else |

### Why the product board is not a `chrome.sidePanel`

PRD-08 §6 names the permission budget explicitly: `activeTab`, `storage`, `downloads` + the TikTok
host permission — no `sidePanel`, no `tabs`, no `scripting`. WebHighlighter and YouTubeTranscription
both use `chrome.sidePanel` for their panels; this extension draws the board as a slide-in drawer
inside the same shadow root as the badges instead, which keeps the manifest at exactly what the PRD
asked for. `dist/manifest.json` after a build should declare only those three permissions plus the
host permission — that is the thing to check before shipping if this file ever changes.

### The Outlier engine, and what makes it commercial rather than creator intelligence

The pair PRD (TikTok Creator Outlier Finder) asks "is this video good for this creator". This one
asks "is this *product* showing repeat traction across *independent* creators" — PRD §4's core
insight is that a single viral video proves nothing, so the unit that matters is the **distinct
creator count** on a tracked product, not any one video's ratio. `src/aggregate.ts` computes that
count from unique creator handles across a product's tracked videos, and it is deliberately the
largest number on every board card.

The ratio itself: `views ÷ creator's own median views`, where the median comes from view counts read
off the creator's profile grid (PRD §5: "cache medians per creator when the user visits a profile").
Three states, never blurred together:

- **pending** — no baseline yet for this creator; the badge says "pending", never a guessed number
- **low-sample** — a baseline exists but from fewer than 3 videos, so the median is one or two data
  points wearing a stats word (PRD §7: "flag, don't hide")
- **reliable** — 3+ videos behind the median

### Commercial markers: verified vs. heuristic

PRD §4: "Shop links are reliable; caption patterns are not. Label the difference in the badge and
never present a heuristic as a fact." `src/scan.ts` looks for an actual TikTok Shop element in the
tile's DOM first (`confidence: 'verified'`); `src/markers.ts` only ever *adds* caption-text guesses
("link in bio", a discount-code pattern, `#TikTokShop`) on top, always `confidence: 'heuristic'`. The
badge shows "🛒 shop link" for a verified marker and "🛒 possible link" for a heuristic-only one — two
different sentences, never the same one.

### What gets stored, and what doesn't

Only videos the user explicitly tracks (via "+ Track" on a badge) are written to
`chrome.storage.local` — a video merely scanned in the feed is never persisted. That keeps storage
bounded by how much the user actually curates rather than how much they scroll, and it is why there
is no pruning logic in `src/storage.ts` the way WebHighlighter needs one. The one running counter is
"videos viewed" (for the honest coverage line PRD §5 asks for — "from 42 videos you've viewed"),
which is a single incrementing number plus a small capped ring buffer used only to avoid
double-counting a tile the feed recycled back into view.

## Privacy

No `fetch`, no `XMLHttpRequest`, no `sendBeacon` — verifiable with `grep -rn "fetch(" src/` and in
devtools' network tab. Products, baselines and usage counters live in `chrome.storage.local` and are
never transmitted. See [PRIVACY.md](PRIVACY.md).

## Manual test checklist

The DOM-bound half (`scan.ts`, `badge.ts`, `drawer.ts`, `content.ts`) needs a real TikTok session and
is not covered by `npm test`. PRD §5 gates this whole product on a 1–2 day spike before committing
further — confirm the following before treating badge coverage as reliable:

- [ ] For-you feed, following feed, a search results page, a hashtag page, a single video page —
      badges appear on visible tiles within ~300ms and never shift TikTok's own layout
- [ ] Scroll a feed for a few minutes: badges track their tiles, no duplicate badges pile up, no
      badge is left orphaned after its tile is recycled
- [ ] A video that actually has a TikTok Shop tag shows "🛒 shop link"; a video with only "link in
      bio" in the caption shows "🛒 possible link" — never the same label
- [ ] Visit a creator's profile: their videos' view counts build a baseline; badges for their other
      videos elsewhere flip from "pending" to a ratio on the next scan
- [ ] A creator with only one visible video still gets a ratio, marked "(low sample)"
- [ ] "+ Track" on a commercial-marker badge opens the modal; adding to an existing product merges
      rather than duplicates; creating new with a typed name works
- [ ] Open the product board (toolbar icon, or the on-page tab): distinct-creator count is correct,
      filters narrow the list, Export CSV and Export MD both download a real file
- [ ] Age-gated or region-restricted tiles get no badge at all, and do not error in the console
- [ ] A tile TikTok has redesigned so the scanner can't read it produces no badge and no console
      error — the rest of the feed keeps working
- [ ] Export all data → clear all → import → everything comes back

## Known limits

- View counts, captions and shop markers are read with best-effort, layered CSS selectors rather
  than one documented API — TikTok's markup changes without notice, and a tile that can't be read
  simply gets no badge (PRD §7). This is the part PRD §5's spike exists to de-risk before investing
  further.
- No sales, revenue or GMV estimates, by design (PRD §4: "the fastest way to lose a seller's trust").
- No supplier or sourcing links, no automation of the TikTok account, no price tracking — all
  explicitly out of scope for V1.
- Publish dates are rarely exposed in tile markup and are left `null` rather than guessed from a
  relative string like "3d ago"; the board's dates are all "when you tracked it", not "when it
  posted".
