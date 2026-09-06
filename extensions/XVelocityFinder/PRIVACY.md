# Privacy Policy — X Velocity Finder

**Last updated:** 2026-09-02

## The short version

This extension makes no network requests. Nothing you see on X, and nothing this extension computes
from it, is ever sent anywhere, because there is nowhere for it to be sent — there is no server, no
account, no X API key, and no analytics service behind this product.

## What is stored, and where

Everything is stored in your browser's own local storage (`chrome.storage.local`) on this device:

| Data | Why |
| :-- | :-- |
| An author's recent velocity numbers (up to their last 20 badged posts, as plain numbers) | To compute the outlier ratio against that author's own baseline |
| Your filter settings (minimum velocity, minimum ratio, age band, dim/hide) | So they persist between visits |
| Anonymous usage counters (e.g. "export_csv: 4") | So the developer can see which features are used, and whether X's layout has changed under the extension |

The usage counters contain no post text, no post ids, no author handles and no identifiers — only
event names, totals, and the dates the extension was used. They stay on your device like everything
else, and you can read them and reset them at any time from the extension's popup.

## What is never stored

Post text, post ids, links and raw like/repost/reply counts are read into memory only for the tab
you're looking at, to draw that tab's badges and build that export file. They are **not** written to
`chrome.storage.local` and are gone the moment you close or reload the tab. Only the *derived* number
(engagement per hour) for a post that actually produced one joins that author's stored baseline —
never the post's content.

No account, email address or name. No browsing history beyond the current tab's timeline while it's
open. No advertising or tracking identifiers. Nothing is sold, shared or transmitted, because nothing
is transmitted at all.

## Permissions, and what each is for

| Permission | Why it is needed |
| :-- | :-- |
| `activeTab` | Letting the popup ask the current tab for its live badge/filter status when you open it. |
| `storage` | Saving author medians, filter settings and usage counters locally. |
| `downloads` | Saving the file when you export CSV or Markdown, or a JSON backup of your data. |
| `*://*.x.com/*`, `*://*.twitter.com/*` | Reading the rendered timeline on the two domains X currently resolves on, so badges and filters can run there. This grants no ability to send anything anywhere — no code in this extension opens a network connection. |

## Your data is yours

The popup's **Your data** section: **Export all data** writes every stored author baseline and your
filter settings to a single JSON file. **Import** reads it back, on this machine or another one.
**Clear all data** deletes everything immediately and permanently.

Because storage is local and per-device, uninstalling the extension or clearing your browser data
removes your author baselines. Export a backup first if you want to keep them.

## Verifying this yourself

Open devtools on x.com with the extension active and watch the Network tab — you will see no requests
from the extension. The source is auditable: no `fetch`, `XMLHttpRequest`, `WebSocket` or
`sendBeacon` call exists anywhere in it.

## Read-only, always

This extension never posts, likes, reposts, replies, follows or takes any action on your account. It
only reads what is already rendered on the page you're looking at.

## Contact

Questions about this policy: raise an issue on the extension's support page.
