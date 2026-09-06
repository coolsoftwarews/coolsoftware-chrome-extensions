# X Feed Declutter & Focus

Chrome MV3 extension. Forces X's home timeline back to plain chronological Following, hides
promoted/ad posts, hides algorithmic "Who to follow"/trends sidebar modules, optionally hides
like/repost/view counts, and offers a distraction-light focus-mode reading layout. Five toggles, one
popup, no settings maze. No account, no X API, no network requests.

Built from [PRD-24](../../docs/extensions/PRD-24-x-feed-declutter.md). See
[docs/extensions/README.md](../../docs/extensions/README.md) for the hard constraints
every extension in this portfolio follows (no sign-in, no payments, no backend, local storage only,
read-only on the platform, foreground only, minimum permissions, local-only instrumentation).

## Quick start

```bash
npm install
npm run icons          # regenerate src/icons/*.png (no image dependency)
npm run build           # dev build into dist/
npm run build:watch     # rebuild on change
npm run build:prod      # minified, production manifest name
npm test                # headless checks — toggle logic, Following-tab decision, no-network guard
npm run typecheck
npm run zip              # production build + dist/ packed for the Web Store
```

Node 18+ is required.

Load it: `chrome://extensions` → Developer mode → **Load unpacked** → select `dist/`.

## How it works

| File | Job |
| :-- | :-- |
| `src/types.ts` | Shared shapes: the five `ToggleKey`s, `DEFAULT_TOGGLES`, per-toggle label/help copy, and the local-metrics shape. Pure. |
| `src/rules.ts` | The pure decision core: `shouldHideNode()` (does this toggle hide this kind of already-rendered node), `shouldForceFollowingTab()`, `activeToggleCount()`, `changedToggles()`. No DOM, no `chrome.*` — fully unit-tested. |
| `src/selectors.ts` | Every assumption about X's DOM, isolated to one file (see below). Returns `null`/`[]` rather than throwing. |
| `src/content.ts` | Orchestration — reads toggles, scans the currently-rendered DOM once per animation frame, calls `shouldHideNode()`/`shouldForceFollowingTab()` from `rules.ts` for every decision, watches for SPA navigation and infinite scroll. |
| `src/content.css` | The two classes every hide operation uses (`.xfd-hidden`, `html.xfd-focus-mode`) plus focus mode's column-width/dim CSS. |
| `src/background.ts` | Service worker. Minimal — this product has no export feature (no `downloads` permission), so its only job is seeding default toggles on install. |
| `src/storage.ts` | `chrome.storage.local`: the five toggles, local usage counters (`clearToggles`/`clearMetrics` for data ownership — see below). |
| `src/popup.ts` / `.html` / `.css` | The toolbar popup — five toggle switches, an "N of 5 active" line, and the data-ownership controls. |

### The five toggles, exactly

```
[x] Default to Following        — switches home timeline off For You
[x] Hide promoted posts         — removes ads from timeline + search
[x] Hide sidebar suggestions    — removes Who to follow / trends modules
[x] Hide like/repost/view counts — hides the numbers, not the buttons
[ ] Focus mode                  — widens the reading column, dims chrome
```

`focusMode` starts off; the other four start on (PRD §4/§10 — declutter-first defaults, focus mode is
a bigger first-run surprise since it changes layout, not just removes noise).

### Reading X's DOM without an API (PRD §5, the gate)

There is no X API call anywhere in this extension, and no scraping either — this product doesn't
*read* anything about a post beyond "what kind of thing is this node" (an ad? a sidebar module? a
count?), and nothing about what's found is ever written to storage. A hidden ad post leaves no trace
anywhere the moment it's off-screen.

- **Ads** are detected by X's own promoted-post marker plus a short-text-node scan for the literal
  word "Ad"/"Promoted" near a post's header (bounded to the first 20 short spans, so a post whose
  *body* happens to contain a two-letter word is never misclassified).
