# Privacy Policy — Universal Reader Mode & Export

**Last updated:** 2026-09-02

## The short version

This extension makes no network requests. Nothing you read or export is ever sent anywhere, because
there is nowhere for it to be sent — there is no server, no account and no analytics service behind
this product.

## What is stored, and where

Everything is stored in your browser's own local storage (`chrome.storage.local`) on this device:

| Data | Why |
| :-- | :-- |
| Reading preferences (font, font size, theme, line width) | So the next article you open uses what you picked last time |
| Anonymous usage counters (e.g. "exports: 12") | So the developer can see which features are used |

That's the whole list. No page content, no article text, no URLs and no page titles are ever stored
— reader mode reads a page, shows it to you, and forgets it the moment you close the overlay or
navigate away. The usage counters contain no URLs, no page titles, no article text and no
identifiers — only totals and the dates the extension was used.

## What is never collected

No account, email address or name. No browsing history. No page contents beyond what's visible in
the reader overlay while it's open. No advertising or tracking identifiers. Nothing is sold, shared
or transmitted, because nothing is transmitted at all.

## Permissions, and what each is for

| Permission | Why it is needed |
| :-- | :-- |
| `<all_urls>` (access to sites you visit) | A reader mode that only works on an approved list of sites isn't a reader mode. This is what lets extraction run on whatever article you're reading. It grants no network capability. |
| `activeTab` | Identifying the page you're currently on when you click the toolbar icon |
| `scripting` | Injecting the reader overlay into the page — only when you click the icon or press the shortcut, never automatically |
| `storage` | Saving your reading preferences and usage counters locally |
| `downloads` | Saving the file when you export Markdown, PDF or TXT |

## Your data is yours

**Data → Export all data** writes your preferences and usage counters to a single JSON file.
**Import** reads it back. **Clear all data** deletes everything immediately and permanently.

Because storage is local and per-device, uninstalling the extension or clearing your browser data
removes your saved preferences. There is no cloud copy to fall back on, by design.

## Verifying this yourself

Open devtools on any page with the extension active and watch the Network tab while you use reader
mode and export a file — you will see no requests from the extension. The source is auditable: no
`fetch`, `XMLHttpRequest`, `WebSocket` or `sendBeacon` call exists anywhere in it, and
`scripts/selftest.mjs` fails the build if one is ever added.

## Contact

Questions about this policy: raise an issue on the extension's support page.
