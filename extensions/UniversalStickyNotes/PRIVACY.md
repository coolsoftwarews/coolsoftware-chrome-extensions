# Privacy Policy — Universal Sticky Notes

**Last updated:** 2026-09-02

## The short version

This extension makes no network requests. Nothing you write in a note, or the pages you write it on,
is ever sent anywhere, because there is nowhere for it to be sent — there is no server, no account and
no analytics service behind this product.

## What is stored, and where

Everything is stored in your browser's own local storage (`chrome.storage.local`) on this device:

| Data | Why |
| :-- | :-- |
| The text of each note you create | It's your note |
| Each note's color, size, and position (stored as a percentage of the page, not a screenshot) | To put the note back in roughly the same spot next visit |
| Page title, URL, and the date you first left a note there | Shown in the panel and written into the Markdown export |
| Anonymous usage counters (e.g. "notes created: 12") | So the developer can see which features are used |

The usage counters contain no URLs, no page titles, no note text and no identifiers — only totals and
the dates the extension was used. They stay on your device like everything else, and you can read them
in the panel under **Usage** and reset them there at any time.

## What is never collected

No account, email address or name. No browsing history. No page contents beyond the notes you
explicitly create. No advertising or tracking identifiers. Nothing is sold, shared or transmitted,
because nothing is transmitted at all.

## Permissions, and what each is for

| Permission | Why it is needed |
| :-- | :-- |
| `<all_urls>` (access to sites you visit) | A sticky-note tool that only works on an approved list of sites isn't a sticky-note tool. This is what lets notes be restored on whatever you're looking at, and lets the panel read a tab's title/URL to show and search your notes. It grants no network capability. |
| `storage` | Saving your notes locally |
| `downloads` | Saving the file when you export your notes as Markdown or as a JSON backup |
| `sidePanel` | The notes list, search and data controls are a side panel |
| `activeTab`, `scripting` | Injecting the note overlay into the page you're looking at |

## Your data is yours

**Data → Export all data** (in the panel) writes every note across every page to a single JSON file.
**Import** reads it back, on this machine or another one, merging by note id so importing the same file
twice never creates duplicates. **Clear all data** deletes everything immediately and permanently.
**Export .md** writes every note, grouped by page, as a plain Markdown file.

Because storage is local and per-device, uninstalling the extension or clearing your browser data
removes your notes. Export a backup first if you want to keep them.

## Verifying this yourself

Open devtools on any page with the extension active and watch the Network tab — you will see no
requests from the extension. The source is auditable: no `fetch`, `XMLHttpRequest`, `WebSocket` or
`sendBeacon` call exists anywhere in it.

## Contact

Questions about this policy: raise an issue on the extension's support page.
