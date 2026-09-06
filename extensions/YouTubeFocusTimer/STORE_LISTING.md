# Chrome Web Store listing — YouTube Focus Timer

## Name

`YouTube Focus Timer`

PRD-32 §10 flags naming as worth a final check against live Web Store search before publishing —
"Focus Timer" and "Distraction Timer" are both used elsewhere; alternates worth a look at that point:
*YouTube Focus Timer — hide & track*, *Session Timer for YouTube*, *YouTube Time Report*.

## Short description (132 char max)

`Hide YouTube recommendations, Shorts & comments. See an honest local report of your time on YouTube today and this week. No account.`

## Category

Productivity → Workflow & Planning

## Detailed description

**Stop the "one video, forty minutes deep in recommendations" spiral — and see whether it worked.**

Turn off the parts of YouTube built to keep you scrolling, one at a time:

• **Recommendations sidebar** — the endless "up next" column beside every video
• **Homepage feed** — the algorithmic front page
• **Shorts** — the shelf, the tab, the whole surface
• **End-screen suggestions** — the cards YouTube overlays as a video ends
• **Comments** — if you're there to watch, not to scroll a comment section

Every toggle is independent. Turn off Shorts and keep recommendations, or hide everything — it's yours
to decide.

**Then see the number, honestly.**

Most "productivity" extensions that block distractions never tell you whether it's working. This one
does: a small popup shows today's and this week's time on YouTube, with a simple daily chart — measured
locally, on this device, the moment a YouTube tab is actually focused and visible (not just open in a
background tab). An optional, dismissible reminder can nudge you after a set number of minutes — never
a lockout, never a modal you have to click through.

**No account. No cloud. No network requests, anywhere.**

This extension makes zero network requests — verifiable in devtools' Network tab in about ten seconds.
Your settings and your daily-minutes report live in your browser's local storage and nowhere else.
Export it as CSV any time to check the numbers yourself, export a full JSON backup, or clear everything
with one click.

**Built for**

Anyone who has caught themselves opening YouTube for one video and surfacing much later than planned.
Not a blocker, not a lockout — a way to reduce the pull of the parts of YouTube designed to extend a
session, and an honest number to check whether it's actually changing anything.

## Permission justifications (for review)

| Permission | Justification |
| :-- | :-- |
| `storage` | Persisting the five hide-toggle settings, the reminder threshold, and the local daily-minutes report. |
| `downloads` | Writing the CSV session-history export and the JSON backup the user explicitly requests. |
| Host access: `*://*.youtube.com/*` | The extension's entire function — hiding distraction surfaces and measuring focused time — only operates on YouTube pages. No other site is read or modified. |

**Remote code:** none. All code is bundled in the package; no eval, no remote scripts.
**Data usage disclosures:** no data is collected or transmitted off-device; none of the Chrome Web
Store's "data usage" categories apply.

## Screenshots (1280×800)

1. A YouTube watch page with recommendations and comments hidden, toggle bar visible in the popup
2. The popup dashboard — today/week totals and the 7-day bar chart
3. The five hide toggles and the reminder threshold selector
4. The gentle reminder toast on a YouTube page, mid-dismiss
5. The Data sheet — export CSV / export backup / import / clear all, with the local-only message

## Support and privacy links

- Privacy policy: publish [PRIVACY.md](PRIVACY.md) at a stable URL
- Support: repository issues page
