# Privacy Policy — Etsy Listing Analyzer

**Last updated:** 2026-09-02

## The short version

This extension makes no network requests. Nothing it reads from an Etsy listing, and nothing you
save or export, is ever sent anywhere, because there is nowhere for it to be sent — there is no
server, no account, no Etsy API key and no analytics service behind this product.

## What is stored, and where

Everything is stored in your browser's own local storage (`chrome.storage.local`) on this device:

| Data | Why |
| :-- | :-- |
| The compare tray — up to 6 listing teardowns (title, tags, photos, price, options, sales, shop stats) | So the comparison table survives you navigating away and back |
| Saved teardowns, each with a note and a history of snapshots | So a revisit can show what changed — price, sales, tags |
| Anonymous usage counters (e.g. "export_csv: 4") | So the developer can see which features are used |

The usage counters contain no listing IDs, no titles, no shop names and no identifiers — only
totals and the dates the extension was used. They stay on your device like everything else.

## What is never collected

No account, email address or name. No browsing history beyond the current Etsy listing page. No
data from any site other than etsy.com — the extension has no access to any other site at all. No
advertising or tracking identifiers. Nothing is sold, shared or transmitted, because nothing is
transmitted at all.

## Permissions, and what each is for

| Permission | Why it is needed |
| :-- | :-- |
| `*://*.etsy.com/*` (host access, Etsy only) | Reading the listing page you have open, to build the teardown. No other site is touched. |
| `activeTab` | Letting the toolbar icon open the panel on the page you're looking at. |
| `storage` | Saving the compare tray, saved teardowns and usage counters locally. |
| `downloads` | Saving the file when you export CSV or Markdown. |

There is no `<all_urls>` permission and no permission to read any site other than Etsy.

## Your data is yours

**Saved → Export all data** writes the compare tray and every saved teardown to a single JSON
file. **Import** reads it back, on this machine or another one. **Clear all data** deletes
everything immediately and permanently.

Because storage is local and per-device, uninstalling the extension or clearing your browser data
removes your saved teardowns and tray. Export a backup first if you want to keep them.

## Verifying this yourself

Open devtools on any Etsy listing with the extension active and watch the Network tab — you will
see no requests from the extension. The source is auditable: no `fetch`, `XMLHttpRequest`,
`WebSocket` or `sendBeacon` call exists anywhere in it.

## Contact

Questions about this policy: raise an issue on the extension's support page.
