# Privacy Policy — X Media Archiver

**Last updated:** 2026-09-06

## The short version

This extension makes no network requests of its own. The only network activity it ever causes is the
download itself — fetching the exact image or video file the X page you're already looking at has
already rendered, straight to your Downloads folder. There is no server, no account and no analytics
service behind this product.

## What actually happens when you click Save

The extension reads the media URL X's own page already loaded to display the post, and hands that URL
to Chrome's own download manager (`chrome.downloads.download`). Nothing is fetched by this extension's
own code, re-encoded, or re-hosted anywhere — the file that lands in your Downloads folder is the same
file X's servers already sent your browser to render the post.

## The ownership restriction, and why it's enforced in code

This extension only ever offers to save media from posts the logged-in X account itself authored:

1. It reads the logged-in account's own handle from X's own left-nav profile block.
2. It reads the specific post's author handle — for a repost, that means the *original* author, never
   the account that reposted it into your timeline; for a quote-tweet, the quoted post's media is
   checked against the quoted post's own author, not yours.
3. The Save button only ever renders on a case-insensitive match. No match — or no handle that could
   be confidently read at all — means no button. There is no setting that changes this.

This is not just a policy statement: there is no code path anywhere in this extension that offers a
Save button on a post it could not confirm you authored.

## What is stored, and where

Everything lives in your browser's own local storage (`chrome.storage.local`) on this device:

| Data | Why |
| :-- | :-- |
| A record of each save: post URL, date, media type, and the saved filename | So you have a log of what you've archived, without re-opening every post |

The media file itself is never stored by the extension in any form beyond the copy Chrome's download
manager already saved to your Downloads folder.

## What is never collected

No account, email address or name. No browsing history. No post text, no images, no video content. No
advertising or tracking identifiers. Nothing is sold, shared or transmitted, because nothing is
transmitted at all beyond the download itself.

## Permissions, and what each is for

| Permission | Why it is needed |
| :-- | :-- |
| Host access to `x.com` and `twitter.com` | The Save control only ever appears on these two domains — no other site is accessed |
| `activeTab` | Identifying the tab the Save action targets |
| `storage` | Saving your local save log on this device only |
| `downloads` | Saving the media file when you click Save |

## Your data is yours

The popup's **Export CSV** / **Export JSON** buttons write your entire save log to a file you choose
where to keep. **Clear all** deletes the log immediately and permanently. Deleting the log never
touches any file you've already saved to your Downloads folder — those are already yours, on disk,
independent of this extension.

## Verifying this yourself

Open devtools on x.com with the extension active and watch the Network tab while clicking Save — the
only request you'll see is the download itself, to the same media address the page already loaded
from. The source is auditable: no `fetch`, `XMLHttpRequest`, `WebSocket` or `sendBeacon` call exists
anywhere in it (`npm test` enforces this with a grep-based check on every build).

## Contact

Questions about this policy: raise an issue on the extension's support page.
