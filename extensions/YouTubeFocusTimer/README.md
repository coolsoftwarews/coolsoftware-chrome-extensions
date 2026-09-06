# YouTube Focus Timer

Chrome MV3 extension. Hide YouTube's recommendations sidebar, homepage feed, Shorts, end-screen
suggestions and comments — each independently toggleable — and see an honest, fully local report of
how much time you've actually spent on YouTube today and this week. No account, no backend, no
network requests.

Built from [PRD-32](../../docs/extensions/PRD-32-youtube-focus-timer.md) ("YouTube
Distraction Timer & Session Report"). Shipped under the shorter working name **YouTube Focus Timer**;
see the PRD's own §10 for the naming note.

## Quick start

```bash
npm install
npm run icons          # regenerate src/icons/*.png (no image dependency)
npm run build           # dev build into dist/
npm run build:watch     # rebuild on change
npm run build:prod      # minified, production manifest name
npm test                # headless checks — day-splitting, session accumulation, exports, filenames
npm run typecheck
npm run zip              # production build + dist/ packed for the Web Store
```

Node 18+ is required. Load it: `chrome://extensions` → Developer mode → **Load unpacked** → select
`dist/`.

## How it works

| File | Job |
| :-- | :-- |
| `src/time.ts` | Pure date/day-splitting math — local date keys, midnight-rollover splitting, duration formatting. No `toLocaleString()`/`toLocaleDateString()` anywhere (locale-unstable, see the portfolio's own lesson on this) |
| `src/session.ts` | The whole multi-tab-dedup mechanism: a pure `accumulate(lastTickAt, now)` reducer that advances a single shared cursor by wall-clock elapsed time |
| `src/aggregate.ts` | Daily-totals bucket math — add, sum a date range, prune old days |
| `src/csv.ts` | Session-history CSV + filename builder |
| `src/settings.ts` | Default toggle/reminder state + forward-compatible merge |
| `src/storage.ts` | `chrome.storage.local` wrapper: settings, daily totals, the session cursor, local usage counters, export/import/clear-all backup |
| `src/background.ts` | Service worker — the single writer of the session cursor (see below) |
| `src/content.ts` | Applies the hide toggles as `<html>` data attributes, tracks this tab's watch state, shows the gentle reminder banner |
| `src/content.css` | Declarative attribute-selector hiding rules, loaded before first paint |
| `src/popup.ts`/`popup.html`/`popup.css` | The dashboard: today/week totals, 7-day chart, toggles, reminder select, data/usage sheets |

### Why there's a background service worker at all

Every other popup-only extension in this portfolio skips a background script entirely when nothing
needs `chrome.downloads` from a content script. This one still needs one, for a different reason:
**the session timer's multi-tab dedup.** If every tab's content script independently read-modified-
wrote a shared "last accounted for" timestamp in `chrome.storage.local`, two tabs both watching at once
could race and double-credit a heartbeat. Routing every tick through exactly one service-worker
instance (`background.ts`) makes the cursor single-writer — no race is possible, because nothing else
ever writes it.

The service worker only runs its 5-second tick interval while at least one YouTube tab has an open
`chrome.runtime.connect` port — which only happens while that tab is actively watched (visible **and**
focused, PRD §5). It never polls, wakes up unprompted, or makes a network request. See
[PRIVACY.md](PRIVACY.md).

### The session timer, precisely

"Watching" = `document.visibilityState === 'visible' && document.hasFocus()`. Not "tab is open" — a
YouTube tab open in the background, or visible but not the focused window, does not count. This is
tracked entirely off `visibilitychange`/`focus`/`blur` events on the existing document, with no
dependency on page-load events at all, because YouTube is a single-page app and there is no full page
reload between videos. As a side effect, the DOM-hiding toggles also survive YouTube's own in-app
navigation for free — they're a persistent attribute on `<html>`, not something re-applied per page.

A heartbeat gap longer than 15 seconds (three missed 5-second heartbeats) is treated as "not actually
watched" and discarded, not credited — this is what stops a laptop sleep/lid-close from silently
becoming YouTube time in the report (PRD §7).

### The hide toggles

Each of the five toggles sets one `data-ft-hide-*` attribute on `<html>` (`content.ts`); `content.css`
does the actual hiding via attribute selectors, loaded at `document_start` so there's no flash of the
surface about to be hidden. **The selectors in `content.css` were written against YouTube's current
known DOM shape but were not verified against a live page in this build environment** — same honesty
note as several other extensions in this portfolio whose build environment has no live access to the
target platform. Verify each selector against a real YouTube session before shipping; if a selector
has drifted, that toggle simply hides nothing (fails soft) rather than breaking the rest of the page.

## Manual test checklist

The DOM-bound half (`content.ts`'s selectors, the reminder banner's on-page appearance) needs a real
browser and a real YouTube session:

- [ ] Each of the five hide toggles, independently, on the watch page, homepage, and `/shorts`
- [ ] Toggling a checkbox in the popup updates the currently-open YouTube tab immediately (no reload)
- [ ] Open two YouTube tabs, both focused/blurred at different times — confirm `dist` totals only
      ever advance at real wall-clock speed, never faster (the multi-tab dedup, PRD §7)
- [ ] Switch away from a YouTube tab (another app, another window) — confirm the timer pauses
- [ ] Put the laptop to sleep mid-session, wake it up — confirm the sleep gap is not credited
- [ ] Leave a tab focused past the reminder threshold — banner appears once, is dismissible, never
      blocks the page, disappears on its own after 15s if ignored
- [ ] Popup dashboard: today/week totals and the 7-day chart match what a stopwatch would show
- [ ] Data sheet: export CSV, export JSON backup, import it back, clear all — each in order
- [ ] Usage sheet: counters increment as expected, reset works

## Known limits / open questions

See PRD §10 in full. The two worth restating here:

- **Picture-in-picture is not currently counted** once the main tab loses focus, even if the video
  keeps playing in a PiP window. Deliberately left unresolved rather than guessed at — see the PRD.
- **The timer does not check whether a video is actually playing** — a focused, visible, paused
  YouTube tab still counts as "on YouTube." This matches the PRD's own definition (§5) but is worth
  watching for user feedback that expects otherwise.

## Privacy

No `fetch`, no `XMLHttpRequest`, no `sendBeacon`, no `WebSocket` — anywhere in `src/`, enforced by
`scripts/selftest.mjs` as well as documented. All data — settings, daily totals, the session cursor,
local usage counters — lives in `chrome.storage.local` and is never transmitted. See
[PRIVACY.md](PRIVACY.md).
