# Privacy Policy — LinkedIn Post Outlier Finder

**Last updated:** 2026-09-02

## The short version

This extension makes no network requests. Nothing it reads from a LinkedIn page, and nothing you
filter, sort or export, is ever sent anywhere — there is no server, no account and no analytics
service behind this product.

## What is stored, and where

Everything is stored in your browser's own local storage (`chrome.storage.local`) on this device:

| Data | Why |
| :-- | :-- |
| A per-author cache of the computed engagement median (median value, sample size, when it was computed) | So a hashtag or search page can badge a post confidently once you've visited that author's profile history, instead of showing nothing on a thin sample |
| Your last-used filter (ratio / date window / sort) | So the filter row remembers your preference across pages |
| Anonymous usage counters (e.g. "profile histories scanned: 12") and a parse-failure count | So the developer can see which features are used, and notice if LinkedIn's layout changes broke something |

The usage counters contain no author names, no post URLs, no engagement numbers and no identifiers —
only totals and the dates the extension was used. You can read them and reset them at any time from
the toolbar popup.

## What is never collected

No account, email address or name of yours. No LinkedIn login credentials — this extension never sees
them; it only reads what your own logged-in session already rendered into the page. No browsing
history beyond the pages you open. No advertising or tracking identifiers. Nothing is sold, shared or
transmitted, because nothing is transmitted at all.

## About the people whose posts this extension reads

The cached per-author median stores a public profile URL, the author's own name as LinkedIn already
displayed it to you, and a computed engagement number — nothing beyond what LinkedIn already rendered
into your feed. This cache never leaves your device, is never used to identify or contact anyone, and
is deleted the moment you use **Clear all data**.

## Permissions, and what each is for

| Permission | Why it is needed |
| :-- | :-- |
| Host access to `*://*.linkedin.com/*` | The extension's entire function — reading a page's posts and their reaction/comment counts — happens on linkedin.com. No other site is accessed, and this grants no ability to send anything anywhere. |
| `activeTab` | Lets the toolbar popup know whether the current tab is a LinkedIn page, without requesting the broader "tabs" permission. |
| `storage` | Saving your last-used filter and the per-author median cache locally. |
| `downloads` | Saving the `.csv` or `.md` file when you export, and the JSON backup from the popup's "Export all data". |

Not requested, and not needed by any code path in this extension: `sidePanel`, `tabs`, `scripting`.

## Your data is yours

The toolbar popup's **Export all data** writes your cached author medians and filter preference to a
single JSON file. **Import** reads it back, on this machine or another one. **Clear all data** deletes
everything immediately and permanently. Usage counters have their own separate **Reset** button.

Because storage is local and per-device, uninstalling the extension or clearing your browser data
removes this data. Export a backup first if you want to keep it — though the median cache rebuilds
itself the next time you visit a profile's post history regardless.

## Verifying this yourself

Open devtools on a LinkedIn page with the extension active and watch the Network tab — you will see
no requests originating from the extension. The source is auditable: no `fetch`, `XMLHttpRequest`,
`WebSocket` or `sendBeacon` call exists anywhere in it, and `scripts/selftest.mjs` enforces that with
an automated check on every test run.

## Read-only, always

This extension never posts, reacts, comments, follows or connects on LinkedIn on your behalf. It only
reads what your own browser already rendered. There is no code path anywhere in this extension capable
of writing to the page.

## Contact

Questions about this policy: raise an issue on the extension's support page.
