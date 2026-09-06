# Privacy Policy — X Bookmark Organizer

**Last updated:** 2026-09-02

## The short version

This extension makes no network requests. Nothing you index, tag, note or export is ever sent
anywhere, because there is nowhere for it to be sent — there is no server, no account and no
analytics service behind this product.

## What is stored, and where

Everything is stored in your browser's own local storage (`chrome.storage.local`) on this device,
built only from what X has already rendered on your own Bookmarks page as you view it:

| Data | Why |
| :-- | :-- |
| A bookmarked post's author, handle, text, metrics, date and link | The indexed card itself |
| A reference to the first media item's URL, when the post has media | Shown as a thumbnail in the panel; the image or video file itself is never downloaded |
| The tags and note you add to a bookmark | It's your organizing |
| Which folder a bookmark is filed under, and any folder you create or rename | Organizing your library |
| A timestamp marking your most recent completed visit to the Bookmarks page | Used only to show a "not seen on your last visit" flag — see below |
| Anonymous usage counters (e.g. "bookmark_indexed: 40") | So the developer can see which features are used |

The usage counters contain no post text, no handles, no URLs and no identifiers — only totals and
the dates the extension was used. They stay on your device like everything else, and you can read
them in the panel under **Usage** and reset them there at any time.

## What is never collected

No account, email address or name. No browsing history beyond your own Bookmarks page. No X API
access, no API keys. No advertising or tracking identifiers. Nothing is sold, shared or transmitted,
because nothing is transmitted at all.

## What this extension does not do

It never un-bookmarks, posts, replies, likes, reposts, follows or messages on your behalf — it only
reads what X has already rendered on the Bookmarks page you're looking at, and only while that tab is
open. **Deleting a bookmark from this extension's local library does not un-bookmark it on X** —
there is no code path anywhere in this extension capable of writing to X at all. It never crawls in
the background: there is no polling, no scheduled activity, and the bounded "Re-index" auto-scroll
only ever runs while you have the Bookmarks tab open and have explicitly clicked the button.

## Why indexing is limited to what you've scrolled

X exposes no public, no-auth way for a browser extension to fetch "all of a user's bookmarks" in one
request — that access requires the kind of account/session handoff this extension deliberately never
asks for. So the library only ever contains bookmarks X has actually rendered while you were viewing
the Bookmarks page, either as you scrolled yourself or during a bounded auto-scroll pass you
triggered. This is a real trade-off, stated plainly: you get zero account/trust cost, in exchange for
building your index gradually rather than all at once.

## Permissions, and what each is for

| Permission | Why it is needed |
| :-- | :-- |
| Host access to `x.com` and `twitter.com` | The side panel's search/organize surface works from any tab on these two domains; the indexing content script itself only ever runs on the Bookmarks page. No other site is accessed. |
| `activeTab` | Identifying the tab the panel and the Re-index command should act on. |
| `storage` | Saving your indexed bookmarks, folders, tags, notes and usage counters locally. |
| `downloads` | Saving the file when you export Markdown, CSV or JSON. |
| `sidePanel` | The library, search, filters and export controls are a side panel, shown beside X rather than covering it. |

## Your data is yours

**Data → Export as .json** writes your entire library — every bookmark, folder, tag and note — to a
single file. **Import** reads a previously exported file back in, merging it with what's already on
this device rather than replacing it (importing the same file twice never duplicates a card). **Clear
all data** deletes everything immediately and permanently.

Because storage is local and per-device, uninstalling the extension or clearing your browser data
removes your library. Export a backup first if you want to keep it.

## Verifying this yourself

Open devtools on x.com with the extension active and watch the Network tab — you will see no
requests from the extension. The source is auditable: no `fetch`, `XMLHttpRequest`, `WebSocket` or
`sendBeacon` call exists anywhere in it (`npm test` enforces this with a grep-based check on every
build).

## Contact

Questions about this policy: raise an issue on the extension's support page.
