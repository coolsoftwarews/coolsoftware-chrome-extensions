# Privacy Policy — LinkedIn Creator Watchlist

**Last updated:** 2026-09-02

## The short version

This extension makes no network requests. Nothing you watch, read, note or export is ever sent
anywhere, because there is nowhere for it to be sent — there is no server, no account, no LinkedIn
API integration and no analytics service behind this product. It only reads what LinkedIn has already
shown you in your own browser tab, and it never takes an action on your behalf.

## What is stored, and where

Everything is stored in your browser's own local storage (`chrome.storage.local`) on this device:

| Data | Why |
| :-- | :-- |
| The name, headline, profile photo URL and profile link of each person you choose to watch | To show your watchlist and let you find their posts |
| The posts you happen to see from a watched person — text preview, reaction/comment/repost counts, date, link | This is the point of the product: your own collected view of people you chose to follow closely |
| Any note you write on a person or a post | It's your note |
| Anonymous usage counters (e.g. "export_csv: 4") | So the developer can see which features are used |

The usage counters contain no names, no post text, no URLs and no identifiers — only totals and the
dates the extension was used. They stay on your device like everything else, and you can read them in
the panel under **Usage** and reset them there at any time.

## What is never collected

No account, email address or name of yours. No LinkedIn login credentials — this extension never
asks for or sees them; you use your own existing LinkedIn session in your browser as normal. No
browsing history beyond the posts of people you explicitly chose to watch. No advertising or
tracking identifiers. Nothing is sold, shared or transmitted, because nothing is transmitted at all.

## What this extension never does

It never posts, likes, comments, follows, connects with or messages anyone on LinkedIn. It has no
code path that takes any action on your behalf — see the source, or PRD §5, which makes this a
permanent product decision, not a version limit. It never scrapes a profile you haven't opened, and
it never collects posts from anyone who is not already on your watchlist.

## Permissions, and what each is for

| Permission | Why it is needed |
| :-- | :-- |
| Host access to `*://*.linkedin.com/*` | The extension's entire function happens on LinkedIn: reading posts and profiles already rendered in your tab. It grants no network capability of its own — no code here calls `fetch`. |
| `activeTab` | Lets the panel know which tab is active, without broad always-on access to every open tab. |
| `storage` | Saving your watchlist, collected posts and notes locally. |
| `downloads` | Saving the file when you export CSV, Markdown or a full JSON backup. |
| `sidePanel` | Showing the watchlist in Chrome's side panel. |

## Your data is yours

**Data → Export all data** writes every watched person and every collected post to a single JSON
file. **Import** reads it back, on this machine or another one. **Clear all data** deletes everything
immediately and permanently. You can also export just your collection as **CSV** (person, post,
reactions, comments, reposts, ratio, date, link, note) or as a readable **Markdown** digest.

Because storage is local and per-device, uninstalling the extension or clearing your browser data
removes your watchlist. Export a backup first if you want to keep it.

## Verifying this yourself

Open devtools on linkedin.com with the extension active and watch the Network tab — you will see no
requests originating from the extension. The source is auditable: no `fetch`, `XMLHttpRequest`,
`WebSocket` or `sendBeacon` call exists anywhere in it.

## Contact

Questions about this policy: raise an issue on the extension's support page.
