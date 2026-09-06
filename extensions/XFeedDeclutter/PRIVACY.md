# Privacy Policy — X Feed Declutter & Focus

**Last updated:** 2026-09-02

## The short version

This extension makes no network requests. Nothing about what you see on X — no post text, no ad
content, no counts, nothing — is ever sent anywhere, because there is nowhere for it to be sent: no
server, no account, no X API key, and no analytics service behind this product.

## What this extension actually does

It hides or shows a handful of things X has already rendered into the page you're looking at,
driven by five on/off switches you control from the toolbar popup:

- Defaults the home timeline to chronological Following instead of For You
- Hides promoted/ad posts
- Hides "Who to follow", trends and similar algorithmic sidebar modules
- Hides like/repost/view counts under a post (the buttons themselves stay fully usable)
- Widens the reading column and mutes non-essential chrome in focus mode

That's the whole product. Nothing is extracted, read, or remembered about any specific post, ad, or
account — a hidden ad leaves no trace anywhere the instant it's off-screen.

## What is stored, and where

Everything is stored in your browser's own local storage (`chrome.storage.local`) on this device:

| Data | Why |
| :-- | :-- |
| Your five toggle settings (on/off) | So they persist between visits and browser restarts |
| Anonymous usage counters (which toggles have been turned on/off, how many sessions, how many times the popup was opened) | So the developer can see which features are used, and whether X's layout has changed under the extension |

The usage counters contain no post text, no ad content, no counts, no post ids and no account
identifiers of any kind — only toggle names, totals, and how many times a session started. They stay
on your device like everything else, and you can read them and reset them at any time from the
popup's "Local usage counters" section.

## What is never stored

Post content, ad content, sidebar module content, and the actual like/repost/view numbers themselves
are never read, extracted, or written to storage — this extension only ever asks "does this rendered
node match one of the five patterns I'm told to hide right now", and the answer is a CSS class, not a
saved record.

No account, email address or name. No browsing history. No advertising or tracking identifiers.
Nothing is sold, shared or transmitted, because nothing is transmitted at all.

## Permissions, and what each is for

| Permission | Why it is needed |
| :-- | :-- |
| `storage` | Saving your five toggle settings and the local usage counters described above, on this device only. |
| `*://*.x.com/*`, `*://*.twitter.com/*` | Reading and hiding rendered content on the two domains X currently resolves on, so the toggles can take effect there. This grants no ability to send anything anywhere — no code in this extension opens a network connection. |

**Not requested:** `activeTab`, `tabs`, `scripting`, `downloads`. There is no export feature in this
product — five toggles and two small counters aren't meaningfully exportable content — so there is
nothing for a `downloads` permission to do, and no code path anywhere that calls it.

## Your data is yours

The popup's **Your data** section: **Reset to defaults** clears your stored toggle settings entirely
(the next time the extension reads them, they fall back to the shipped declutter-first defaults).
**Reset counters** clears the local usage counters separately. Because storage is local and
per-device, uninstalling the extension or clearing your browser data removes everything this
extension has ever stored.

## Verifying this yourself

Open devtools on x.com with the extension active and watch the Network tab — you will see no requests
from the extension. The source is auditable: no `fetch`, `XMLHttpRequest`, `WebSocket` or
`sendBeacon` call exists anywhere in it, and the project's own test suite (`npm test`) fails the build
if any of those four calls are ever introduced.

## Read-only, always

This extension never posts, likes, reposts, replies, follows, mutes or blocks on your behalf. The one
interaction it performs — clicking X's own "Following" tab control when the "Default to Following"
toggle is on — is a plain UI navigation, identical to what happens when you click that tab yourself.
It makes no API call and changes nothing about your account or your data on X's servers.

## Contact

Questions about this policy: raise an issue on the extension's support page.
