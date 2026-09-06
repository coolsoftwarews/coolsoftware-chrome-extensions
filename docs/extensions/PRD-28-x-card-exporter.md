# PRD — X Tweet/Thread-to-Image Card Exporter

**Status:** Draft for build
**Owner:** Gabriel
**Date:** 2026-09-02
**Type:** Chrome extension (MV3), standalone Web Store listing
**Platform:** X (Twitter)
**Backend:** None · **Accounts:** None · **Payments:** None

---

## 1. One-line proposition

Turn any post (or short thread) into a clean, shareable PNG card — rendered entirely on your device, in under a second.

## 2. The hypothesis

"Tweet to image" is already a validated category, not a novel idea — TwitterShots' own comparison pages list Pikaso, PostSpark, TweetPik and 10015 Tools as direct competitors, and TwitterShots itself advertises bulk export, brand customization, thread-to-PDF and an API. That is real, standing demand for "turn this post into an image I can post/paste elsewhere."

The common pattern across every one of those tools is the same: **paste a tweet URL in, the *server* fetches and renders it, an image comes back.** That round trip buys template polish and bulk/API features, but it costs two things most users of this category don't actually need for the common case — latency (a fetch + server render before you get a file), and a privacy/trust cost (a third party's server now has a record of exactly which post you cared enough about to export, at a moment that is often competitive-research or outreach-adjacent).

The hypothesis: for the "I want a screenshot-quality image of this exact post I'm already looking at" job — which is what most users of this category actually do — a **fully client-side renderer** is a better fit. The post's author, avatar, text and metrics are already sitting in the DOM the moment the user is reading it; drawing that onto a `<canvas>` and exporting a PNG needs no fetch, no account, and no server ever seeing which post was exported. This is a bet that "good enough, instant, private" beats "polished, server-rendered, slower, and someone else's server knows what you screenshotted" for the bulk of this use case. It will not beat the incumbents on bulk export or an API — it isn't trying to.

## 3. Target user

| Segment | Job |
| :-- | :-- |
| Creators / commentators | Turn a good post or reply into a shareable image for other platforms (Instagram, LinkedIn, a newsletter) |
| Founders / indie hackers | Screenshot a customer compliment, a milestone tweet, or a thread for a deck or a build-in-public recap |
| Journalists / researchers | Grab a clean, readable image of a post as documented evidence without a third-party tool touching it |
| Marketers / social managers | Pull a quote or stat tweet into an image for a slide or a post, fast, without opening a separate site |

## 4. Scope — V1

### In scope

- A **"Save as image"** control injected near each post's action row (reply/repost/like/share bar) on the timeline, a single post's permalink page, and reply threads.
- Renders a branded card to an in-memory `<canvas>` using the post's own already-rendered author name, handle, avatar, body text, date and (optionally) reply/repost/like counts.
- **Three style templates**, selectable at export time: Light, Dark, Minimal (Minimal omits the metrics row for a cleaner pull-quote look — this is a fixed property of the template, not a separate toggle, to keep the export panel to one decision).
- The last-used template is remembered locally (`chrome.storage.local`) and pre-selected next time.
- **Download PNG** — a single click renders and saves the file via `chrome.downloads`. No preview-then-second-click required, though a live preview is shown before the click.
- **Thread export**: a second control ("Export thread as images") on the first post of a thread the user is reading. **V1 decision: one PNG per post, downloaded as N sequential files** (`handle-status-1-of-4.png`, etc.), not a single stacked image and not a ZIP. Reasoning: a stacked image needs to pick one fixed width and re-flow every post's text against it, which is more layout surface area than a V1 needs; a ZIP means either a runtime dependency or hand-rolling a ZIP writer purely to avoid four separate downloads. `chrome.downloads.download()` for N posts is four `downloads`-permission calls the user already granted, no extra permission, no extra code family. Revisit a stacked layout only if usage data says single-post export is used far more than thread export and the thread feature is worth polishing (§10).

### Out of scope for V1

No video/GIF export, ever (this is a static-image product). No editing tools — no crop, no annotate, no free text, no repositioning — beyond the three template choices. No server-side rendering, ever, under any future tier — that is the entire point of the product, not a V1 limitation. No auto-posting the exported image anywhere; the exit is a downloaded file, full stop. No bulk export / no API (that is deliberately where the incumbents win — see §2). No account, no cloud library of past exports — an export that isn't downloaded immediately is gone; there is no card history in V1.

## 5. Where the data comes from — read before committing

The card is built **only** from what the current tab has already rendered for the specific post the user clicked "Save as image" on: the author's display name and @handle, their avatar `<img>` element's `src`, the post's body text, its `<time datetime>` value, and — if the template includes them — the reply/repost/like counts as X has already formatted and displayed them. No tweet id is looked up, no API is called, and nothing is fetched for a post that isn't the one on screen. If the user hasn't scrolled a reply into view, it cannot be exported; that is the intended boundary, not a bug.

**Known browser risk, flagged before committing:** the avatar is drawn onto the canvas from the same CDN URL (`pbs.twimg.com`) the page already loaded — the extension never downloads or re-hosts it. Drawing a cross-origin image onto a canvas without the image having loaded under CORS (`img.crossOrigin = 'anonymous'` *and* the server actually returning a permissive `Access-Control-Allow-Origin` header) **taints the canvas**: the browser still lets you draw and even display it, but `canvas.toBlob()` / `canvas.toDataURL()` then throws a `SecurityError` instead of producing a file. This cannot be fully confirmed without a live spike against `pbs.twimg.com`'s actual response headers (blocked in this build environment — no network access to x.com), so the implementation is written defensively rather than optimistically:

