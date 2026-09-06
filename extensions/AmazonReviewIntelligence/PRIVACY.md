# Privacy Policy — Amazon Review Intelligence

**Last updated:** 2026-09-02

## The short version

This extension makes no network requests. Nothing you read, cluster, note or export is ever sent
anywhere, because there is nowhere for it to be sent — there is no server, no account, no LLM API and no
analytics service behind this product.

## What is stored, and where

Everything is stored in your browser's own local storage (`chrome.storage.local`) on this device, keyed
by product (ASIN):

| Data | Why |
| :-- | :-- |
| The reviews read from a product's page (text, rating, date, verified-purchase status, size/colour variation) | To cluster them into themes and show the evidence behind each one |
| Your note on a product, and your filter preferences | It's your note; filters persist so you don't re-set them every visit |
| A daily snapshot of theme counts per product | So re-running the analysis later can show "up from 18 to 31" |
| Anonymous usage counters (e.g. "export_csv: 4") | So the developer can see which features are used |

The usage counters contain no URLs, no product titles, no review text and no identifiers — only totals,
the ASINs analysed, and the dates the extension was used. They stay on your device like everything else,
and you can read them in the panel under **Usage** and reset them there at any time.

## What is never collected

No account, email address or name. No browsing history beyond the Amazon product pages you open with
this extension active. No advertising or tracking identifiers. Reviews are never sent to any server or
AI service for analysis — the clustering that produces the themes runs entirely in your browser, by
counting words, not by calling a model. Nothing is sold, shared or transmitted, because nothing is
transmitted at all.

## Permissions, and what each is for

| Permission | Why it is needed |
| :-- | :-- |
| Host access to Amazon's storefronts (`amazon.com`, `.co.uk`, `.de` and other major locales) | This is what lets the extension read the reviews already rendered on a product page you opened. It grants no network capability of its own — no code here ever calls `fetch`. |
| `activeTab` | Identifying which tab's reviews the panel should show when you open it. |
| `storage` | Saving reviews, notes, filters and usage counters locally. |
| `downloads` | Saving the file when you export a CSV or Markdown teardown. |

## Your data is yours

**Data → Export all data** writes every product's reviews and notes to a single JSON file. **Import**
reads it back, on this machine or another one. **Clear this product** or **Clear all data** deletes
immediately and permanently.

Because storage is local and per-device, uninstalling the extension or clearing your browser data removes
this data. Export a backup first if you want to keep it.

## No auto-pagination, no crawling

The extension only reads reviews that are already rendered on the page you opened — it never clicks
"next page" on your behalf and never fetches a review page you didn't navigate to yourself. That is a
deliberate limit, not a bug: automatically paginating through a listing's reviews would put your Amazon
session at risk and cross the line from reading into crawling.

## Verifying this yourself

Open devtools on any Amazon page with the extension active and watch the Network tab — you will see no
requests from the extension. The source is auditable: no `fetch`, `XMLHttpRequest`, `WebSocket` or
`sendBeacon` call exists anywhere in it.

## Contact

Questions about this policy: raise an issue on the extension's support page.
