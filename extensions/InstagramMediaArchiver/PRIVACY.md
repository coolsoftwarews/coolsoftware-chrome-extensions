# Privacy Policy — Instagram Media Archiver

**Last updated:** 2026-09-06

Instagram Media Archiver does not collect, transmit, sell or share any user data. There is no server,
no account and no analytics service behind this product, and no network requests beyond the download
itself.

## What the extension does

The Save button downloads a photo or video from a post you are already viewing — using the same
media URL the page already loaded to display it — straight to your device's Downloads folder via
Chrome's own download API. No re-encoding, no re-hosting, no intermediate server.

## The ownership restriction, and why it matters for your privacy too

Save only ever appears on a post the extension confirms the logged-in Instagram account authored,
checked by reading the account's own handle from Instagram's nav and the post's author handle from
the post's own header. This means the extension never has a reason to read or act on anyone else's
content — it is architecturally incapable of scraping another account's posts, not just policy-bound
not to.

## What is stored, and where

Everything lives in your browser's own local storage (`chrome.storage.local`) on this device:

| Data | Why |
| :-- | :-- |
| Post URL, handle, media type, saved filename, and the date you saved it | The local archive log — a record of what you've already saved, so you don't have to re-open every post |

The log never stores the media itself, your Instagram password, or your session token — the extension
reads only what is already rendered on the page for your existing, signed-in session.

## What is never collected

No account, email address or name. No Instagram login credentials. No browsing history beyond the
posts you explicitly save. No advertising or tracking identifiers. No analytics, no telemetry
endpoint. Nothing is sold, shared or transmitted, because nothing is transmitted at all.

## Permissions, and what each is for

| Permission | Why it is needed |
| :-- | :-- |
| Host access to `*.instagram.com` | The Save button and the ownership check it depends on only exist on Instagram; the extension has no reason to run — and does not run — anywhere else |
| `activeTab` | Identifying the active Instagram tab so a save applies to the post you're looking at |
| `downloads` | Writing the saved media file, and the exported .csv/.json log, to your device |
| `storage` | Keeping the local archive log described above |

## Your data is yours

The toolbar popup's **Export CSV** / **Export JSON** writes the local log to a file on your device.
**Clear all** deletes the log immediately and permanently. Neither action touches files already saved
to your Downloads folder — those are yours regardless of what happens to the log.

Because storage is local and per-device, uninstalling the extension or clearing your browser data
removes the log (not the media files you've already downloaded). Export a copy first if you want to
keep the record.

## Verifying this yourself

Open devtools on Instagram with the extension active and watch the Network tab — you will see no
requests from the extension beyond the download itself. The source is auditable: no `fetch`,
`XMLHttpRequest`, `WebSocket` or `sendBeacon` call exists anywhere in it, a posture enforced on every
test run by `scripts/selftest.mjs`.

## Contact

Questions about this policy: gabler777@gmail.com
