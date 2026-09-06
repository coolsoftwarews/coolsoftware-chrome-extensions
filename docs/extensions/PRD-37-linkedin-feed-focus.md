# PRD — LinkedIn Feed Focus & Algorithm Control

**Status:** Draft for build
**Owner:** Gabriel
**Date:** 2026-09-02
**Type:** Chrome extension (MV3), standalone Web Store listing
**Platform:** LinkedIn
**Backend:** None · **Accounts:** None · **Payments:** None

---

## 1. One-line proposition

Turn LinkedIn's feed back into a plain, chronological-feeling read — hide the ads, the suggestion modules, the trending noise and (optionally) the reaction counts, in one popup with a handful of toggles.

## 2. The hypothesis

**Does the proven appetite for feed-control tools exist on LinkedIn, or does it stop at X and YouTube?** On X, "Control Panel for Twitter" and "Minimal Theme for Twitter/X" are top-ranking, no-signup extensions whose entire pitch is DOM-level feed decluttering, and whose entire trust story is "we collect nothing." On YouTube, "Unhook" does the same job for a video feed and sits at roughly 1M users and a 4.86-star rating. Both are proof that a large, no-friction audience exists for a tool that does nothing but hide what a platform's own feed algorithm inserts.

Current market research on LinkedIn extensions found **nothing in this category at all**. Every LinkedIn extension in the current rankings is a sales/CRM tool, a writing assistant, or an automation tool aimed at outbound — not one is a plain feed-control/declutter tool. That is a real gap, not a saturated niche with no market: LinkedIn arguably has *more* reason to want this than X or YouTube does. Its feed mixes "Promoted" posts, "People you may know" and "Add to your feed" suggestion modules, a trending-news rail, and reaction counts that are explicitly designed to trigger social comparison, all inside a feed users often open for a specific professional purpose (checking in on their network) rather than open-ended browsing. The hypothesis: the same proven appetite for feed control exists here, unclaimed, and a straightforward port of the X/YouTube pattern — read-only DOM hiding, no signup, "we collect nothing" — is enough to test it cheaply.

If this converts even at the lower end of what the X/YouTube comparables show, it's evidence that "feed control" is a durable problem class across platforms, not a fluke of any one site's user base — a distinct finding from this portfolio's intelligence-vs-workflow question, worth tracking as its own category (see also PRD-24's X sibling, which is testing the same question from the "combined declutter tool" packaging angle).

## 3. Target user

| Segment | Job |
| :-- | :-- |
| Professionals who open LinkedIn for a specific reason | "Let me see my network's actual posts, not what LinkedIn wants me to see" |
| Job seekers / networkers | Want to browse without the ad noise and the "People you may know" pressure |
| Writers / researchers who use LinkedIn as a reading source | Need a plain, undistracted feed to read and think in, not an engagement feed |
| Anyone who finds reaction counts anxiety-inducing | Wants to read a post on its own merits, not its like count |

## 4. Scope — V1

### In scope

**Six independent toggles, one popup, no settings maze.**

- **Hide promoted / sponsored posts.** Remove posts LinkedIn marks "Promoted" from the feed.
- **Hide "People you may know" / "Add to your feed" suggestion modules.** Removed, not just dimmed — the reading column reclaims the space.
- **Hide reaction/like counts.** A toggle, not a default-on assumption — some users read counts as signal, others find them anxiety-inducing rather than useful. Off by default; comment/repost counts and the Like/Comment/Repost/Send action buttons themselves are never touched, since this extension never limits what a user can *do*, only what is shown.
- **Hide "Trending now" / news module.** Removes LinkedIn's own trending/news rail module.
- **Hide suggested/algorithmic posts.** Favors a feed of people the user actually follows, by hiding posts LinkedIn's own DOM marks as algorithmic picks from accounts the user doesn't follow (`Suggested`, `Because you follow X`, and similar labels), wherever LinkedIn's markup makes that detectable. This is a best-effort chronological-*feeling* feed, not a guarantee — LinkedIn exposes no explicit "this post came from the algorithm, not from someone you follow" flag the way it exposes a "Promoted" label, so this feature is honestly the least certain of the six and is documented as such.
- **Focus mode.** A single toggle that widens the reading column and mutes non-essential chrome for a calmer reading layout. Purely cosmetic (CSS-level), instantly reversible, and never removes anything the other five toggles don't already cover.

Each toggle is independent, defaults are conservative (declutter toggles default on; hiding reaction counts and focus mode default off, since both are more likely to surprise a first-time user than removing ads is), and there is exactly one panel — the toolbar popup — with no nested menus and no onboarding flow.

### Explicitly out of scope for V1

No AI, no automation, no write actions of any kind against LinkedIn — no posting, liking, following, connecting, commenting or messaging. No account, no backend, no LinkedIn API. No per-post allowlisting or rules; toggles apply to the whole feed. No cross-device sync (that needs an account, which this product will never have). No custom theming beyond the focus-mode width/chrome adjustments named above. No notification or messaging changes of any kind.

## 5. Where the data comes from — read before committing

This extension reads nothing and stores nothing about what the user sees. It purely hides DOM nodes LinkedIn has already rendered into the current tab, driven entirely by the six stored toggle values. There is no scraping, no extraction, no per-post record of any kind — a hidden post leaves no trace anywhere once it's off-screen. The only things ever written to storage are the six toggle states themselves.

