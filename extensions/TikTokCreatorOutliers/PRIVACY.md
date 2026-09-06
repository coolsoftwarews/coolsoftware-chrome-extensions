# Privacy Policy — TikTok Creator Outlier Finder

**Last updated:** 2026-09-02

## The short version

This extension makes no network requests. Nothing it reads from a TikTok profile — view counts,
captions, hashtags, medians — is ever sent anywhere, because there is nowhere for it to be sent. There
is no server, no account and no analytics service behind this product.

## What is stored, and where

Everything is stored in your browser's own local storage (`chrome.storage.local`) on this device:

| Data | Why |
| :-- | :-- |
| The median view count computed for a creator's profile, and the sample size it's based on | So the header strip doesn't recompute from scratch every visit |
| Your last-used filter (ratio, date, length, sort) | So it's still set the next time you open a profile |
| Anonymous usage counters (e.g. "exports: 4", "profiles analysed: 9") | So the developer can see which features are used |

The usage counters contain no profile handles, no captions and no view counts — only totals, and a list
of the profile handles you've analysed (kept so the popup can show a distinct-profile count). All of it
stays on your device like everything else, and you can read it in the extension's popup under **Usage**
and reset it there at any time.

## What is never collected

No account, email address or name. No TikTok login or session data. No browsing history beyond the
profile currently open. No advertising or tracking identifiers. Nothing is sold, shared or transmitted,
because nothing is transmitted at all.

## Permissions, and what each is for

| Permission | Why it is needed |
| :-- | :-- |
| `activeTab` | Lets the popup tell whether the current tab is a TikTok profile, only when you open the popup. |
| `storage` | Saving cached medians, your filter preference and local usage counters. |
| `downloads` | Saving the file when you export a profile's outliers as CSV or Markdown, or export/import your own data backup. |
| `*://*.tiktok.com/*` host access | The extension's entire function is reading the video grid on a TikTok profile page and drawing badges over it. It grants no ability to act on your TikTok account — no posting, liking or following — and no network capability of its own. |

## Your data is yours

The popup's **Export all data** writes your cached medians and filter preference to a single JSON file.
**Import** reads it back, on this machine or another one. **Clear all data** deletes everything
immediately and permanently. Usage counters have their own **Reset usage counters** button.

Because storage is local and per-device, uninstalling the extension or clearing your browser data removes
everything this extension stored. Export a backup first if you want to keep it.

## Verifying this yourself

Open devtools on any TikTok profile with the extension active and watch the Network tab — you will see
no requests from the extension. The source is auditable: no `fetch`, `XMLHttpRequest`, `WebSocket` or
`sendBeacon` call exists anywhere in it.

## Contact

Questions about this policy: raise an issue on the extension's support page.
