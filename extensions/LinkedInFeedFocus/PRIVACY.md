# Privacy Policy — LinkedIn Feed Focus & Algorithm Control

**Last updated:** 2026-09-02

## Short version

This extension hides things on LinkedIn's own feed. It does not read your data, store your data, or
send anything anywhere. There is no account, no server, and no network request of any kind, anywhere
in the code.

## What this extension stores

Six on/off switches, and nothing else:

- Hide promoted posts
- Hide "People you may know" / suggestion modules
- Hide trending news
- Hide suggested/algorithmic posts
- Hide reaction counts
- Focus mode

These are stored in `chrome.storage.local` — a small file inside your own browser profile, on your
own device. They are never transmitted anywhere, they never leave your device, and uninstalling the
extension deletes them along with everything else the browser cleans up on uninstall.

## What this extension reads

To decide what to hide, the content script reads short pieces of text already visible on the page
you're looking at — a heading like "People you may know", a small "Promoted" label, a timestamp
annotation like "2h" or "Suggested". This is read from the page in memory, used immediately to decide
whether to hide the element it came from, and then discarded. None of it is written to storage,
logged, or sent anywhere. This extension does not read your profile, your connections, your messages,
or the content of any post beyond the few-word labels described above.

## What this extension will never do

- **No account, no sign-in, ever.**
- **No backend, no server, no API keys.** Everything runs entirely inside your browser.
- **No network requests of any kind.** No `fetch`, no `XMLHttpRequest`, no beacons, no WebSockets —
  anywhere in the source. `scripts/selftest.mjs` enforces this with an automated grep on every build,
  not just a claim in this document.
- **No write actions against LinkedIn.** This extension never posts, likes, follows, connects,
  comments, or sends a message on your behalf. The only thing it ever changes on the page is whether
  an element is visible — every hide is instantly reversible by flipping the toggle back.
- **No analytics, no telemetry, no crash reporting, no third-party scripts.**
- **No tracking of who you are, what you look at, or what you hide.** There is no per-post record of
  any kind — a hidden post leaves no trace anywhere once it's off-screen.

## Permissions this extension requests, and why

| Permission | Why |
| :-- | :-- |
| `storage` | To remember your six toggle choices between sessions |
| Host access to `*://*.linkedin.com/*` | To run the content script that hides feed elements on LinkedIn's own pages |

**Not requested:** `activeTab`, `tabs`, `scripting`, `downloads`, `sidePanel`, or host access to any
site other than LinkedIn. There is nothing in this codebase that would use any of them.

## Data ownership

Your six toggle settings are yours. "Reset to defaults" in the popup clears them back to the
extension's shipped defaults at any time — no confirmation dialog needed, since there is nothing
irreversible about it (no saved content, no history to lose).

## Changes to this policy

If this extension's scope ever changes in a way that affects this policy, this file will be updated
and the version bumped in `package.json` and the Web Store listing.

## Contact

Questions about this policy or the extension's behavior: see the Web Store listing's support contact.
