# Privacy Policy — LinkedIn Profile Notes

**Last updated:** 2026-09-02

## The short version

This extension makes no network requests. Nothing you write, tag, or export is ever sent
anywhere, because there is nowhere for it to be sent — there is no server, no account and no
analytics service behind this product.

## What is stored, and where

Everything is stored in your browser's own local storage (`chrome.storage.local`) on this device:

| Data | Why |
| :-- | :-- |
| The name, headline and profile URL of people whose profile you visited and chose to note | Used only to label your own note sensibly and to key it to the right profile |
| The note text and tag you write | The core product — it's your memory of the relationship, not ours |
| When you first and most recently noted a profile | Powers the "last noted: 3 days ago" indicator and the panel's recency sort |
| Anonymous usage counters (e.g. "note_saved: 12") | So the developer can see which features are used |

The usage counters contain no names, headlines, note text or profile URLs — only totals and the
dates the extension was used. They stay on your device like everything else, and you can read
them in the panel under **Usage** and reset them there at any time.

## What is never collected

No email address or phone number is ever resolved or stored — this extension does not do contact
enrichment, and never will (see README, "What this extension will never do"). No browsing history
beyond the profile you're currently looking at when you choose to write a note. No advertising or
tracking identifiers. Nothing is sold, shared or transmitted, because nothing is transmitted at
all.

## What this extension never does on the platform

It never posts, comments, likes, follows, connects with, or messages anyone. It never visits a
profile on your behalf, never scrapes a list of profiles, and never reads anything beyond the
name, headline and URL already rendered on the page you're looking at when you open the note
editor.

## Permissions, and what each is for

| Permission | Why it is needed |
| :-- | :-- |
| `activeTab` | Knowing which tab is showing the profile the note editor should attach to |
| `storage` | Saving your notes, tags and export preferences locally |
| `downloads` | Saving the file when you export CSV or a full JSON data backup |
| `sidePanel` | The note library — search, sort, tag filter and export controls — is a side panel |
| Host access to `*.linkedin.com` | Reading a profile's own name and headline, and adding the "+ Note" control. No other site is accessed, and no data leaves the device. |

## Your data is yours

**Data → Export all data** writes every note to a single JSON file. **Import** reads it back, on
this machine or another one, merging rather than overwriting anything already saved locally — if
the same profile has a note on both sides, the imported text is appended rather than discarded.
**Clear all data** deletes everything immediately and permanently.

Because storage is local and per-device, uninstalling the extension or clearing your browser data
removes your notes. Export a backup first if you want to keep them.

## Verifying this yourself

Open devtools on linkedin.com with the extension active and watch the Network tab — you will see
no requests from the extension. The source is auditable: no `fetch`, `XMLHttpRequest`, `WebSocket`
or `sendBeacon` call exists anywhere in it.

## Contact

Questions about this policy: raise an issue on the extension's support page.
