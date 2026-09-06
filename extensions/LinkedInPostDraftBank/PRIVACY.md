# Privacy Policy — LinkedIn Post Draft Bank & Formatting Checker

**Last updated:** 2026-09-02

## The short version

This extension makes no network requests. Nothing you write, save, or export is ever sent anywhere,
because there is nowhere for it to be sent — there is no server, no account, no AI service and no
analytics service behind this product.

## What is stored, and where

Everything is stored in your browser's own local storage (`chrome.storage.local`) on this device:

| Data | Why |
| :-- | :-- |
| Text of drafts you're writing (auto-saved as you type, and when you click "Save draft") | So a half-written post survives a closed tab or a crash |
| Text and tags of templates you explicitly save | Your personal reusable library of hooks and formats |
| Text, tags, publish date label and permalink of your own published posts | An automatic personal archive of what you've actually posted, from your own activity feed only |
| Anonymous usage counters (e.g. "template_inserted: 6") | So the developer can see which features are used |

The usage counters contain no post text, no tags, and no URLs — only totals and the dates the
extension was used. They stay on your device like everything else, and you can read them in the panel
under **Usage** and reset them there at any time.

## What is never collected

No account, email address, or any personal identifier is ever resolved or stored. No AI processing of
any kind — nothing you write is sent to a language model, because there is no such integration in this
extension and there never will be (see README). No posts, drafts or profile data belonging to anyone
other than you — the published-post archive only ever reads your own profile's activity feed, verified
against LinkedIn's own "you are signed in as" link before anything is captured. No advertising or
tracking identifiers. Nothing is sold, shared or transmitted, because nothing is transmitted at all.

## What this extension never does on the platform

It never posts, publishes, schedules, likes, follows, connects with, or messages anyone. The only way
this extension ever writes into LinkedIn's own page is inserting text you already wrote and explicitly
chose to reuse into a post composer you already had open — clicking "Insert into composer" on a saved
template. It never clicks "Post" for you, and it never submits anything.

## Permissions, and what each is for

| Permission | Why it is needed |
| :-- | :-- |
| `activeTab` | Knowing which tab the panel should read composer status from |
| `storage` | Saving your drafts, templates, archived posts, tags and export preferences locally |
| `downloads` | Saving the file when you export CSV, Markdown, or a full data backup |
| `sidePanel` | The library, search, filters and export controls are a side panel |
| Host access to `*.linkedin.com` | Reading the post composer and your own activity feed, and (only on your explicit click) inserting a saved template's text. No other site is accessed, and no data leaves the device. |

## Your data is yours

**Data → Export all data** writes every draft, template and archived post to a single JSON file.
**Import** reads it back, on this machine or another one, merging rather than overwriting anything
already saved locally. **Clear all data** deletes everything immediately and permanently.

Because storage is local and per-device, uninstalling the extension or clearing your browser data
removes your library. Export a backup first if you want to keep it.

## Verifying this yourself

Open devtools on linkedin.com with the extension active and watch the Network tab — you will see no
requests from the extension. The source is auditable: no `fetch`, `XMLHttpRequest`, `WebSocket` or
`sendBeacon` call exists anywhere in it, and `npm test` enforces this with a grep check on every build.

## Contact

Questions about this policy: raise an issue on the extension's support page.
