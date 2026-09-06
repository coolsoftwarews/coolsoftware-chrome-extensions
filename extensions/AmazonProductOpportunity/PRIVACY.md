# Privacy Policy — Amazon Product Opportunity Overlay

**Last updated:** 2026-09-02

## The short version

This extension makes no network requests. Everything it shows is read from the Amazon page already
open in your tab; nothing you search, watch or export is ever sent anywhere, because there is nowhere
for it to be sent — there is no server, no account and no analytics service behind this product.

## What is stored, and where

Everything is stored in your browser's own local storage (`chrome.storage.local`) on this device:

| Data | Why |
| :-- | :-- |
| Snapshots you explicitly save with "+ Watch this search" or "☆ Watch" on a listing | So the delta ("+140 reviews since 12 Aug") can be shown when you come back |
| Your filter preferences (max reviews, rating gap, price band, brand) | Restored the next time you open a search results page |
| Anonymous usage counters (e.g. "export_results_csv: 4") | So the developer can see which features are used |

The usage counters contain no search terms, no ASINs, no prices and no identifiers — only totals and
the dates the extension was used. They stay on your device and you can read or reset them from the
toolbar popup under **Usage**.

**Nothing is read or stored unless you act.** The summary strip and per-listing badges are computed
from the page you're already viewing and are not persisted anywhere — only an explicit "+ Watch"
click writes a snapshot to storage.

## What is never collected

No account, email address or name. No browsing history. No page contents beyond what you explicitly
watch. No advertising or tracking identifiers. No sales, revenue or "best seller rank" estimates —
this product deliberately never computes or stores anything of that kind (see the product's README
for why). Nothing is sold, shared or transmitted, because nothing is transmitted at all.

## Permissions, and what each is for

| Permission | Why it is needed |
| :-- | :-- |
| `activeTab` | Lets the toolbar popup ask the current tab for its already-computed category read, without a broader tabs permission. |
| `storage` | Saving watchlist snapshots, filter preferences and usage counters locally. |
| `downloads` | Saving the file when you export a CSV/Markdown result set, watchlist, or JSON backup. |
| Host access to Amazon's storefronts (`amazon.com`, `amazon.co.uk`, `amazon.de` and other Amazon marketplace domains) | The extension's entire function is reading Amazon search/category result pages. No other site is accessed. |

## Your data is yours

**Popup → Data → Export all data** writes every watched search and product to a single JSON file.
**Import** reads it back, on this machine or another one. **Clear all data** deletes every watch
immediately and permanently.

Because storage is local and per-device, uninstalling the extension or clearing your browser data
removes your watchlist. Export a backup first if you want to keep it.

## Verifying this yourself

Open devtools on an Amazon search page with the extension active and watch the Network tab — you will
see no requests from the extension. The source is auditable: no `fetch`, `XMLHttpRequest`,
`WebSocket` or `sendBeacon` call exists anywhere in it, and `scripts/selftest.mjs` fails the build if
one is ever added.

## Contact

Questions about this policy: raise an issue on the extension's support page.
