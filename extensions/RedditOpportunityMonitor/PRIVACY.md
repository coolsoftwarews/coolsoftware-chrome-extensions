# Privacy Policy — Reddit Opportunity Lens

**Last updated:** 2026-09-02

## The short version

This extension makes no network requests. Nothing you read, save, note or export is ever sent
anywhere, because there is nowhere for it to be sent — there is no server, no account and no
analytics service behind this product.

## What is stored, and where

Everything is stored in your browser's own local storage (`chrome.storage.local`) on this device:

| Data | Why |
| :-- | :-- |
| The rules you write (intent phrases, topic words, ignore words) | To evaluate posts against them |
| Threads that matched a rule — title, subreddit, snippet, score, comment count, link | So the panel can show your matched threads and you can export them |
| The status (`new`/`replied`/`dismissed`) and note you set on a matched thread | It's your triage work |
| Anonymous usage counters (e.g. "export_csv: 4") | So the developer can see which features are used |

The usage counters contain no subreddit names, no post text and no identifiers — only totals and the
dates the extension was used. They stay on your device like everything else, and you can read them in
the panel under **Usage** and reset them there at any time.

## What is never collected

No account, email address or Reddit username of yours. No browsing history beyond what's needed to
show a chip on a matching post. No advertising or tracking identifiers. Nothing is sold, shared or
transmitted, because nothing is transmitted at all.

## What is never done on your behalf

This extension never votes, comments, replies, follows, joins a subreddit, sends a message, or posts
anything to Reddit. It is read-only: it reads posts already rendered in your tab and nothing else.
There is no code path anywhere in this extension that performs an action on your Reddit account.

## Where the data comes from

Only posts already rendered in your browser tab, on `reddit.com`, as you browse subreddits you've
chosen to visit. There is no Reddit API call, no background polling, and no scanning of subreddits you
aren't reading. Comment threads are not read in this version — only posts.

## Permissions, and what each is for

| Permission | Why it is needed |
| :-- | :-- |
| `*://*.reddit.com/*` (host access) | Reading posts already rendered on Reddit pages you visit, so they can be checked against your rules. Grants no ability to send anything anywhere — no code here opens a network connection. |
| `activeTab` | Letting the panel identify which Reddit tab is currently active, so "subreddit read" reflects the tab you're actually looking at. |
| `storage` | Saving your rules, matched threads and preferences locally. |
| `downloads` | Saving the CSV/Markdown export or the JSON backup file when you request one. |

## Your data is yours

**Data → Export all data** writes every rule and every matched thread to a single JSON file.
**Import** reads it back, on this machine or another one. **Clear all data** deletes everything
immediately and permanently.

Because storage is local and per-device, uninstalling the extension or clearing your browser data
removes your rules and matched threads. Export a backup first if you want to keep them.

## Verifying this yourself

Open devtools on any Reddit page with the extension active and watch the Network tab — you will see
no requests from the extension. The source is auditable: no `fetch`, `XMLHttpRequest`, `WebSocket` or
`sendBeacon` call exists anywhere in it.

## Contact

Questions about this policy: raise an issue on the extension's support page.
