# Privacy Policy — Universal Table/List → CSV Scraper

**Last updated:** 2026-09-02

## The short version

This extension makes no network requests. Nothing you click, preview or export is ever sent anywhere,
because there is nowhere for it to be sent — there is no server, no account and no analytics service
behind this product. Parsing a table into a CSV happens entirely inside your browser, in the tab
you're already looking at.

## What is stored, and where

Everything is stored in your browser's own local storage (`chrome.storage.local`) on this device, and
none of it is the content you scrape:

| Data | Why |
| :-- | :-- |
| Anonymous usage counters (e.g. "export_csv: 7") | So the developer can see which features are used |
| Your default export-format preference, if you set one | Convenience only |

The usage counters contain no URLs, no page titles, no table contents and no identifiers — only
totals and the dates the extension was used. They stay on your device like everything else, and you
can read them from the popup under **Usage** and reset them there at any time.

**This extension does not keep a history of what you've scraped.** Every export is a one-shot action:
you pick something, preview it, export the file, and nothing about its contents is retained afterward.

## What is never collected

No account, email address or name. No browsing history. No content from any table or list you didn't
explicitly select and export. No advertising or tracking identifiers. Nothing is sold, shared or
transmitted, because nothing is transmitted at all.

## Permissions, and what each is for

| Permission | Why it is needed |
| :-- | :-- |
| `<all_urls>` (access to sites you visit) | A table exporter that only works on an approved list of sites isn't one. This is what lets the extension read a table or list on whatever page you're looking at. It grants no network capability. |
| `storage` | Saving your usage counters and export-format preference locally |
| `downloads` | Saving the CSV or JSON file when you export |
| `activeTab`, `scripting` | Identifying the page you're on and injecting the picking/preview UI into it |

## Verifying this yourself

Open devtools on any page with the extension active and watch the Network tab — you will see no
requests from the extension, before, during, or after an export. The source is auditable: no `fetch`,
`XMLHttpRequest`, `WebSocket` or `sendBeacon` call exists anywhere in it.

## Contact

Questions about this policy: raise an issue on the extension's support page.
