# Privacy Policy — LinkedIn Engagement Lead Finder

**Last updated:** 2026-09-02

## The short version

This extension makes no network requests. Nothing you collect, note, or export is ever sent
anywhere, because there is nowhere for it to be sent — there is no server, no account and no
analytics service behind this product.

## What is stored, and where

Everything is stored in your browser's own local storage (`chrome.storage.local`) on this device:

| Data | Why |
| :-- | :-- |
| Name, headline, profile URL, comment text, comment date and reaction count of people who commented on posts you chose to collect from | The core product — a list of who engaged, so you can follow up yourself |
| Which post each comment came from | Shown in the panel's "group by post" view and in every export |
| Your qualification rules (keywords) | So a lead can be starred without you retyping the rule every time |
| Manual status (new / shortlist / contacted / dismissed) and any note you add | It's your list; the tool remembers how you're working it |
| Anonymous usage counters (e.g. "leads_collected: 40") | So the developer can see which features are used |

The usage counters contain no names, headlines, comment text, profile URLs or post identifiers —
only totals and the dates the extension was used. They stay on your device like everything else, and
you can read them in the panel under **Usage** and reset them there at any time.

## What is never collected

No account, email address, or phone number is ever resolved or stored — this extension does not do
contact enrichment, and never will (see README, "What this extension will never do"). No browsing
history beyond the LinkedIn posts you chose to collect from. No advertising or tracking identifiers.
Nothing is sold, shared or transmitted, because nothing is transmitted at all.

## What this extension never does on the platform

It never posts, comments, likes, follows, connects with, or messages anyone. It never scrolls,
expands, or "loads more" on your behalf. It only reads comment threads that are already visible in
your tab when you click "Collect commenters", and only when you click it.

## Permissions, and what each is for

| Permission | Why it is needed |
| :-- | :-- |
| `activeTab` | Knowing which tab the panel should read leads from and refresh for |
| `storage` | Saving your leads, rules, statuses, notes and export preferences locally |
| `downloads` | Saving the file when you export CSV, Markdown, or a full data backup |
| `sidePanel` | The lead list, search, filters and export controls are a side panel |
| Host access to `*.linkedin.com` | Reading the comment threads you choose to collect from and adding the "Collect commenters" control. No other site is accessed, and no data leaves the device. |

## Your data is yours

**Data → Export all data** writes every lead and rule to a single JSON file. **Import** reads it back,
on this machine or another one, merging rather than overwriting anything already collected locally.
**Clear all data** deletes everything immediately and permanently.

Because storage is local and per-device, uninstalling the extension or clearing your browser data
removes your leads. Export a backup first if you want to keep them.

## Verifying this yourself

Open devtools on linkedin.com with the extension active and watch the Network tab — you will see no
requests from the extension. The source is auditable: no `fetch`, `XMLHttpRequest`, `WebSocket` or
`sendBeacon` call exists anywhere in it.

## Contact

Questions about this policy: raise an issue on the extension's support page.
