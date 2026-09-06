# Privacy Policy — Reddit Voice-of-Customer Saver

**Last updated:** 2026-09-02

## The short version

This extension makes no network requests. Nothing you select, note, read or export is ever sent
anywhere, because there is nowhere for it to be sent — there is no server, no account and no
analytics service behind this product.

## What is stored, and where

Everything is stored in your browser's own local storage (`chrome.storage.local`) on this device:

| Data | Why |
| :-- | :-- |
| The exact text you selected on Reddit, plus the surrounding comment or post body | The quote and its context, for citation |
| The Reddit username as displayed, unless you save without it | So you can cite who said it |
| Subreddit, thread title, thread URL, permalink, score and date | Written into the panel and every export |
| The theme you assign and any note you add | It's your research |
| Anonymous usage counters (e.g. "export_md: 12") | So the developer can see which features are used |

The usage counters contain no URLs, no quote text, no usernames and no identifiers — only totals and
the dates the extension was used. They stay on your device like everything else, and you can read
them in the panel under **Usage** and reset them there at any time.

## What is never collected

No account, email address or name for you, the user of this extension. No browsing history. No page
contents beyond the quotes you explicitly select and save. No advertising or tracking identifiers.
Nothing is sold, shared or transmitted, because nothing is transmitted at all.

## Usernames of the people you quote

A quote can include the Reddit username of the person you're citing, because a quote without its
source isn't citable — that's the product's whole job. This can include sensitive disclosures
(health, finance, employment) if that's what the comment says. Everything stays local to your
device, and the panel has two ways to reduce this data:

- **"Save new quotes without usernames"** — a toggle in the panel. Turn it on before you save and the
  author field is left blank going forward.
- **"Hide author"** on any already-saved quote — a one-click, one-way action that clears the username
  from that saved card.

## Permissions, and what each is for

| Permission | Why it is needed |
| :-- | :-- |
| Host access to `*://*.reddit.com/*` | The extension's core function — reading the post or comment you selected on Reddit — only works on Reddit. This is also what lets the content script load automatically, without a separate `scripting`/`activeTab` grant. It carries no network capability of its own. |
| `storage` | Saving your quotes, themes, notes and export preferences locally. |
| `downloads` | Saving the file when you export Markdown, CSV or JSON. |
| `sidePanel` | The research library — search, themes, export — is a side panel, not a popup that closes when you click away. |

This extension does **not** request `activeTab`, `tabs` or `scripting`. The content script is
injected declaratively wherever the host permission matches, and the panel never queries or messages
a tab — it reads and writes `chrome.storage.local` directly.

## Your data is yours

**Data → Export all data** writes every quote and theme to a single JSON file. **Import** reads it
back, on this machine or another one, merging by id so importing the same file twice never doubles a
quote. **Clear all data** deletes everything immediately and permanently.

Because storage is local and per-device, uninstalling the extension or clearing your browser data
removes your saved quotes. Export a backup first if you want to keep them.

## Verifying this yourself

Open devtools on Reddit with the extension active and watch the Network tab — you will see no
requests from the extension. The source is auditable: no `fetch`, `XMLHttpRequest`, `WebSocket` or
`sendBeacon` call exists anywhere in it.

## Contact

Questions about this policy: raise an issue on the extension's support page.
