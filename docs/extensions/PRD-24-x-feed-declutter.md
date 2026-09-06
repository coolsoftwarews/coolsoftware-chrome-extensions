# PRD — X Feed Declutter & Focus

**Status:** Draft for build
**Owner:** Gabriel
**Date:** 2026-09-02
**Type:** Chrome extension (MV3), standalone Web Store listing
**Platform:** X (Twitter)
**Backend:** None · **Accounts:** None · **Payments:** None

---

## 1. One-line proposition

Force X back into a plain, chronological, ad-free, distraction-light feed — one popup, a handful of toggles, nothing to configure.

## 2. The hypothesis

**Will a combined, well-designed declutter tool beat three separate single-purpose installs?** The top-ranking, no-signup X declutter extensions today are all free, single-purpose, and lead with "we collect nothing" as the entire trust pitch:

- **Minimal Theme for Twitter / X** — removes promoted posts, hides vanity counts, widens/narrows the reading column, strips sidebar clutter.
- **Control Panel for Twitter** — removes ads, view counts, and algorithmic feed content.
- **Hide X.com Ads** — free, no signup, blocks sponsored/promoted posts and in-app upsells, and states plainly that it tracks nothing.

None of these is intelligence, growth, or monetization — they're all the same problem class (visual/DOM hiding of what X already renders), shipped as narrow single-feature tools. The claim here is not a new insight; it's a packaging bet: a user who wants "chronological feed + no ads + no sidebar noise + hide counts" today has to find, install, and trust three separate extensions with three separate permission grants. One coherent tool with the same no-signup, no-network trust story, covering the union of what those three already prove people want, wins on distribution simplicity without needing a new mechanism of action.

If this converts as well as (or better than) a single-feature competitor would, the portfolio's lesson is: **packaging and coherence can be the whole product** — a distinct finding from the intelligence-vs-workflow question the rest of the portfolio is testing, worth tracking as its own category.

## 3. Target user

| Segment | Job |
| :-- | :-- |
| Heavy X users trying to cut doomscrolling | "Show me people I follow, in order, and stop showing me what X wants me to see" |
| Writers / researchers | Need a plain, undistracted timeline to read and think, not an engagement feed |
| Privacy-minded users | Want an ad/algorithm-stripping tool that makes an honest, checkable "we collect nothing" claim |
| Anyone annoyed by vanity metrics | Wants to read a post on its own merits, not its like count |

## 4. Scope — V1

### The core insight

X's own settings do not offer a persistent, one-click "just show me who I follow, in order, without ads or algorithmic modules." Getting a plain feed today means fighting the "For You" default every session, plus separately fighting ads and sidebar modules X doesn't let you turn off at all. The product is simply: default to Following, hide what X inserts that the user didn't ask to see, and offer a calmer reading layout — as one popup, not three extensions.

### In scope

**Chronological "Following" default.**
- On load, if the timeline opens to "For You," switch to "Following" automatically.
- Optionally de-emphasize the "For You" tab itself (not remove — X may re-add it on re-render, so this is cosmetic, not a hard block) so "Following" reads as the default choice.

**Hide promoted/ad posts.** Remove/collapse any post carrying X's own promoted/ad marker, from the timeline and from search results.

**Hide algorithmic sidebar modules.** "Who to follow," "Trends for you," and similar suggestion modules in the right-hand column — hidden, not just visually dimmed, so the reading column can reclaim the space.

