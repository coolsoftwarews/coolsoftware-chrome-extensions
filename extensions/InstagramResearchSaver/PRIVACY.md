# Privacy Policy — Instagram Creator Research Saver

**Last updated:** 2026-09-02

## The short version

This extension makes no network requests. Nothing you save, note, search or export is ever sent
anywhere, because there is nowhere for it to be sent — there is no server, no account and no
analytics service behind this product.

## What is stored, and where

Everything is stored in your browser's own local storage (`chrome.storage.local`) on this device:

| Data | Why |
| :-- | :-- |
| The post/Reel URL, creator handle, caption, post date and view/like/comment counts | The capture card — this is the product |
| A thumbnail, re-encoded to a small local image, or the original CDN URL when re-encoding wasn't possible | Shown in the panel and written into exports |
| The collection you filed a post under, and any note you attach | It's your organization and your note |
| Anonymous usage counters (e.g. "export_csv: 4") | So the developer can see which features are used |

The usage counters contain no post URLs, no captions, no handles and no identifiers — only totals and
the dates the extension was used. They stay on your device like everything else, and you can read
them in the panel under **Usage** and reset them there at any time.

## What is never collected

No account, email address or name. No Instagram login credentials — this extension reads only what is
already rendered on the page for your existing, signed-in session; it never touches your password or
session token. No browsing history beyond the posts you explicitly save. No advertising or tracking
identifiers. Nothing is sold, shared or transmitted, because nothing is transmitted at all.

## Permissions, and what each is for

| Permission | Why it is needed |
| :-- | :-- |
| Host access to `*.instagram.com` | The save button and everything it reads only exist on Instagram; the extension has no reason to run — and does not run — anywhere else |
| `activeTab` | Identifying the active Instagram tab so a save applies to what you're looking at |
| `storage` | Saving your library — posts, collections and notes — locally |
| `downloads` | Writing the exported .csv/.md/.json file when you ask for one |
| `sidePanel` | The library is a side panel, opened from the toolbar icon |

## Your data is yours

**Data → Export CSV / Markdown / JSON** writes your library to a file on your device. The JSON export
is a full backup and can be **imported** back, on this machine or another one, without creating
duplicates. **Clear all data** deletes every saved post immediately and permanently (the four starter
collections come back empty).

Because storage is local and per-device, uninstalling the extension or clearing your browser data
removes your library. Export a backup first if you want to keep it. PRD-level design goal: you are
warned once local storage crosses 80% full, with an export always one click away.

## Verifying this yourself

Open devtools on Instagram with the extension active and watch the Network tab — you will see no
requests from the extension. The source is auditable: no `fetch`, `XMLHttpRequest`, `WebSocket` or
`sendBeacon` call exists anywhere in it.

## Contact

Questions about this policy: raise an issue on the extension's support page.
