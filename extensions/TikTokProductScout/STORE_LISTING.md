# Chrome Web Store listing — TikTok Product Scout

## Name

`TikTok Product Scout`

## Single purpose

> Badge TikTok videos with an outlier ratio and commercial markers (shop link, product tag, bio
> link, discount code), and let the user track a product across the independent creators posting it,
> building a local board of what's showing repeat traction — with CSV and Markdown export.

## Short description (132 char max)

`See which TikTok products keep beating creators' own averages across multiple accounts. No account, no cloud — everything stays local.`

## Category

Productivity → Workflow & Planning (alternate: Shopping)

## Detailed description

**A single viral video proves nothing. Five creators, all outperforming their own norm, is a market
forming.**

TikTok Product Scout badges every video you scroll past with:

```
🔥 6.2× · 340K · 🛒 shop link
```

— how many times this video is outperforming that creator's own recent median, the view count, and
whether it carries a real shop link or just shop-sounding caption text (labelled differently, always).

When a video has a commercial marker, **+ Track** adds it to your product board. Group by the shop
item TikTok already tagged, a caption keyword, or a name you type. Each board entry shows videos
collected, first/last seen dates, and — the number that actually matters — **distinct creators**,
because one creator posting five times proves nothing and five creators posting once each proves
something.

Filter by minimum ratio, commercial markers only, a time window, or minimum views. Export the board
as CSV (product, creators, videos, views, ratios, dates, links) or a Markdown summary.

**Honest about what it is.** The board is built by browsing, not by querying — it shows you "from N
videos you've viewed", not a claim to have scanned all of TikTok. Outlier ratios show as "pending"
until a creator's profile has been visited (there's no baseline to compare against yet), and a
one-video baseline is flagged low-sample rather than hidden. No sales, revenue or GMV estimates —
this extension cannot see them, and inventing a number would be the fastest way to lose your trust.

**No account. No cloud. No network.**

Everything lives in your browser's local storage. This extension makes no network requests at all —
verifiable in devtools in about ten seconds. Export your board as a backup, import it back, or wipe
everything with one click.

**Built for**

Ecommerce and dropship sellers scouting proven demand before a market floods. TikTok Shop sellers
deciding what to stock next. Agencies building a client shortlist. Affiliates picking what to promote
this month.

## Permission justifications (for review)

| Permission | Justification |
| :-- | :-- |
| `activeTab` | Lets a toolbar-icon click reach the currently active tab, to toggle the on-page product board drawer. |
| `storage` | Persisting tracked products, creator baselines and export preferences locally. |
| `downloads` | Writing the exported .csv/.md file and the JSON backup the user requests. |
| Host `*://*.tiktok.com/*` | The extension's entire function — reading video tiles, counts and commercial markers, and rendering the badge/board overlay — happens on tiktok.com. No other site is accessed, and no data leaves the device. |

**Remote code:** none. All code is bundled in the package; no eval, no remote scripts.
**Data usage disclosures:** none of the categories apply — no data is collected or transmitted.

**Test instructions for the reviewer**

> Open tiktok.com and scroll the for-you feed. Badges appear on video tiles within a moment. Click
> "+ Track" on a badge that shows a shop marker, name the product, then click the "Product Scout" tab
> on the right edge of the page (or the toolbar icon) to open the board and see it listed. No account
> or sign-in is required or offered.

## Screenshots (1280×800)

1. The for-you feed with badges visible on several tiles, one showing "+ Track"
2. The product board open, showing a card with a large distinct-creator count
3. The "+ Track product" modal, choosing between an existing product and a new one
4. The board's filters row narrowing the list by minimum ratio and commercial-only
5. A CSV export open in a spreadsheet beside the board

## Support and privacy links

- Privacy policy: publish [PRIVACY.md](PRIVACY.md) at a stable URL
- Support: repository issues page
