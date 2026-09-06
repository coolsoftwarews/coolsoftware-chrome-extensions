# Privacy Policy — YouTube Sign-in-Free Playlist Sorter

**Last updated:** 2026-09-02

## The short version

This extension makes no network requests. There is no sign-in, no Google account access, no API key
and no server anywhere behind it — sorting happens entirely from what YouTube has already rendered
into the page you're looking at.

## What is stored, and where

Everything is stored in your browser's own local storage (`chrome.storage.local`) on this device, and
it is deliberately small:

| Data | Why |
| :-- | :-- |
| Your last-used sort order (duration / title / date / YouTube's own order) | So the next playlist you open starts with your preferred sort |
| Your last-used time-budget value (minutes) | Convenience default for the "build a set that fits N minutes" filter |
| Anonymous usage counters (e.g. "export_csv: 4") | So the developer can see which features are used |

**Playlist contents are never stored.** The video list you see in the panel is read live from the page
each time and exists only in that tab's memory — closing the tab or navigating away discards it.
Nothing about which playlists or videos you've viewed is written anywhere, on this device or off it.

## What is never collected

No account, email address, sign-in or Google OAuth token of any kind — this extension never requests
one. No browsing history. No playlist or video titles, ids, or URLs in the usage counters (only
event totals and the dates the extension was used). No advertising or tracking identifiers. Nothing
is sold, shared or transmitted, because nothing is transmitted at all.

## Permissions, and what each is for

| Permission | Why it is needed |
| :-- | :-- |
| `*://*.youtube.com/*` (host access) | Reading the playlist page's own rendered content, and nothing else — this permission grants no ability to send anything anywhere. |
| `activeTab` | Identifying the tab the panel should talk to. |
| `storage` | Saving your sort/time-budget preference and usage counters locally. |
| `downloads` | Saving the file when you export a CSV, a Markdown table, or a preferences backup. |
| `sidePanel` | The sort controls, table and export buttons are a side panel. |

**Not requested:** `tabs`, `scripting`, any Google/YouTube account permission, and no host permission
beyond `youtube.com`.

## Your data is yours

**Data → Export preferences** writes your stored sort/time-budget preference to a single JSON file.
**Import** reads it back, on this machine or another one. **Clear all data** deletes it immediately.

## Verifying this yourself

Open devtools on a YouTube playlist page with the extension active and watch the Network tab — you
will see no requests from the extension. The source is auditable: `npm test` in this extension's own
repository greps every source file for `fetch`, `XMLHttpRequest`, `sendBeacon` and `WebSocket` calls
and fails the build if any exist.

## Contact

Questions about this policy: raise an issue on the extension's support page.
