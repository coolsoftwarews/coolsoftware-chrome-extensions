# Privacy Policy — Instagram Outlier Finder

**Last updated:** 2026-09-02

## The short version

This extension makes no network requests. Nothing it reads from an Instagram profile, and nothing
you filter, sort or export, is ever sent anywhere — there is no server, no account and no analytics
service behind this product.

## What is stored, and where

Everything is stored in your browser's own local storage (`chrome.storage.local`) on this device:

| Data | Why |
| :-- | :-- |
| A per-profile cache of the computed median (views/likes, sample size, date range) | So revisiting a profile you've already scrolled shows a number instantly, instead of recomputing from zero |
| Your last-used filter (ratio / type / date window / sort) | So the filter row remembers your preference between profiles |
| Anonymous usage counters (e.g. "profiles analysed: 12") and a parse-failure count | So the developer can see which features are used, and notice if Instagram's layout changes broke something |

The usage counters contain no handles, no post URLs, no view or like counts and no identifiers —
only totals and the dates the extension was used. You can read them and reset them at any time from
the toolbar popup.

## What is never collected

No account, email address or name. No Instagram login credentials — this extension never sees them;
it only reads what your own logged-in session already rendered into the page. No browsing history
beyond the profiles you open. No advertising or tracking identifiers. Nothing is sold, shared or
transmitted, because nothing is transmitted at all.

## Permissions, and what each is for

| Permission | Why it is needed |
| :-- | :-- |
| Host access to `*://*.instagram.com/*` | The extension's entire function — reading grid posts and their view/like counts — happens on instagram.com. No other site is accessed, and this grants no ability to send anything anywhere. |
| `activeTab` | Lets the toolbar popup know whether the current tab is an Instagram page, without requesting the broader "tabs" permission. |
| `storage` | Saving your last-used filter and the per-profile median cache locally. |
| `downloads` | Saving the `.csv` or `.md` file when you export, and the JSON backup from the popup's "Export all data". |

## Your data is yours

The toolbar popup's **Export all data** writes your cached profile medians and filter preference to
a single JSON file. **Import** reads it back, on this machine or another one. **Clear all data**
deletes everything immediately and permanently. Usage counters have their own separate **Reset**
button.

Because storage is local and per-device, uninstalling the extension or clearing your browser data
removes this data. Export a backup first if you want to keep it — though the median cache rebuilds
itself the next time you scroll a profile regardless.

## Verifying this yourself

Open devtools on an Instagram profile with the extension active and watch the Network tab — you will
see no requests originating from the extension. The source is auditable: no `fetch`,
`XMLHttpRequest`, `WebSocket` or `sendBeacon` call exists anywhere in it.

## Read-only, always

This extension never posts, likes, follows, comments or takes any action on Instagram on your
behalf. It only reads what your own browser already rendered.

## Contact

Questions about this policy: raise an issue on the extension's support page.