**Hide vanity counts (toggle, off by default is a judgment call — default ON to match the "declutter" framing, but it is explicitly a toggle since some users read counts as signal).** Hides like / repost / view counts under a post; reply/bookmark controls remain untouched (this extension never limits what a user can *do*, only what's shown).

**Focus mode.** A single toggle that widens the reading column and mutes non-essential chrome (left rail icon labels, "Premium" upsell modules) for a calmer reading layout. Explicitly cosmetic — CSS-level, reversible instantly, never removes anything the other toggles don't already cover.

**Popup with per-feature toggles.** One panel, five switches (Following-by-default, hide ads, hide sidebar modules, hide vanity counts, focus mode), each independently on/off. No settings page, no nested menus, no onboarding flow.

**Local counters.** Which toggles are currently active, and a session count (sessions in which the extension was active on x.com). That is the entire local-instrumentation and local-storage story — see §5.

### Explicitly out of scope for V1

No AI, no scheduling, no bookmark management (that is a separate extension in this portfolio's plan). No posting, muting, blocking, following, liking or any other write action against X — this is purely visual/DOM hiding of what is already rendered on the page, and every hide is reversible the instant a toggle is flipped back. No cross-device sync (that needs an account, which this product will never have). No custom CSS theming beyond the focus-mode width/chrome adjustments named above — this is not a full theme engine. No per-post allowlisting or fine-grained rules; the toggles apply to the whole timeline.

## 5. Where the data comes from — read before committing

This extension reads nothing and stores nothing about what the user sees. It only hides or shows DOM nodes X has already rendered into the current tab, driven entirely by the five stored toggle values. There is no scraping, no extraction, no per-post record of any kind — a hidden ad post leaves no trace anywhere once it's off-screen. The only things ever written to storage are the toggle states themselves and the two small local counters named in §4.

The real risk here is not privacy — it's durability. X changes its DOM often and without notice, and every one of the five features depends on finding the right node to hide. Two rules follow directly from that:

1. **Selectors must degrade to "hide nothing," never to "break the page."** A selector that stops matching should silently do nothing — never throw, never partially remove a node's children, never leave an ad's outer shell present with its inner content stripped (that reads as a broken page, which is worse than a visible ad). Every hide operation is wrapped so one failing selector cannot take down the other four features.
2. **A documented manual test checklist stands in for automated DOM testing.** Nothing in `content.ts` is unit-testable in the normal sense — it depends on a live, logged-in X session. The pure logic (which toggle maps to which behavior, session counting) is unit-tested; the DOM-matching behavior itself is a named checklist item in the README that must be re-run by hand whenever X visibly changes its layout, and before every release.

**Spike first, 1 day:** confirm that ads, the "Who to follow"/trends modules, and vanity counts are each identifiable via a stable marker (X's own promoted-post indicator, a stable sidebar module heading/test id, the like/repost/view count elements) on the home timeline, a profile, and search results — logged in. If any one of the three cannot be reliably identified without also catching real content, that feature ships behind an explicit "may be imperfect" note rather than as a confident claim.

## 6. Non-functional requirements

| Requirement | Target |
| :-- | :-- |
| Toggle applied to visible timeline | < 200 ms after a toggle flips, no visible flash of the old state |
| Applied on scroll / infinite load | New posts arriving via virtualization are covered within one animation frame — no ads or vanity counts flashing in before being hidden |
| No layout shift | Hiding a sidebar module or a count must not cause the remaining content to visibly jump; collapse cleanly |
| Permissions | `storage` + host permissions `*://*.x.com/*` and `*://*.twitter.com/*`. Nothing broader — no `activeTab`, no `downloads` (there is nothing to export) |
| Privacy | No network requests, anywhere in the codebase — verifiable in devtools and by reading the source |
| Failure mode | If a selector stops matching, that one feature quietly stops hiding anything; the timeline itself is never broken, and no other feature is affected |

## 7. Edge cases

- **Logged-out browsing.** X's logged-out timeline has no "Following" tab and a different DOM shape; the chronological-default feature is a no-op there, and the other four features are checked independently against the logged-out layout.
- **X's own UI redesigns.** The one certainty about this product's lifetime is that X will change its markup. Every selector lives in one isolated module (mirroring the rest of this portfolio's pattern) so a redesign is a scoped fix, not a rewrite.
- **A user wanting only some hiding features active.** The whole point of five independent toggles rather than one master switch — a user who wants ads gone but likes seeing vanity counts must be fully supported, not a compromise.
- **Mobile-web layout leaking through.** X occasionally serves a mobile-optimized layout inside a narrow desktop window; selectors are checked against both the desktop and the mobile-web class names where they diverge, and a feature that can't find its marker in either layout simply does nothing (per §5's failure rule) rather than mis-hiding unrelated content.
- **The "For You" tab reasserting itself.** X can re-render the tab bar and reset the active tab on navigation; the chronological-default check runs on every navigation event, not just once on load, so this holds up across normal in-app browsing rather than working only on first load.
- **A promoted post with no distinguishing marker (a rare "dark pattern" case).** If X ships an ad with none of the known markers, it is shown, not guessed at — this extension does not attempt content-based ad detection (keyword sniffing, sponsor-name heuristics) that could misclassify a real post.

## 8. Success metrics (30 / 90 day)

| Metric | 30d | 90d |
| :-- | :-- | :-- |
| Installs | 200 | 2,000 |
| 7-day retention | 35% | 45% |
| Users with ≥ 3 toggles active | 40% | 55% |
| Users who ever flip a toggle off (proof the granularity is used) | 20% | 30% |
| Store rating | ≥ 4.3 | ≥ 4.5 |

Local counters only: which toggles are active at any given time, and a session count. No per-post, per-ad or per-hide-event counting — a total "N ads hidden" figure was considered and deliberately left out of V1 (see §10): it would require touching every hidden node individually, which is exactly the kind of scope creep §5's read-nothing posture is meant to prevent.

## 9. Kill criteria

Under 300 installs at 90 days with real distribution effort, **or** 7-day retention under 25% at 90 days. Retention is the sharper signal for this product specifically: a declutter tool that people install and then stop using within a week means either a selector broke silently or the packaging bet in §2 was wrong and users preferred a narrower single-feature tool after all.

## 10. Open questions

- **A "hidden count" counter.** Users of comparable tools clearly like seeing "N ads blocked" style numbers — it's a satisfying trust signal. Whether that is worth the added surface area (touching every hidden node instead of just toggling a CSS rule) is worth testing after V1 ships clean, not before.
- **Vanity-count default.** Defaulting the hide-counts toggle to ON matches this product's declutter framing, but it is also the single feature most likely to surprise a user who didn't read the popup first. Watch the 30-day toggle-off rate on this one specifically before assuming the default is right.
- **Naming vs. "Minimal"/"Control Panel"/"Hide Ads."** Those names each describe one feature; "Declutter & Focus" describes the bundle. Test whether the bundled framing reads as more valuable in the store listing, or just less specific, against real search traffic.
