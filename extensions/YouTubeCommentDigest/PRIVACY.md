# Privacy Policy — YouTube Comment Digest & Best-Comments Finder

**Last updated:** 2026-09-02

## The short version

This extension makes no network requests. It reads the comments YouTube has already loaded into the
page you're looking at, shows them to you sorted and searchable, and lets you export what you're
looking at as a file on your own device. Nothing is sent anywhere, because there is no server, no
account and no analytics service behind this product.

## What is stored, and where

Everything lives in your browser's own local storage (`chrome.storage.local`) on this device, and it
is limited to:

| Data | Why |
| :-- | :-- |
| Your chosen sort order and last-used export format | So the panel doesn't reset to defaults every time you open it |
| Anonymous usage counters (e.g. "sort_changed: 4") | So the developer can see which features are used |

**Comments themselves are never stored.** This extension is a mirror of whatever is currently loaded
on the page in front of you, not an archive — reload the video and the panel starts over with
whatever YouTube has rendered this time. There is no database of comments anywhere, on this device or
any other.

The usage counters contain no comment text, no video ids, no search terms and no identifiers — only
event names, totals, and the dates the extension was used. You can clear them at any time from the
panel's **Settings** sheet.

## What is never collected

No account, email address or name. No browsing history. No comment text, no search queries, no video
ids beyond what's needed to build a filename for a file you explicitly chose to export. No
advertising or tracking identifiers. Nothing is sold, shared or transmitted, because nothing is
transmitted at all.

## What this extension will never do

This is read-only on YouTube, permanently — not a V1 limitation. There is no code path anywhere in
this extension that posts a comment, likes anything, replies to anything, or otherwise acts on
YouTube on your behalf. "Load more comments" scrolls the page, exactly like your own scroll wheel
would, and does nothing else.

## Permissions, and what each is for

| Permission | Why it is needed |
| :-- | :-- |
| `activeTab` | Reading the comments on the YouTube tab you have open when you use the extension |
| `storage` | Saving your sort/export preferences and local usage counters |
| `downloads` | Saving the file when you export Markdown or CSV |
| `sidePanel` | The comment list, search, sort and export controls are a side panel |
| `*://*.youtube.com/*` (host permission) | Reading the comment DOM on YouTube pages. It grants no ability to send anything anywhere — no code in this extension opens a network connection. |

## Your data is yours

Because nothing but preferences and counters is stored, there is nothing to "export" beyond what
you've deliberately exported already — every Markdown/CSV file you save with this extension is a
plain file on your own disk, in your Downloads folder, under your control from the moment it's
written. **Settings → Clear local preferences & usage counts** removes everything this extension has
ever stored, immediately and permanently.

## Verifying this yourself

Open devtools on any YouTube page with the extension active and watch the Network tab — you will see
no requests originating from this extension. The source is auditable: no `fetch`, `XMLHttpRequest`,
`WebSocket` or `sendBeacon` call exists anywhere in it (`scripts/selftest.mjs` asserts this on every
build).

## Contact

Questions about this policy: raise an issue on the extension's support page.
