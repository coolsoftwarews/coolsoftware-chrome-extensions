# Privacy Policy — Meta Ad Winner

**Last updated:** 2026-09-02

## The short version

This extension makes no network requests. Nothing it reads from the Ad Library, nothing you save
to your swipe file, and nothing about how you use it is ever sent anywhere, because there is
nowhere for it to be sent — there is no server, no account and no analytics service behind this
product.

## What is stored, and where

Everything is stored in your browser's own local storage (`chrome.storage.local`) on this device:

| Data | Why |
| :-- | :-- |
| Ads you explicitly save — advertiser, ad text, landing domain, dates, format, thumbnail, a link back to the Library, and any note you write | It's your swipe file |
| Collection names you create | Organizing your saved ads |
| Anonymous usage counters (e.g. "exports: 4") | So the developer can see which features are used |

The usage counters contain no advertiser names, no ad text, no URLs and no identifiers — only
totals and the dates the extension was used. You can read them in the popup under **Usage** and
reset them there at any time.

## What is never collected

No account, email address or name. No browsing history. No data about ads you looked at but did
not explicitly save. No advertising or tracking identifiers. Nothing is sold, shared or
transmitted, because nothing is transmitted at all.

## Permissions, and what each is for

| Permission | Why it is needed |
| :-- | :-- |
| `activeTab` | Lets the popup identify the Ad Library tab you're viewing so it can send it a message; only granted for the tab you actively interact with. |
| `storage` | Saving your swipe file, collections and export preferences locally. |
| `downloads` | Saving the CSV/Markdown/JSON file when you export results or your swipe file. |
| Host access to `*://*.facebook.com/*` | The extension's badges, filters and "+ Save ad" button only run on `facebook.com/ads/library`. The Library is public and requires no sign-in to browse (PRD §5). No other Facebook page is touched, and no data is transmitted off-device. |

## Your data is yours

**Data → Export all data** writes every saved ad and collection to a single JSON file. **Import**
reads it back, on this machine or another one. **Clear all data** deletes everything immediately
and permanently.

Because storage is local and per-device, uninstalling the extension or clearing your browser data
removes your swipe file. Export a backup first if you want to keep it.

## Verifying this yourself

Open devtools on the Ad Library with the extension active and watch the Network tab — you will see
no requests from the extension. The source is auditable: no `fetch`, `XMLHttpRequest`, `WebSocket`
or `sendBeacon` call exists anywhere in it.

## Contact

Questions about this policy: raise an issue on the extension's support page.
