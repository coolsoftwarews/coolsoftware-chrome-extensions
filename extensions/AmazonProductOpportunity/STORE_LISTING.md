# Chrome Web Store listing — Amazon Product Opportunity Overlay

## Name

`Amazon Product Opportunity Overlay`

## Single purpose

> Read an Amazon search or category results page the user is already viewing and show how contested
> that category is — review moat, rating ceiling and brand concentration — plus a watchlist of
> searches/products the user chooses to track locally, with CSV/Markdown export. No account, no
> backend, and no sales, revenue or best-seller-rank estimates.

## Short description (132 char max)

`See how contested an Amazon category is — review moat, rating ceiling, brand concentration. No account, no cloud, no estimates.`

## Category

Productivity → Workflow & Planning (or Shopping, if the store's taxonomy separates it)

## Detailed description

**Is this category winnable, or a wall?**

Search Amazon like you normally would. This extension reads the results page that's already loaded
in your tab and shows the category read above the results:

> Category read: 42 results · median 380 reviews · median rating 4.2 · 11 distinct brands
> Moat: moderate · Rating ceiling: soft (3 of 10 top results under 4.3)

Plus a badge on every listing with its rating, review count, price and Prime status, and filters —
max reviews, minimum rating gap, price band, brand — that flag the listings worth a second look.

**Watch a search or a product.** One click saves today's snapshot locally. Come back next week and
see the delta: `+140 reviews since 12 Aug`. No notifications, no background polling — just an honest
number when you look again.

**Export what you found.** CSV or Markdown, for the result set or your whole watchlist.

**What this is not.** Every paid competitor sells you a modelled revenue or sales-rank estimate. This
extension never does — no such number appears anywhere in it. Everything shown is either a number
Amazon already printed on the page, or a plain bucket label computed over the real medians of those
numbers. No API, no scraping of pages you haven't opened, no account.

**No account. No cloud. No network.**

This extension makes no network requests at all — verifiable in devtools in about ten seconds. Your
watchlist and preferences live in your browser's local storage. Export everything as one JSON file,
import it back on another machine, or wipe it with one click.

**Built for**

New sellers sizing up whether a category is winnable. Established sellers scanning adjacent
categories quickly. Researchers and agencies doing rapid triage before a deeper (paid) analysis.
Anyone who wants the numbers Amazon already shows, read properly, before paying $50–200/month for a
modelled guess at the same question.

## Permission justifications (for review)

| Permission | Justification |
| :-- | :-- |
| `activeTab` | Lets the toolbar popup ask the currently active tab for the category read it already computed, without requesting a general tabs permission. |
| `storage` | Persists watchlist snapshots, filter preferences and local usage counters. |
| `downloads` | Writes the exported .csv/.md file and the JSON backup the user requests. Content scripts cannot call this API directly, so in-page exports are relayed to the background service worker, which is the only place it's invoked for that path. |
| Host access to Amazon marketplace domains (`amazon.com`, `amazon.co.uk`, `amazon.de` and other Amazon storefronts) | The extension's core function — reading search/category result pages — only happens on Amazon's own domains. No other site is accessed, and no data is transmitted off-device. |

**Remote code:** none. All code is bundled in the package; no eval, no remote scripts.
**Data usage disclosures:** no data is collected or transmitted off-device; nothing sold or shared.

## Screenshots (1280×800)

1. Amazon search results with the summary strip above them and per-listing badges visible
2. Filters panel open, with opportunity-flagged listings highlighted
3. The watchlist in the toolbar popup, showing a delta since an earlier snapshot
4. The export panel, with a downloaded Markdown file open beside it
5. "Data" sheet — export / import / clear, with the local-only message

## Support and privacy links

- Privacy policy: publish [PRIVACY.md](PRIVACY.md) at a stable URL
- Support: repository issues page
