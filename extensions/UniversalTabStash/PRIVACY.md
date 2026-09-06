# Privacy Policy — Universal Tab Stash & Reading-List Export

**Last updated:** 2026-09-02

## The short version

This extension makes no network requests. Nothing about your tabs — titles, URLs, favicons, or the
stashes you create — is ever sent anywhere, because there is nowhere for it to be sent: there is no
server, no account and no analytics service behind this product.

## What is stored, and where

Everything is stored in your browser's own local storage (`chrome.storage.local`) on this device:

| Data | Why |
| :-- | :-- |
| The title, URL and favicon reference of each tab you stash | So the stash can be shown and restored |
| The name and notes you give a stash | It's your label |
| Anonymous usage counters (e.g. "stashes created: 12") | So the developer can see which features are used |

The usage counters contain no URLs, no tab titles and no identifiers — only totals and the dates the
extension was used. They stay on your device like everything else, and you can read them in the panel
under **Usage** and reset them there at any time.

## What is never collected

No account, email address or name. No browsing history beyond the tabs you explicitly stash. No page
content — this extension never reads what's *on* a page, only its title, URL and favicon, exactly as
the browser's own tab list already shows them. No advertising or tracking identifiers. Nothing is
sold, shared or transmitted, because nothing is transmitted at all.

## Permissions, and what each is for

| Permission | Why it is needed |
| :-- | :-- |
| `tabs` | Reading the current window's open tabs when you choose to stash them, and opening/closing tabs when you restore a stash or close tabs after stashing. Tabs are only read when you explicitly trigger a stash action — never in the background, never on a timer. |
| `storage` | Saving your stashes and notes locally |
| `downloads` | Saving the file when you export a Markdown reading list, CSV, or JSON backup |
| `sidePanel` | The stash list, search and export controls are a side panel |

Notably absent: `activeTab`, `scripting`, and any host permission (`<all_urls>` or otherwise). This
extension never injects a script into any page and never reads a page's content — it only calls the
browser's own tab-management API, which needs none of those.

## Your data is yours

**Data → Export all data** writes every stash to a single JSON file. **Import** reads it back, on this
machine or another one — importing the same file twice does not create duplicates. **Clear all data**
deletes every stash immediately and permanently.

Because storage is local and per-device, uninstalling the extension or clearing your browser data
removes your stashes. Export a backup first if you want to keep them, and if you use more than one
device or browser, export/import is how a stash moves between them — there is no server doing that
for you.

## Verifying this yourself

Open devtools on the side panel with the extension active and watch the Network tab — you will see no
requests from the extension. The source is auditable: no `fetch`, `XMLHttpRequest`, `WebSocket` or
`sendBeacon` call exists anywhere in it.

## Contact

Questions about this policy: raise an issue on the extension's support page.