- **Sidebar modules** are found by matching a heading's own text against a known list ("Who to
  follow", "Trends for you", "What's happening", etc.) and climbing a bounded number of ancestor
  levels to the card that owns that heading.
- **Vanity counts** are hidden as the small numeric span inside each action button — never the button
  itself, so reply/repost/like/bookmark controls stay fully clickable and functional.
- **The Following default** works by clicking X's own Following tab control — a plain UI navigation,
  the same thing that happens when a user clicks that tab themselves. No API call, no change to the
  user's account or data. It only fires on the home timeline path, and only when the currently active
  tab can be read with confidence — if the active tab can't be determined, nothing is clicked (PRD §5:
  never guess).

X ships DOM changes constantly with no deprecation courtesy. Every selector lives in
`src/selectors.ts` and returns `null`/`[]` rather than throwing. Critically, **nothing in this
extension ever removes or rewrites a node's structure** — every hide operation is a `classList.toggle`
on a node `selectors.ts` already found, so a wrong or stale selector can, at worst, leave something
visible that should have been hidden. It can never break the timeline.

**This module (`selectors.ts`) could not be verified against a live, logged-in X session in this
build environment.** Every selector is a best-effort reading of X's `data-testid`/ARIA conventions,
consistent with the same conventions already used (and documented as unverified-until-live-tested) in
this portfolio's `XVelocityFinder`. Run the manual checklist below before shipping.

## Privacy

No `fetch`, no `XMLHttpRequest`, no `sendBeacon`, no `WebSocket` — verifiable with
`grep -rn "fetch(" src/` (and the equivalent for the other three) and in devtools' Network tab; also
enforced by `scripts/selftest.mjs`'s no-network-calls guard, which fails the build if any of those four
calls appear anywhere in `src/*.ts`. The five toggles and two small local counters live in
`chrome.storage.local` and are never transmitted. See [PRIVACY.md](PRIVACY.md).

## Manual test checklist

The DOM-bound half needs a real, logged-in X session — headless checks cover the toggle logic, not the
markup.

- [ ] Home timeline defaults to Following on load, when the toggle is on
- [ ] Switching the timeline back to For You by hand, then reloading — it returns to Following
- [ ] Turning the "Default to Following" toggle off leaves For You alone
- [ ] A promoted/ad post on the home timeline is hidden when "Hide promoted posts" is on, and
      reappears immediately when the toggle is switched off (no reload needed)
- [ ] A promoted/ad post in search results is hidden the same way
- [ ] The "Who to follow" and trends sidebar modules disappear when "Hide sidebar suggestions" is on
- [ ] Like/repost/view counts disappear under a post when "Hide like/repost/view counts" is on, and
      the reply/repost/like buttons themselves remain fully clickable
- [ ] Focus mode widens the reading column and dims the sidebar; hovering/focusing the sidebar
      restores full opacity
- [ ] Infinite scroll: newly-loaded posts get the same treatment as the ones already on screen, with
      no visible flash of an ad or a count before it's hidden
- [ ] Flipping a toggle in the popup takes effect on the open X tab within ~200ms, no reload needed
- [ ] Logged-out browsing: no crash, no broken layout; features that depend on a tab bar (the
      Following default) simply do nothing
- [ ] `twitter.com` URLs behave identically to `x.com`
- [ ] A narrow/mobile-web-style browser window: no broken layout, no mis-hidden content
- [ ] Dark, dim and light X themes: focus mode and hidden states look correct in all three

## Known limits

- Ad detection is a text-marker heuristic, not a guarantee — a promoted post that ships with none of
  the known markers is shown, not guessed at (PRD §7 explicitly rules out content-based ad detection).
- The sidebar-module heading list is a fixed set of known English strings; a differently-localized
  account, or a module X ships under a new heading, won't be recognized until the list is updated.
- The Following-tab click is a best-effort DOM interaction. If X restructures its tab bar, this
  feature quietly stops working rather than clicking the wrong thing — check whether "Default to
  Following" still holds after any visible X redesign.
- No cross-device sync — toggle preferences are per-browser-profile, by design (no account, ever).
