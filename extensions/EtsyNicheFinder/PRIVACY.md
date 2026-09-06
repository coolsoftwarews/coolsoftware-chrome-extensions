# Privacy Policy — Etsy Niche Opportunity Finder

**Last updated:** 2026-09-02

## The short version

This extension makes no network requests. Nothing it reads off an Etsy page, nothing you save as a
niche snapshot, and nothing you export is ever sent anywhere, because there is nowhere for it to be
sent — there is no server, no account, no Etsy API key and no analytics service behind this product.

## What is stored, and where

Everything is stored in your browser's own local storage (`chrome.storage.local`) on this device:

| Data | Why |
| :-- | :-- |
| A "+ Save niche" snapshot — the summary numbers for a search or category query, and when you saved them | So returning to the same query later can show what changed |
| A short-lived cache of listings for the query you're currently paginating through | So page 2 of a search adds to page 1's sample instead of replacing it. Expires automatically after a few hours and is capped in size. |
| Your filter settings (max sales, price band, shop, organic-only) | Restored the next time you open a results page |
| Anonymous usage counters (e.g. "export_csv: 4") and a one-way hash of which queries you've analysed | So the developer can see which features are used, without storing what anyone searched for |

The usage counters and query hashes cannot be reversed back into search terms. They stay on your
device like everything else, and you can read them in the popup under **Usage** and reset them there
at any time.

## What is never collected

No account, email address or name. No Etsy login, session or purchase data. No browsing history
beyond the current tab's DOM read. No advertising or tracking identifiers. Nothing is sold, shared or
transmitted, because nothing is transmitted at all.

## Permissions, and what each is for

| Permission | Why it is needed |
| :-- | :-- |
| Host access to `*://*.etsy.com/*` | The extension's entire function is reading listing cards on Etsy's own search and category pages. No other site is accessed, and nothing is fetched from Etsy beyond what your browser already loaded to show you the page. |
| `activeTab` | Lets the popup identify and message the Etsy tab you have open when you click the toolbar icon. |
| `storage` | Saving snapshots, filters and usage counters locally, as described above. |
| `downloads` | Saving the CSV or Markdown file when you export. |

## Your data is yours

The popup's **Data** panel gives you **Export all data** (every saved niche, as one JSON file),
**Import** (read a backup back in, merging rather than overwriting), and **Clear all data** (deletes
everything immediately and permanently).

Because storage is local and per-device, uninstalling the extension or clearing your browser data
removes your saved niches. Export a backup first if you want to keep them.

## Read-only, always

This extension never clicks, favourites, purchases, follows, or otherwise acts on Etsy on your
behalf. It only reads what is already rendered in the page.

## Verifying this yourself

Open devtools on any Etsy page with the extension active and watch the Network tab — you will see no
requests from the extension. The source is auditable: no `fetch`, `XMLHttpRequest`, `WebSocket` or
`sendBeacon` call exists anywhere in it.

## Contact

Questions about this policy: raise an issue on the extension's support page.
