# Privacy Policy — X Conversation Saver

**Last updated:** 2026-09-02

## The short version

This extension makes no network requests. Nothing you save, note or export is ever sent anywhere,
because there is nowhere for it to be sent — there is no server, no account and no analytics service
behind this product.

## What is stored, and where

Everything is stored in your browser's own local storage (`chrome.storage.local`) on this device,
only when you click "+ Save" or "+ Save thread" on a post you are looking at:

| Data | Why |
| :-- | :-- |
| The post's author, handle, text, metrics, date and link (and every post in a saved thread) | The capture card itself |
| A reference to the first media item's URL, when the post has media | Shown as a thumbnail in the panel; the image or video file itself is never downloaded |
| The note you write on a saved item, and the note you write on a person | It's your note |
| Which collection an item is filed under, and any collection you rename | Organizing your library |
| Anonymous usage counters (e.g. "thread_saved: 4") | So the developer can see which features are used |

The usage counters contain no post text, no handles, no URLs and no identifiers — only totals and
the dates the extension was used. They stay on your device like everything else, and you can read
them in the panel under **Usage** and reset them there at any time.

## What is never collected

No account, email address or name. No browsing history beyond the specific posts you explicitly
click "Save" on. No X API access, no API keys. No advertising or tracking identifiers. Nothing is
sold, shared or transmitted, because nothing is transmitted at all.

## What this extension does not do

It never posts, replies, likes, reposts, follows or messages on your behalf — it only reads what X
has already rendered on the page you're looking at, and only when you click Save (PRD §4/§6). It
never crawls in the background: there is no polling, no scheduled activity, no code that runs when
you don't have an X tab open and haven't clicked anything.

## Permissions, and what each is for

| Permission | Why it is needed |
| :-- | :-- |
| Host access to `x.com` and `twitter.com` | The extension's entire function happens on these two domains: reading a post you're viewing and adding the "+ Save" control. No other site is accessed. |
| `activeTab` | Identifying the tab the panel should act on. |
| `storage` | Saving your library, collections, notes and usage counters locally. |
| `downloads` | Saving the file when you export Markdown, CSV or JSON. |
| `sidePanel` | The library, people view and export controls are a side panel, shown beside X rather than covering it. |

## Your data is yours

**Data → Export as .json** writes your entire library — every item, collection and person note — to
a single file. **Import** reads a previously exported file back in, merging it with what's already
on this device rather than replacing it (importing the same file twice never duplicates a card).
**Clear all data** deletes everything immediately and permanently.

Because storage is local and per-device, uninstalling the extension or clearing your browser data
removes your library. Export a backup first if you want to keep it.

## Verifying this yourself

Open devtools on x.com with the extension active and watch the Network tab — you will see no
requests from the extension. The source is auditable: no `fetch`, `XMLHttpRequest`, `WebSocket` or
`sendBeacon` call exists anywhere in it.

## Contact

Questions about this policy: raise an issue on the extension's support page.
