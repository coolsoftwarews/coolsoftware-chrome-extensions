# Chrome Web Store listing — X Feed Declutter & Focus

## Name

`X Feed Declutter & Focus`

## Single-purpose sentence

Forces X back to a plain, chronological, ad-free feed — default to Following, hide promoted posts,
hide algorithmic sidebar modules, optionally hide vanity counts, and a calmer reading layout — reading
only what's already on the page, with no account and no network requests.

## Short description (132 char max)

`A calmer X: chronological feed, no ads, no algorithmic sidebar, optional no counts. No account, no network requests.`

## Category

Productivity → Workflow & Planning (alt: Social & Communication)

## Detailed description

**X shows you an algorithm. This shows you your feed.**

X defaults to "For You" every session, inserts ads into your timeline, and fills your sidebar with
"Who to follow" and trending modules you never asked for. X Feed Declutter & Focus turns all of that
off, with one popup and five switches:

```
[x] Default to Following        — chronological, not algorithmic
[x] Hide promoted posts         — no ads in your timeline or search
[x] Hide sidebar suggestions    — no "Who to follow", no trends
[x] Hide like/repost/view counts — read a post on its own merits
[ ] Focus mode                  — a wider column, quieter chrome
```

**One tool instead of three**

The best declutter extensions for X today each do one of these things well — a chronological-feed
tool, an ad blocker, a vanity-count hider. This combines them into one coherent panel, so you install
one thing and grant one set of permissions instead of three.

**Every toggle is independent**

Want ads gone but you still like seeing view counts? Turn off just that one switch. Nothing here is
all-or-nothing, and nothing is ever hidden without a way to turn it back on instantly.

**No account. No X API. No network requests.**

This reads and hides only what's already rendered on the page you're looking at. There is no server
behind it, no key to configure, and no cost to run — verify that yourself in devtools' Network tab in
about ten seconds.

**Built for**

Anyone trying to cut doomscrolling and read a plain, undistracted timeline. Writers and researchers
who want to think, not be engaged. Privacy-minded users who want an honest, checkable "we collect
nothing" claim, not just a promise.

**Read-only, always**

This extension never posts, likes, reposts, replies, follows, mutes or blocks on your behalf. It only
hides and shows what's already on the page.

## Permission justifications (for review)

| Permission | Justification |
| :-- | :-- |
| `storage` | Persisting the user's five toggle settings and small local usage counters — all on-device, none transmitted. |
| `*://*.x.com/*`, `*://*.twitter.com/*` host access | The extension's core function is hiding/showing content already rendered in the user's own X timeline, search results and sidebar, on both domains X currently resolves on. No other site is touched, and no network request is made to either domain — the extension only reads and toggles the DOM the browser already loaded. |

**Not requested:** `activeTab`, `tabs`, `scripting`, `downloads` — there is no export feature in this
product, and no code path anywhere that calls any of these APIs.

**Remote code:** none. All code is bundled in the package; no eval, no remote scripts.
**Data usage disclosures:** none of the categories apply — no data is collected or transmitted
off-device.

## Screenshots (1280×800)

1. A cluttered X home timeline (For You, ads, sidebar suggestions, counts) beside the same timeline
   with all five toggles on
2. The popup, showing the five switches and the "N of 5 active" line
3. Focus mode: the widened reading column with a dimmed sidebar
4. A close-up of a post before/after "Hide like/repost/view counts", showing the reply/repost/like
   buttons still fully usable
5. The popup's "Your data" section (reset to defaults / reset counters) and local usage counters

## Support and privacy links

- Privacy policy: publish [PRIVACY.md](PRIVACY.md) at a stable URL
- Support: repository issues page
