# Privacy Policy — X Thread Unroll & Reader Export

**Last updated:** 2026-09-02

## The short version

This extension makes no network requests. The thread you unroll never leaves your device — it is
read from the same tab you're already logged into, shown in a side panel, and only ever leaves your
machine if you personally click Copy or Download. There is no server, no account and no analytics
service behind this product, and — unlike server-side "unroll this thread" tools — nothing you read
is ever republished anywhere.

## What is stored, and where

Almost nothing. The only thing this extension writes to your browser's local storage
(`chrome.storage.local`) that survives after you close the panel is:

| Data | Why |
| :-- | :-- |
| Your last-used export format (Markdown or plain text) | So the panel remembers your preference next time |
| Anonymous usage counters (e.g. "thread_unrolled: 4") | So the developer can see which features are used |

**The thread you're reading is never stored.** While the panel is open, the currently unrolled
thread's text, author names, handles and media references live only in memory in the tab's content
script and the panel — never written to disk, never persisted. Close the panel or reload the page and
that reading view is gone; export or copy it first if you want to keep it. There is no saved library,
no history of past unrolls, and no way for the extension itself to show you a thread you already read
unless you kept the file you exported.

The usage counters contain no post text, no handles, no URLs and no identifiers — only totals and the
dates the extension was used. You can read them in the panel under **Usage** and reset them there at
any time.

## What is never collected

No account, email address or name. No browsing history beyond the specific thread you click Unroll
on. No X API access, no API keys. No advertising or tracking identifiers. Nothing is sold, shared or
transmitted, because nothing is transmitted at all.

## What this extension does not do

It never posts, replies, likes, reposts, follows or messages on your behalf — it only reads what X
has already rendered on the page you're looking at, and only after you click **Unroll**. Auto-scroll
only runs while the panel is open and only on the tab you're actively reading; it never runs in the
background, never polls, and stops on its own within a few seconds once nothing new appears (or the
moment you click **Stop**).

## Why this is different from "paste a link" unroll tools

Services that unroll a thread from a URL fetch it with their own server, not your session — so
anything only visible to you (a protected account, a follow-gated reply) is invisible to them — and
they publish what they find as a new public page at their own domain, indexable and outside the
original author's control. This extension does neither: it reads only what's already rendered in your
authenticated tab, and produces nothing but a private file on your own device or text on your own
clipboard.

## Permissions, and what each is for

| Permission | Why it is needed |
| :-- | :-- |
| Host access to `x.com` and `twitter.com` | The extension's entire function happens on these two domains: reading a thread you're viewing and adding the "Unroll" control. No other site is accessed. |
| `activeTab` | Identifying the tab the panel should act on. |
| `storage` | Saving your export-format preference and usage counters locally. |
| `downloads` | Saving the file when you export Markdown or plain text. |
| `sidePanel` | The reading view is a side panel, shown beside X rather than covering it. |

## Your data is yours

Everything this extension produces — the exported Markdown or text file, or whatever you copied to
the clipboard — is a plain file or plain text under your own control from the moment it's created.
There is nothing to "export from" the extension beyond that, because nothing else is stored.

## Verifying this yourself

Open devtools on x.com with the extension active and watch the Network tab — you will see no requests
from the extension. The source is auditable: no `fetch`, `XMLHttpRequest`, `WebSocket` or
`sendBeacon` call exists anywhere in it.

## Contact

Questions about this policy: raise an issue on the extension's support page.
