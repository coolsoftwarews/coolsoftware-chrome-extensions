# Privacy Policy — LinkedIn Job Application Tracker (read-only)

**Last updated:** 2026-09-02

## The short version

This extension makes no network requests. Nothing you track, note, or export is ever sent
anywhere, because there is nowhere for it to be sent — there is no server, no account and no
analytics service behind this product.

## What is stored, and where

Everything is stored in your browser's own local storage (`chrome.storage.local`) on this device:

| Data | Why |
| :-- | :-- |
| Job title, company, location, posted date and salary range (when shown), and the job's URL | The tracked card — this is the product |
| The stage you moved a job to (Saved / Applied / Interviewing / Offer / Rejected / Withdrawn) | Your pipeline |
| Any note you attach to a job | It's your record — interview dates, contact names, anything you choose to type in yourself |
| A "no longer accepting applications" flag, set only when you revisit a job you already track | So a closed posting is visible without deleting your notes |
| Anonymous usage counters (e.g. "export_csv: 4") | So the developer can see which features are used |

The usage counters contain no job titles, no companies, no notes and no URLs — only totals and the
dates the extension was used. They stay on your device like everything else, and you can read them
in the panel under **Usage** and reset them there at any time.

## What is never collected

No account, email address or name. No LinkedIn login credentials — this extension reads only what
is already rendered on the page for your existing, signed-in session; it never touches your password
or session token. **No contact emails or phone numbers are ever extracted from a posting** — notes
are entirely what you type, never scraped from the page. No browsing history beyond the jobs you
explicitly track. No advertising or tracking identifiers. Nothing is sold, shared or transmitted,
because nothing is transmitted at all.

## What this extension will never do

This extension is strictly read-only on LinkedIn. There is no code path anywhere in it that submits
a form, clicks Apply, fills in an Easy Apply flow, posts, connects, follows or messages on your
behalf. The only writes it ever makes to the page are its own injected "+ Track this job" button and
confirmation card — nothing that could be mistaken for an action you didn't take yourself. This is a
permanent design constraint, not a V1 limitation.

## Permissions, and what each is for

| Permission | Why it is needed |
| :-- | :-- |
| Host access to `*.linkedin.com` | The track button and everything it reads only exist on LinkedIn; the extension has no reason to run — and does not run — anywhere else |
| `activeTab` | Identifying the active LinkedIn tab so a track action applies to the posting you're looking at |
| `storage` | Saving your tracked jobs, stages and notes locally |
| `downloads` | Writing the exported .csv/.md/.json file when you ask for one |
| `sidePanel` | The tracker is a side panel, opened from the toolbar icon |

## Your data is yours

**Data → Export CSV / Markdown / JSON** writes your tracked jobs to a file on your device. The JSON
export is a full backup and can be **imported** back, on this machine or another one, without
creating duplicates. **Clear all data** deletes every tracked job immediately and permanently.

Because storage is local and per-device, uninstalling the extension or clearing your browser data
removes your tracker. Export a backup first if you want to keep it. You are warned once local
storage crosses 80% full, with an export always one click away.

## Verifying this yourself

Open devtools on LinkedIn with the extension active and watch the Network tab — you will see no
requests from the extension. The source is auditable: no `fetch`, `XMLHttpRequest`, `WebSocket` or
`sendBeacon` call exists anywhere in it.

## Contact

Questions about this policy: raise an issue on the extension's support page.
