# Chrome Web Store listing — TikTok Creator Outlier Finder

## Name

`TikTok Creator Outlier Finder`

## Short description (132 char max)

`See which of a creator's TikToks broke out, and what their hooks share. Badges + CSV/Markdown export. No account, no cloud.`

## Category

Productivity → Workflow & Planning

## Detailed description

**Every profile has a median. Some videos blow way past it. This finds them and shows you why.**

Open any TikTok profile and each video in the grid gets badged against that creator's own median views:

```
Median: 24K views  (of 36 loaded)

🔥 11.4×  274K
🔥  4.8×  115K
↑   1.9×   46K
—   0.7×   17K
```

Then open the **hook panel** for whatever's on screen, and see what the outliers actually have in
common — as counts, never advice:

> 7 of 9 outliers open with a question
> 6 of 9 use #storytime, vs 1 in 10 of the baseline
> Outliers here run 8–15s; the baseline is 30s+

Filter by ratio (>2×, >5×), last 30/90 days or video length, sort by ratio/views/date, then export the
filtered set — CSV or Markdown, hook column included — into whatever scripting doc comes next.

**No account. No cloud. No network.**

This makes no network requests at all — verify that in devtools in about ten seconds. Everything it
reads comes from the profile page already open in your tab, and everything it remembers (cached medians,
your last filter) lives in your browser's local storage. Export it, import it, or wipe it with one click.

**Built for**

Creators checking which of their own videos actually broke out. Marketers and agencies reverse-engineering
a competitor's best-performing hooks. Researchers sampling what works in a niche, with the sample size
always shown honestly rather than implied.

**What it won't do**

No posting, liking or following — nothing on TikTok is touched, only read. No AI-generated "why this
worked" summary; the hook panel counts patterns, it doesn't guess at causes. No tracking a creator over
time.

## Permission justifications (for review)

| Permission | Justification |
| :-- | :-- |
| `activeTab` | Lets the popup show whether the currently active tab is a TikTok profile, evaluated only when the user opens the popup. |
| `storage` | Persisting cached per-creator medians, the user's last-used filter, and local usage counters — all locally, none transmitted. |
| `downloads` | Writing the exported .csv/.md file and the JSON data backup the user requests. |
| Host `*://*.tiktok.com/*` | The extension's core function — reading the video grid on a TikTok profile page and drawing outlier badges over it — cannot work with a narrower or on-demand permission, since the badges and header strip need to render as the grid loads and lazy-scrolls. No other site is accessed, and no data leaves the device. |

**Remote code:** none. All code is bundled by esbuild into the package: no `eval`, no `new Function`, no
CDN scripts.
**Data usage disclosures:** none of the categories apply — no data is collected or transmitted off-device.

## Screenshots (1280×800)

1. A creator profile with the median strip and 🔥/↑/— badges visible over the grid
2. The hook panel open, showing 3–4 observations with counts
3. The filter row (ratio/date/length chips) narrowing the grid to outliers only
4. A CSV export open in a spreadsheet, hook column visible
5. The popup: usage counters and the export/import/clear data controls

## Support and privacy links

- Privacy policy: publish [PRIVACY.md](PRIVACY.md) at a stable URL
- Support: repository issues page
