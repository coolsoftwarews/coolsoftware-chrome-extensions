# Privacy Policy — X Keyword Mute & Filter List

**Last updated:** 2026-09-02

## The short version

This extension makes no network requests. Nothing it reads from your X timeline, and nothing you do
in its popup, is ever sent anywhere — because there is nowhere for it to be sent. There is no server,
no account and no analytics service behind this product.

## What it reads, and why that matters

This extension only ever reads post text **X has already rendered in your own browser tab**, while
**you are actively looking at that tab**. It never scans in the background, never fetches a post you
haven't scrolled to, and never reads anything beyond what's on screen: a post's own text (including an
embedded quoted post's text, when present), the author's display name, and its hashtags.

**It never stores the content it reads.** A hidden post's text is never written to
`chrome.storage.local` or anywhere else — only the *rule* that matched it, and a running hit count on
that rule, are ever saved. If you uninstall the extension or clear your rules, there is no hidden log
of posts it once matched.

## What is stored, and where

Everything is stored in your browser's own local storage (`chrome.storage.local`) on this device:

| Data | Why |
| :-- | :-- |
| Your rules (keyword/phrase, match mode, case-sensitivity, an optional display label) | So they can be applied to posts you scroll past |
| Each rule's all-time hit count | The panel's "hit-count per rule" — the safety net for a rule that's matching too much |
| Anonymous usage counters (e.g. "rules created: 3", "posts hidden today: 12") | So the developer can see which features are used |

The usage counters contain no post text, no author names and no identifiers — only totals and the
dates the extension was used. You can read them in the popup under **Usage** and reset them there at
any time.

## What is never collected

No account, email address or name. No X login or session data — the extension reads the page using
your existing logged-in session in the browser, exactly as you already see it; it never touches your
credentials. No follower lists, no direct messages, no browsing history beyond the rule list you
create. No advertising or tracking identifiers. Nothing is sold, shared or transmitted, because
nothing is transmitted at all.

## Permissions, and what each is for

| Permission | Why it is needed |
| :-- | :-- |
| Host access to `*://*.x.com/*` and `*://*.twitter.com/*` | The extension's entire function happens on X — reading post text already rendered in a tab you're viewing, and applying your local rules to it. No other site is accessed, and no data leaves the device. |
| `storage` | Saving your rule list and hit counts locally. |

There is no `activeTab`, `downloads` or `sidePanel` permission. Rule-list export writes a file using a
plain in-page download link, not a browser API; the toolbar UI is a popup, not a side panel.

## No automation

This extension never clicks, likes, follows, replies, reposts or messages on your behalf. It is
read-only on X, permanently — not a V1 limitation. It also does not scan in the background: filtering
only happens while an X tab is open in front of you.

## Starter filter packs are not a network feature

The bundled starter packs (spoilers, politics, crypto/NFT spam, engagement bait) are static data
shipped inside the extension package. They are never fetched, updated, or checked against a server. A
new pack ships in a new version of the extension, exactly like any other bundled file.

## Your data is yours

**Data → Export rules (.json)** writes your entire rule list to a single JSON file. **Import** reads it
back, on this machine or another one. **Clear all data** deletes every rule immediately and
permanently.

Because storage is local and per-device, uninstalling the extension or clearing your browser data
removes your rules. Export a backup first if you want to keep them.

## Verifying this yourself

Open devtools on X with the extension active and watch the Network tab — you will see no requests from
the extension. The source is auditable: no `fetch`, `XMLHttpRequest`, `WebSocket` or `sendBeacon` call
exists anywhere in it.

## Contact

Questions about this policy: raise an issue on the extension's support page.
