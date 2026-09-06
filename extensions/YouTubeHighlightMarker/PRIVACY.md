# Privacy Policy — Highlight Marker & Clip-Index Exporter for YouTube

**Last updated:** 2026-09-02

## The short version

This extension makes no network requests. Nothing you mark, note or export is ever sent anywhere,
because there is nowhere for it to be sent — there is no server, no account and no analytics
service behind this product.

## What is stored, and where

Everything is stored in your browser's own local storage (`chrome.storage.local`) on this device:

| Data | Why |
| :-- | :-- |
| The in-point and out-point timestamps you mark on a video | The core of the product — a shot list |
| A thumbnail frame grabbed from the video at each timestamp, when the browser allows it | So the exported list is a visual reference, not just numbers |
| The note you type on a mark | It's your reasoning for why the moment matters |
| Which video each set of marks belongs to (the YouTube video id) | So marks are shown against the right video when you come back to it |
| Anonymous usage counters (e.g. "export_md: 12") | So the developer can see which features are used |

The usage counters contain no video ids, no notes and no thumbnails — only totals and the dates the
extension was used. They stay on your device like everything else, and you can read them in the
panel's Data sheet and reset them there at any time.

## What is never collected

No account, email address or name for you, the user of this extension. No browsing history beyond
the one video open when a mark is made. No video or audio content itself — only a small still-frame
thumbnail at the moments you explicitly mark. No advertising or tracking identifiers. Nothing is
sold, shared or transmitted, because nothing is transmitted at all.

## About the thumbnails

A thumbnail is a single still frame captured from the video you are already watching, drawn onto a
canvas and read back as an image — the same frame that was already decoded and on your screen.
Nothing is fetched from YouTube's servers to make it, and nothing is uploaded anywhere afterward.
On some videos the browser refuses this read (a security restriction on certain video sources), in
which case the mark is saved with its timestamp and no thumbnail. Either way, the frame never leaves
your device.

## Permissions, and what each is for

| Permission | Why it is needed |
| :-- | :-- |
| `activeTab` | Lets the toolbar icon and the two keyboard shortcuts (mark in / mark out) act on the tab you're currently watching, without a standing grant over every tab. |
| Host access to `*://*.youtube.com/*` | The extension's core function — reading the video's current playback time and drawing its current frame — only works on YouTube. This is also what lets the mark buttons load automatically under the player. |
| `storage` | Saving your marks, notes, thumbnails and export preferences locally. |
| `downloads` | Saving the file when you export Markdown, CSV or a full JSON backup. |
| `sidePanel` | The clip list, notes and export controls are a side panel, not a popup that closes when you click away. |

This extension does **not** request `scripting` or a general `tabs` grant. The content script is
injected declaratively wherever the host permission matches.

## Your data is yours

**Data → Export all (JSON)** writes every mark, for every video, to a single file. **Import** reads
it back, on this machine or another one, merging by mark id so importing the same file twice never
duplicates a mark. **Clear all** deletes every mark, for every video, immediately and permanently.

Because storage is local and per-device, uninstalling the extension or clearing your browser data
removes your saved marks. Export a backup first if you want to keep them.

## Verifying this yourself

Open devtools on YouTube with the extension active and watch the Network tab — you will see no
requests from the extension. The source is auditable: no `fetch`, `XMLHttpRequest`, `WebSocket` or
`sendBeacon` call exists anywhere in it.

## A note on the ClipWizard link

After you export a highlight list for the first time, the panel shows a one-line note pointing to
ClipWizard, a separate product by the same developer that actually cuts video clips. Clicking it
opens a new tab to that product's own site; nothing about your marks, notes or thumbnails is passed
to it, and the note involves no tracking beyond the same local, no-network usage counters described
above.

## Contact

Questions about this policy: raise an issue on the extension's support page.
