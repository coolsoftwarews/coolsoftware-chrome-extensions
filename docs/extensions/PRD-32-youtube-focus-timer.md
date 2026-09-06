# PRD — YouTube Distraction Timer & Session Report

**Status:** Draft for build
**Owner:** Gabriel
**Date:** 2026-09-02
**Type:** Chrome extension (MV3), standalone Web Store listing
**Platform:** YouTube
**Backend:** None · **Accounts:** None · **Payments:** None

---

## 1. One-line proposition

Hide the parts of YouTube designed to keep you scrolling, and see an honest, fully local report of how much time it actually took today.

## 2. The hypothesis

[Unhook](https://chromewebstore.google.com/) is a top-ranking, no-signup YouTube extension with roughly a million users and a 4.86-star rating, built around one mechanic: hide recommendations, Shorts, trending and comments so a single video doesn't turn into forty minutes of recommendation-driven scrolling. That install base and rating are strong, low-ambiguity evidence that "hide the algorithmic surfaces" is a real and validated demand, not a guess.

Unhook stops there — it is purely a blocker. It never tells the user whether it worked. There is no feedback loop: a user can install it, have it quietly do nothing (a selector broke, a toggle got flipped off, a video was watched anyway), and never know, because the product gives them no number to check itself against.

Separately, "best productivity Chrome extensions" roundups from Zapier, ClickUp and TimeTackle show a large, active audience specifically searching for focus/productivity tooling — evidence of demand for a *time* framing, not just a *content* framing, of the same underlying problem.

**The hypothesis:** combining Unhook's proven hide-distractions mechanic with an honest, fully local "time on YouTube today / this week" report closes the feedback loop Unhook leaves open — without ever sending usage data anywhere. This is a local report a user reads in the extension's own popup, not a cloud dashboard, not a synced account, not a "share your stats" feature. It answers "did hiding these things actually change my behavior?" in the same product that does the hiding.

## 3. Target user

| Attribute | Detail |
| :-- | :-- |
| Who | Anyone who has caught themselves opening YouTube for one video and surfacing forty minutes later |
| Context | Personal use, browser-level, no work/business budget behind it — same category as Unhook itself |
| Pain | The autoplay/recommendation/Shorts surfaces are built to extend a session past its original purpose, and there is currently no honest, private way to see whether that's actually happening |
| Why not just use Unhook | Unhook works, but gives no feedback — a user has no way to confirm the hiding is doing anything, or to see their own YouTube time trending down (or not) |
| Willingness to pay | None assumed — same free-utility category as the reference product; this PRD does not propose monetization |

## 4. Scope — V1

### In scope

- **Toggle-based hiding**, each independently on/off, mirroring Unhook's own granularity rather than one all-or-nothing switch:
  - Recommendations sidebar (watch page)
  - Homepage feed
  - Shorts shelf and Shorts tab/entry points
  - End-screen suggestions (the cards YouTube overlays as a video ends)
  - Comments
- **Local session timer.** Time counts only while a YouTube tab is both visible and focused — matching how a user would actually describe "time spent," not "tab open in the background." Pauses immediately on tab blur or tab-hide; resumes on refocus. See §5 for the precise definition and §7 for the multi-tab edge case.
- **Popup dashboard** showing:
  - Today's total
  - This week's total (last 7 calendar days)
  - A small daily bar chart, one bar per day, last 7 days
  - The five hide toggles
- **CSV export of session history** (date, minutes watched) — a reasonable V1 addition once a local session log exists at all, and the only way this product's central claim ("here's your real number") is independently checkable outside the popup. This is *why* `downloads` is a justified permission here (see §6).
- **Optional gentle end-of-session reminder** — e.g. "You've been on YouTube for 45 minutes." Dismissible, never blocking, never a modal, off by default threshold is user-configurable (default 45 min, can be turned off).
- **Data ownership**, per the portfolio's hard constraints: export all data (JSON backup of settings + daily totals), import, clear all — in addition to the CSV export above.

### Explicitly out of scope for V1

- **No hard time limits or blocking.** This product hides distraction surfaces and reports honestly; it does not stop anyone from using YouTube. A limit/lockout feature is a materially more invasive product with a different trust posture and is not this one.
- **No cross-device sync.** The report is local to the device it was measured on, by design — see §5's honesty framing. Syncing would require an account or a server, both hard constraints this portfolio rules out.
- **No video-content-based interventions.** No detection of what's *in* a video, no category-based rules, no "block gaming videos" — content-blind by design, same posture as Unhook.

## 5. Where the data comes from — read before committing

**The DOM hiding is the easy half.** Hiding recommendation shelves, the Shorts surfaces, end screens and comments is CSS-attribute-driven (a toggle sets a data attribute on `<html>`, a stylesheet declared in `content_scripts` hides matching elements) — the same low-risk, well-precedented profile as every other feed-declutter extension in this portfolio and in Unhook itself. It fails soft: if YouTube changes a selector, the toggle simply stops hiding that one surface rather than breaking anything else on the page.

**The session-timer logic is the part that needs care**, because it is the part the product's entire pitch depends on being honest.

- **"Watching" is defined as: the tab's `document.visibilityState === 'visible'` AND the tab has OS-level focus (`document.hasFocus()`).** A YouTube tab merely open in a background tab, or visible on screen but not the focused window, does not count. This is deliberately stricter than "the tab is open" — a user who alt-tabs away to answer a message should not see that time counted as YouTube time. It does **not** currently check whether a video is actually playing (paused-but-focused still counts as being on YouTube) — see §10 for whether that's the right line.
- **YouTube is a single-page app: there is no full page reload between videos.** A content script that only initializes on `document_idle`/page-load events would silently stop tracking after the first in-app navigation. The timer's watch-state logic must be driven entirely by `visibilitychange`/`focus`/`blur` events on the existing document, which persist correctly across SPA navigation with no dependency on load events at all — and, as a side benefit, the DOM-hiding toggles also survive SPA navigation for free, since they're a persistent attribute on `<html>`, not something re-applied per page.
- **Time is measured once, globally, never per tab**, specifically to satisfy the multi-tab edge case in §7 — see that section for the mechanism (a single accumulation cursor, not a per-tab sum).

## 6. Non-functional requirements

| Requirement | Target |
| :-- | :-- |
| Permissions | `storage` (settings, daily totals, session cursor, local usage counters) + `downloads` (CSV session-history export, and the JSON backup) |
| Host permission | `*://*.youtube.com/*` only |
| Accounts / OAuth | None |
| Network requests | Zero, anywhere in the codebase — verifiable by grep and in devtools' network tab |
| Toggle → hidden on page | Immediate; no visible flash of the surface being hidden on a fresh page load (CSS injected at `document_start`) |
| Popup open → dashboard rendered | < 200 ms; all data is local, no fetch required |
| Timer accuracy | Within one heartbeat interval (5 s) of true focused/visible time, accepting that laptop sleep/crash time is never retroactively credited (§7) |
| Data | Never leaves the device. No analytics SDK, no crash reporter, no remote config |

## 7. Edge cases

- **Multiple YouTube tabs open simultaneously.** Must not double-count. Handled structurally, not by convention: each tab's content script only opens a connection to the extension's own background service worker while it is actively "watching" (§5's definition); the service worker is the single writer of one shared accumulation cursor, advancing it by wall-clock elapsed time regardless of how many tabs are simultaneously connected. Two tabs both being watched still only ever advances the same cursor once — the timer is measuring "was *any* YouTube tab being watched," not summing N tabs' worth of time.
- **The browser sleeping or the laptop lid closing mid-session.** The next heartbeat after waking arrives with a large gap since the last one. Any gap beyond a small cap (three heartbeat intervals, 15 s) is treated as "not actually watched" and discarded rather than credited — sleep time must never silently become YouTube time in the report.
- **YouTube playing in a picture-in-picture window after the tab loses focus.** Under §5's strict definition, this stops counting the moment the main tab loses focus, even though the user may still be watching in the PiP window. This is very plausibly the wrong behavior for a subset of users. **Flagged as an open question (§10) rather than guessed at** — resolving it needs either detecting the PiP state specifically (the Document Picture-in-Picture / video `enterpictureinpicture` event) and treating it as a third watching state, or deciding that PiP is out of scope for V1's honesty framing. Shipping the strict version first and watching whether this becomes a real complaint is the safer default than adding PiP-detection complexity on a guess.
- **Midnight rollover.** A single heartbeat's elapsed span can straddle local midnight (e.g. a heartbeat fires at 12:00:02 AM after the last one at 11:59:57 PM). The elapsed time is split at the local midnight boundary and credited to each calendar day proportionally, so "today's total" is never off by a few seconds and never silently drops a boundary heartbeat's time entirely.

## 8. Success metrics (30 / 90 day)

| Metric | 30d checkpoint | 90d "keep investing" bar |
| :-- | :-- | :-- |
| Installs | 150 | 1,200 |
| 7-day retention | 30% | 40% |
| Users who enable ≥ 1 hide toggle | 60% | 70% |
| Users who open the popup dashboard ≥ 3 times | 25% | 35% |
| Users who export session history at least once | 5% | 10% |

Opening the dashboard repeatedly (not just installing and forgetting) is the activation event this product is actually testing for — it's the direct signal that the feedback-loop hypothesis in §2 is landing, as distinct from the hiding feature alone, which Unhook already proves works on its own.

## 9. Kill criteria

Under 200 installs or under 20% 7-day retention at 90 days → stop, and treat the finding as evidence about the "local honesty report" half of the hypothesis specifically (not about hide-distractions demand, which Unhook has already validated independently). If installs are healthy but dashboard opens stay near zero, that is a distinct and useful negative result: it says the hiding mechanic alone is the value, and the feedback-loop bet in §2 didn't pay off — worth recording as such rather than folding into a generic "underperformed" verdict.

## 10. Open questions

- **Does picture-in-picture watching count as "on YouTube"?** See §7. Left unresolved rather than guessed; revisit once there's real usage data or user feedback naming this specifically.
- **Should the timer eventually gate on video-playback state** (paused-but-focused stops counting), rather than focus/visibility alone? Kept out of V1 deliberately — playback-state detection adds a second source of DOM/API fragility for a distinction that may not matter to most users' mental model of "time on YouTube."
- **Is a 7-day bar chart enough, or does the feedback loop need a longer trend (30 days) to actually be convincing?** V1 ships 7 days because it's cheap and matches the weekly total already shown; revisit if early users ask for more history in reviews.
- **Naming:** "YouTube Distraction Timer & Session Report" is descriptive but long for a Web Store listing. Worth 30 minutes against live Web Store search before publishing, same as this portfolio's other naming notes — a shorter working name ("YouTube Focus Timer") is used for the shipped extension's own display name; the store listing name should get the same final check the other PRDs recommend.
