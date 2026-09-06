# Privacy Policy — Universal Citation & Link Copier

**Last updated:** 2026-09-02

## The short version

This extension makes no network requests. The page you're citing is read from the tab you already
have open, formatted on your device, and copied to your clipboard. Nothing is ever sent anywhere,
because there is nowhere for it to be sent — there is no server, no account and no analytics service
behind this product.

## What is stored, and where

Exactly one thing, in your browser's own local storage (`chrome.storage.local`) on this device:

| Data | Why |
| :-- | :-- |
| The format you last copied (Markdown link / URL / APA / MLA / Chicago) | So the keyboard shortcut copies in that same format next time, without opening the popup |

Nothing else persists. Page titles, authors, dates and URLs are read at the moment you ask for a
citation, formatted, copied, and then discarded — none of it is saved anywhere by this extension.

## What is never collected

No account, email address or name. No browsing history. No record of which pages you've cited. No
advertising or tracking identifiers. Nothing is sold, shared or transmitted, because nothing is
transmitted at all.

## Permissions, and what each is for

| Permission | Why it is needed |
| :-- | :-- |
| `<all_urls>` (access to sites you visit) | A citation tool that only works on an approved list of sites isn't a citation tool. This is what lets the current page's metadata be read, whatever you're reading. It grants no network capability. |
| `activeTab` / `scripting` | Reading the page's `<meta>` tags and title at the moment you ask for a citation. |
| `storage` | Remembering which format you last used, locally. |
| `offscreen` | Gives the background script a document so it can write to your clipboard when you use the keyboard shortcut (a service worker has no document of its own). It performs no other function and makes no network requests. |

There is no `downloads` permission — nothing is ever saved to a file, only copied to the clipboard.

## Verifying this yourself

Open devtools on any page with the extension active and watch the Network tab — you will see no
requests from the extension, on install, on copy, or ever. The source is auditable: no `fetch`,
`XMLHttpRequest`, `WebSocket` or `sendBeacon` call exists anywhere in it.

## Contact

Questions about this policy: raise an issue on the extension's support page.
