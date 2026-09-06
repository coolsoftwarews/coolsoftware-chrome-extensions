# Privacy Policy — YouTube Focus Timer

**Last updated:** 2026-09-02

## The short version

This extension makes no network requests. There is no server, no account and no analytics service
behind it — nowhere for your data to be sent, including the timer data this product is built around.
That is true even though this product's whole purpose is measuring your own usage: the measurement
itself never leaves your device.

## What is stored, and where

Everything lives in your browser's own local storage (`chrome.storage.local`), on this device only:

| Data | Why |
| :-- | :-- |
| Your five hide-toggle settings and reminder threshold | So they persist between browser sessions |
| Daily totals of time spent on YouTube (minutes per calendar day, last 90 days) | This is the report — the entire product |
| A single internal timestamp ("session cursor") | Bookkeeping for the timer's own accumulation logic; not a log of what you watched |
| Anonymous local usage counters (e.g. "dashboard opened: 12") | So the developer can see which features are used, from this device only |

The daily totals are **minutes per day, nothing more** — no timestamps of individual videos watched,
no video IDs, no titles, no search history, no watch history. The usage counters are just totals; they
never record a URL, a video title, or anything that identifies what you watched.

## What is never collected

No account, email address or name. No browsing history. No video titles, video IDs, channel names or
search queries — the timer only ever knows "a YouTube tab was focused for N seconds," never *which*
video. No advertising or tracking identifiers. Nothing is sold, shared or transmitted, because nothing
is transmitted at all.

## How the timer actually works (so you can verify the claim above)

A YouTube tab is "being watched" when it is both visible and has OS-level window focus. While that's
true, the tab's content script holds open a connection (`chrome.runtime.connect`) to this extension's
own background service worker — nothing more than a same-extension message channel, it never leaves
the browser. The service worker adds up elapsed wall-clock time in 5-second steps and writes only a
running total of *minutes per day* to local storage. It never records what the tab's URL was, what
video was open, or anything about the page's content. Closing the tab, switching away, or losing window
focus closes that connection and the counting stops immediately.

## Permissions, and what each is for

| Permission | Why it is needed |
| :-- | :-- |
| `storage` | Saving your settings and the local daily-totals report |
| `downloads` | Writing the CSV session-history export and the JSON backup you explicitly request |
| Host access to `*://*.youtube.com/*` | This is a YouTube-only extension; the hide toggles and the timer only run on YouTube pages. No other site is ever touched |

Not requested, and not needed by any code path in this extension: `tabs`, `activeTab`, `scripting`,
`sidePanel`, any OAuth/identity permission, or any host permission beyond YouTube itself.

## Your data is yours

The popup's **Data** sheet lets you **export all data** (a JSON backup of your settings and daily
totals), **import** it back on this or another machine, and **clear all data** immediately and
permanently. A separate **Export CSV** button writes the last 90 days of daily totals as a plain CSV
file — the format your stopwatch-style report is checkable in, outside this extension entirely.

Because storage is local and per-device, uninstalling the extension or clearing your browser's site
data removes your report. Export a backup first if you want to keep it.

## Verifying this yourself

Open devtools on any YouTube tab with the extension active and watch the Network tab — you will see no
requests from this extension. The source is auditable and small: `grep -rn "fetch(\|XMLHttpRequest(\|sendBeacon(\|new WebSocket(" src/`
returns nothing, and `scripts/selftest.mjs` enforces that same check on every run so it can never
regress silently.

## Contact

Questions about this policy: raise an issue on the extension's support page.