**LinkedIn's feed DOM carries a higher-than-usual fragility risk.** LinkedIn's markup is deliberately unfriendly to automation, heavily class-obfuscated, and — critically for this product specifically — its component nesting is noticeably deeper and more heavily wrapped than either X's or YouTube's feed markup (multiple nested `update-components-*` wrapper layers per post, versus X's flatter `article[role="article"]` cells or YouTube's single-level renderer components). That makes "find the right node to hide" a harder and more failure-prone problem here than it was for the X sibling in this same batch. Two rules follow directly from that, both non-negotiable:

1. **Selectors must degrade to "hide nothing," never to "break the page."** A selector that stops matching should silently do nothing — never throw, never partially remove a node's children, never leave a post's outer shell present with its inner content stripped. Every hide operation for every one of the six features is wrapped so one failing selector cannot take down the other five.
2. **A documented manual test checklist stands in for automated DOM testing.** Nothing that touches the live feed DOM is unit-testable in the normal sense — it depends on a real, logged-in LinkedIn session. The classification logic (given a short label string, which feature does it belong to, and does the relevant toggle say to hide it) is fully unit-tested as a pure module with no DOM access at all; the DOM-matching behavior that finds those label strings on the live page is a named, versioned checklist item in the README that must be re-run by hand before every release and whenever LinkedIn visibly changes its feed layout.

**Spike first, 1 day:** confirm that promoted posts, the suggestion modules, the trending module, an algorithmic-post signal and the reaction-count element are each identifiable via a stable marker on the home feed — logged in, on both a fresh account and an established one (suggestion modules may not render identically for both). If any one of the five cannot be reliably identified without also catching real content, that toggle ships behind an explicit "may be imperfect" note in the popup rather than as a confident claim.

## 6. Non-functional requirements

| Requirement | Target |
| :-- | :-- |
| Toggle applied to visible feed | < 200 ms after a toggle flips, no visible flash of the old state |
| Applied on scroll / infinite load | New posts arriving are covered within one animation frame — nothing hidden flashes in before being hidden |
| No layout shift | Hiding a post or a module must not cause the remaining content to visibly jump; collapse cleanly, no reserved blank space |
| Permissions | `storage` + host permission `*://*.linkedin.com/*`. Nothing broader — no `activeTab`, no `downloads`, no `sidePanel`, no `scripting` |
| Privacy | No network requests, anywhere in the codebase — verifiable in devtools and by reading the source |
| Safety | Zero write actions against LinkedIn, enforced by having no such code path anywhere in the extension |
| Failure mode | If a selector stops matching, that one feature quietly stops hiding anything; the feed itself is never broken, and no other feature is affected |

## 7. Edge cases

- **LinkedIn's own A/B-tested UI variants.** Different users may see different DOM structures for the same feature at the same time (LinkedIn runs its own layout experiments) — every selector is written defensively with more than one candidate match where feasible, and a variant that matches none of them degrades to "hide nothing" for that user rather than mis-hiding unrelated content.
- **The mobile-responsive layout leaking through on a resized browser window.** LinkedIn can serve a narrower, mobile-styled feed layout inside a resized desktop window; selectors are checked against both layouts where they diverge, and a feature that can't find its marker in either simply does nothing.
- **A user wanting only some toggles active.** The whole point of six independent toggles rather than one master switch — a user who wants ads gone but wants to keep seeing suggestion modules must be fully supported, not a compromise.
- **LinkedIn's frequent redesigns breaking selectors silently.** The one certainty about this product's lifetime is that LinkedIn will change its markup without notice. Every selector lives in one isolated classification/extraction module so a redesign is a scoped fix, not a rewrite, and the failure mode (§5, §6) means a broken selector degrades quietly rather than breaking the feed.
- **A promoted or suggested post with no distinguishing marker.** If LinkedIn ships one without any of the known markers, it is shown, not guessed at — this extension does not attempt content-based classification (keyword sniffing on post text) that could misclassify a real post from a real connection.

## 8. Success metrics (30 / 90 day)

| Metric | 30d | 90d |
| :-- | :-- | :-- |
| Installs | 150 | 1,500 |
| 7-day retention | 30% | 40% |
| Users with ≥ 3 toggles active | 40% | 55% |
| Users who ever flip a toggle off (proof the granularity is used) | 15% | 25% |
| Store rating | ≥ 4.2 | ≥ 4.4 |

## 9. Kill criteria

Under 250 installs at 90 days with real distribution effort, **or** 7-day retention under 25% at 90 days. Retention is the sharper signal here specifically: a decline in a feed-hiding tool almost always means a selector broke silently rather than the proposition being wrong, so a retention failure should trigger a selector audit before it triggers a kill decision.

## 10. Open questions

- **Is the market gap real, or just under-indexed in current search results?** The research finding ("nothing in this category on LinkedIn today") is the whole basis for the hypothesis in §2 — worth re-checking at launch time in case a competitor ships in the gap between this PRD and release.
- **Reaction-count default.** Defaulting hide-reaction-counts to off (unlike X's sibling PRD-24, which defaults its vanity-count hide to on) is a judgment call reflecting that LinkedIn's counts are more often read as professional credibility signal than X's are. Worth watching the 30-day toggle-on rate for this one specifically before assuming the default is right.
- **Is the "algorithmic posts" toggle honest enough to ship as a named feature, or should it launch as a quieter beta-labelled toggle given §5's own admission that LinkedIn exposes no explicit flag for it?** If the spike in §5 can't find a reliable signal, downgrade this toggle's copy in the popup rather than removing it outright — a toggle that sometimes helps is still more honest than one that's silently a no-op with no visible caveat.
