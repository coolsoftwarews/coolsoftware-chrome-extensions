# Privacy Policy — Facebook Group Opportunity Finder

**Last updated:** 2026-09-02

## The short version

This extension makes no network requests. Nothing it reads from a Facebook group, and nothing you do
in its panel, is ever sent anywhere — because there is nowhere for it to be sent. There is no server,
no account and no analytics service behind this product.

## What it reads, and why that matters

Group content is personal, and often sensitive — support groups, local buy/sell groups, professional
communities. This extension only ever reads posts **Facebook has already rendered in your own
browser tab**, in a group **you are a member of**, while **you are actively looking at that tab**. It
never joins a group, never scans a group in the background, never scrapes a member list, and never
extracts anyone's contact details. If Facebook doesn't show it to you, this extension never sees it.

## What is stored, and where

Everything is stored in your browser's own local storage (`chrome.storage.local`) on this device:

| Data | Why |
| :-- | :-- |
| Your rules (match phrases, topic words, ignore words) | So they can be applied to posts you scroll past |
| Matched posts: group name, author, post text, date, comment count, a link to the post | What the panel shows you, and what you export |
| The status (new / replied / dismissed) and note you attach to a matched post | It's your triage, saved locally |
| Anonymous usage counters (e.g. "rules created: 3") | So the developer can see which features are used |

The usage counters contain no group names, no post text, no author names and no identifiers — only
totals and the dates the extension was used. You can read them in the panel under **Usage** and reset
them there at any time.

## What is never collected

No account, email address or name. No Facebook login or session data — the extension reads the page
using your existing logged-in session in the browser, exactly as you already see it; it never touches
your credentials. No member lists, no contact information, no browsing history outside of what you
choose to capture as a matched post. No advertising or tracking identifiers. Nothing is sold, shared
or transmitted, because nothing is transmitted at all.

## Permissions, and what each is for

| Permission | Why it is needed |
| :-- | :-- |
| Host access to `*://*.facebook.com/*` | The extension's entire function happens on Facebook — reading post text in a group feed you're already viewing. No other site is accessed, and no data leaves the device. |
| `activeTab` | Knowing which tab the panel should read status from. |
| `storage` | Saving your rules and matched posts locally. |
| `downloads` | Saving the file when you export CSV, Markdown, or a full JSON backup. |
| `sidePanel` | The rules list, matched-post list and export controls are a side panel, not an overlay on top of Facebook's own UI. |

## No automation

This extension never clicks, likes, joins, follows, comments or messages on your behalf. It is
read-only on Facebook, permanently — not a V1 limitation. It also does not scan in the background:
scanning only happens while a group tab is open in front of you, because background polling of a page
you aren't looking at is automation, and automation is what gets accounts and extensions banned.

## Your data is yours

**Data → Export all data** writes every rule and every matched post to a single JSON file.
**Import** reads it back, on this machine or another one. **Clear all data** deletes everything
immediately and permanently.

Because storage is local and per-device, uninstalling the extension or clearing your browser data
removes your rules and matched posts. Export a backup first if you want to keep them.

## Verifying this yourself

Open devtools on a Facebook group with the extension active and watch the Network tab — you will see
no requests from the extension. The source is auditable: no `fetch`, `XMLHttpRequest`, `WebSocket` or
`sendBeacon` call exists anywhere in it.

## Contact

Questions about this policy: raise an issue on the extension's support page.
