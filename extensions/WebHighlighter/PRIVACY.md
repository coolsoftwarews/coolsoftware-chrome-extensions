# Privacy Policy — Web Highlighter & Markdown Export

**Last updated:** 2026-08-15

## The short version

This extension makes no network requests. Nothing you highlight, note, read or export is ever sent
anywhere, because there is nowhere for it to be sent — there is no server, no account and no
analytics service behind this product.

## What is stored, and where

Everything is stored in your browser's own local storage (`chrome.storage.local`) on this device:

| Data | Why |
| :-- | :-- |
| The text you highlighted, plus ~32 characters either side of it | To put the highlight back on the page next visit |
| The colour of each highlight, and any note you attach | It's your note |
| Page title, URL, author, site and capture date | Shown in the panel and written into exports |
| Anonymous usage counters (e.g. "exports: 12") | So the developer can see which features are used |

The usage counters contain no URLs, no page titles, no highlighted text and no identifiers — only
totals and the dates the extension was used. They stay on your device like everything else, and you
can read them in the panel under **Usage** and reset them there at any time.

## What is never collected

No account, email address or name. No browsing history. No page contents beyond the highlights you
explicitly create. No advertising or tracking identifiers. Nothing is sold, shared or transmitted,
because nothing is transmitted at all.

## Permissions, and what each is for

| Permission | Why it is needed |
| :-- | :-- |
| `<all_urls>` (access to sites you visit) | A highlighter that only works on an approved list of sites isn't a highlighter. This is what lets marks be restored on whatever you're reading. It grants no network capability. |
| `storage` | Saving your highlights and notes locally |
| `downloads` | Saving the file when you export Markdown, HTML, PDF or TXT |
| `sidePanel`, `tabs`, `activeTab`, `scripting` | Opening the panel and knowing which page it should show |

## Your data is yours

**Data → Export all data** writes every highlight and note across every page to a single JSON file.
**Import** reads it back, on this machine or another one. **Clear all data** deletes everything
immediately and permanently.

Because storage is local and per-device, uninstalling the extension or clearing your browser data
removes your highlights. Export a backup first if you want to keep them.

## Verifying this yourself

Open devtools on any page with the extension active and watch the Network tab — you will see no
requests from the extension. The source is auditable: no `fetch`, `XMLHttpRequest`, `WebSocket` or
`sendBeacon` call exists anywhere in it.

## Contact

Questions about this policy: raise an issue on the extension's support page.