1. Always request the avatar with `img.crossOrigin = 'anonymous'` before setting `src`.
2. If the image fails to load at all (`onerror`, or it times out), skip straight to a no-avatar fallback (a plain initials circle) — never block the export on a slow or failing image.
3. Even if the image *does* load, wrap the final `toDataURL()` call in a `try/catch`. On a caught `SecurityError`, re-render the same card with the initials-circle fallback instead of the real avatar and export that — the export must never simply fail because of an avatar CORS quirk.

**Spike before shipping publicly:** confirm on a live x.com tab, for both `pbs.twimg.com` profile-image URLs and the `abs.twimg.com` default-avatar fallback, whether path (1) or path (3) above is the one that actually fires. If it's consistently path (3), the "optimistic" `crossOrigin` request is pure overhead and the implementation should skip straight to the initials-circle fallback for speed — a one-day check, same discipline as the other gated PRDs in this portfolio (see README's 🟡 rows).

## 6. Non-functional requirements

| Requirement | Target |
| :-- | :-- |
| Time from click to downloaded PNG, single post | < 1 s on a typical post (no network round trip by design) |
| Permissions | `activeTab`, `storage`, `downloads` |
| Host permissions | `*://*.x.com/*`, `*://*.twitter.com/*` |
| Output | PNG only, rendered at 2x scale for crisp text on retina displays |
| Failure mode | A post whose text/author cannot be read degrades to "Can't read this post yet — try again once it's fully loaded," never a broken/blank image |
| Privacy stance | Stated plainly in the listing: the post never leaves the device, there is no server, this extension makes zero network requests of its own |
| Layout | Injected button must not shift the timeline (absolutely positioned, never inserted into X's own flow — X re-renders/recycles feed DOM nodes aggressively) |

## 7. Edge cases

- **Very long posts.** Body text is word-wrapped and capped at a template-specific max line count; anything beyond that is truncated with a trailing "…". The card never grows without bound just because a post is long.
- **Quote-tweets.** V1 renders only the quoting post's own text, author and avatar — the nested quoted post is not drawn as a second nested card (that is real added layout complexity for a case that isn't the primary job). If the quoted post's text is visible on the page, a future version could add it as a smaller inset card; V1 does not.
- **Media-only posts with little or no text.** The card still renders with author/avatar/date and an empty or near-empty text area rather than an awkward mostly-blank card; no attempt is made to draw the image/video itself into the card (media export is explicitly out of scope, §4).
- **RTL text (Arabic, Hebrew, etc.).** Canvas text direction and alignment are set based on the dominant script detected in the post's own text (a small Unicode-range check, not a language library), so the card reads right-to-left when the post does.
- **CJK and other no-space scripts.** The word-wrap algorithm falls back to character-level wrapping for any single "word" (a run with no whitespace) that alone exceeds the card's text width — this also doubles as the fallback for an unbroken long URL in an otherwise Latin-script post.
- **Dark-mode vs. light-mode source page.** The exported card's theme is entirely the user's template choice (Light / Dark / Minimal) and is completely independent of whether the X tab itself is in light or dark mode — reading the page's theme and defaulting to it was considered and rejected, since a user screenshotting *for* a dark-themed destination while browsing X in light mode (or vice versa) is a completely ordinary case.

## 8. Success metrics (30 / 90 day)

| Metric | 30d checkpoint | 90d "keep investing" bar |
| :-- | :-- | :-- |
| Installs | 150 | 1,500 |
| 7-day retention | 20% | 30% |
| Cards exported per active user / week | 2 | 5 |
| Template distribution | All three templates used at least once by >10% of users each | Same, sustained |
| Thread export usage (of all exports) | 10% | 20% |
| Store rating | ≥ 4.3 | ≥ 4.5 |

**Instrumented events (local only):** cards exported (single vs. thread), template used per export, avatar-fallback rate (how often the initials circle was needed instead of the real avatar — the direct signal for whether the §5 CORS risk is real in practice), export failures by reason.

## 9. Kill criteria

Under 300 installs at 90 days → leave published (zero ongoing cost, no server to turn off) but stop investing further template/polish work.

If the avatar-fallback rate stays above ~50% in the field, that is a signal the CORS taint problem from §5 is common rather than rare — the fix is not a kill trigger by itself, but it does mean the "optimistic" avatar path should be replaced with the initials-circle-first approach the spike in §5 already anticipates.

## 10. Open questions

- Does the avatar draw reliably in practice, or does the initials-circle fallback end up being the common case rather than the rare one? Only answerable with the §5 spike against a live x.com session.
- Is three templates the right number, or does usage cluster so hard on one (likely Light or Minimal) that the other two are wasted surface area worth cutting in a v1.1?
- If thread-export usage clears the 90-day bar meaningfully, is a single stacked image (rather than N separate PNGs) worth the added layout work described in §4's V1 decision?
- Should the metrics row (replies/reposts/likes) be a per-export toggle rather than a fixed property of the Light/Dark templates, if users ask for a "clean" card that still isn't the Minimal template's specific look?
