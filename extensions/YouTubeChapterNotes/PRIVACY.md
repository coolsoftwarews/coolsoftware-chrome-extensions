# Privacy Policy — YouTube Chapter Notes & Timestamp Exporter

**Last updated:** 2026-09-02

## The short version

This extension makes no network requests. Nothing you type, watch or export is ever sent anywhere,
because there is nowhere for it to be sent — there is no server, no account and no analytics service
behind this product.

## What is stored, and where

Everything is stored in your browser's own local storage (`chrome.storage.local`) on this device:

| Data | Why |
| :-- | :-- |
| The note text you type | It's your note |
| The video's timestamp when you clicked "+ Note" (or pressed the shortcut) | So the note can be shown at the right point and jumped back to |
| The video's title and id | Written into the panel header and every export, and used to group notes per video |
| Whether the note was taken during a livestream | So the panel can avoid offering a "jump to" link that may no longer land in the right place |
| One in-progress draft, if you're mid-note | So navigating away or dismissing the capture card doesn't lose what you typed |
| Anonymous usage counters (e.g. "export_md: 12") | So the developer can see which features are used |

The usage counters contain no note text, no video titles, no URLs and no identifiers — only totals and
the dates the extension was used. They stay on your device like everything else, and you can read them
in the panel under **Usage** and reset them there at any time.

## What is never collected

No account, email address or name for you, the user of this extension. No browsing history beyond
what's needed to know which YouTube video is currently open. No video content, no captions, no audio —
this extension never reads or requests a video's caption track at all. No advertising or tracking
identifiers. Nothing is sold, shared or transmitted, because nothing is transmitted at all.

## Permissions, and what each is for

| Permission | Why it is needed |
| :-- | :-- |
| Host access to `*://*.youtube.com/*` | The extension's core function — reading the current playback time and injecting the "+ Note" button — only works on YouTube. This is also what lets the content script load automatically, without a separate `scripting`/`activeTab` grant. It carries no network capability of its own. |
| `storage` | Saving your notes, drafts and export preferences locally. |
| `downloads` | Saving the file when you export Markdown or CSV, and the full JSON backup. |
| `sidePanel` | The note list, search and export controls are a side panel, not a popup that closes when you click away. |

This extension does **not** request `activeTab`, `tabs` or `scripting`. The content script is injected
declaratively wherever the host permission matches. The panel exchanges exactly two message types with
it — "what video is this" and "seek to this timestamp" — and otherwise reads and writes
`chrome.storage.local` directly.

## Your data is yours

**Data → Export all data** writes every note to a single JSON file. **Import** reads it back, on this
machine or another one, merging by id so importing the same file twice never doubles a note.
**Clear all data** deletes everything immediately and permanently.

Because storage is local and per-device, uninstalling the extension or clearing your browser data
removes your saved notes. Export a backup first if you want to keep them.

## Verifying this yourself

Open devtools on YouTube with the extension active and watch the Network tab — you will see no
requests from the extension. The source is auditable: no `fetch`, `XMLHttpRequest`, `WebSocket` or
`sendBeacon` call exists anywhere in it, and `scripts/selftest.mjs` enforces that with a grep check on
every build.

## Contact

Questions about this policy: raise an issue on the extension's support page.
