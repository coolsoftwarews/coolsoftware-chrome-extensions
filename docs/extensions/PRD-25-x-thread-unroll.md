# PRD — X Thread Unroll & Reader Export

**Status:** Draft for build
**Owner:** Gabriel
**Date:** 2026-09-02
**Type:** Chrome extension (MV3), standalone Web Store listing
**Platform:** X (Twitter)
**Backend:** None · **Accounts:** None · **Payments:** None

---

## 1. One-line proposition

Turn any thread on X into one clean, scrollable reading view — and a Markdown or text file — without sending it through anyone else's server.

## 2. The hypothesis

"Unroll this thread" is an established job — ThreadReaderApp and a handful of clones have run on it for years, and the pattern (paste a URL, get a readable page back) shows real, sustained demand. But every one of those tools works the same way underneath: it is **server-side**. You give it a link, its server fetches the thread itself (not from your logged-in session — from whatever a logged-out or third-party request can see), reformats it, and **republishes it as a new public page** at their domain, indexable by search engines, sitting between the reader and the original author.

That has three real costs a professional user should notice: it isn't reading *your* session (so anything gated behind a follow, a protected account, or a paywalled/limited-visibility reply is invisible to it); it creates a **public copy** of someone else's words at a URL the original author never chose and can't take down; and it depends on a company staying up, staying free, and staying willing to keep proxying X's traffic.

**The hypothesis:** a purely local, in-browser unroll — reading only what is already rendered in the tab the user is authenticated in, producing a clean reading view and a file export, and publishing to nowhere — serves the same underlying job (I want to read/save/share this thread as one document) without the privacy exposure or the unrequested public republish. The secondary hypothesis, worth testing distinctly: a thread (the original author replying to themself) is a different, cleaner object than a full reply section, and a tool that reliably tells them apart — capturing only the former — is more useful than one that dumps an entire conversation.

## 3. Target user

| Segment | Job |
| :-- | :-- |
| Readers / researchers | Read a long thread as one document instead of scroll-and-click |
| Writers / creators | Pull a thread's structure and wording into notes or a draft |
| Newsletter / curation accounts | Quote or reference a thread accurately, with its real structure intact |
| Privacy-conscious professionals | Read/export a thread without routing it through a third-party server or creating a public mirror |

## 4. Scope — V1

### In scope

**Trigger**

- A small "Unroll" control appears on any tweet the extension detects is part of a thread — a same-author reply chain, at least one reply deep (PRD §5 defines detection precisely)
- Clicking it opens the reading view

**Reading view (side panel)**

- Single clean, scrollable column showing every post in the thread, in order: author name/handle, avatar, post text, a media reference (thumbnail + "1 image"/"1 video" label — never the file itself), and the post's date
- Auto-scrolls the underlying X timeline forward, in small steps, while the panel is open and the thread is still loading, so posts X only renders on demand get pulled into view and captured — stops the moment no new posts appear for a few consecutive steps, or the thread's own end is reached
- A reading-time estimate at the top (word count ÷ average reading speed, rendered as "~4 min read")
- A visible post count ("14 posts") and an honest completeness note — see §5

**Export**

- `Copy to clipboard` — the whole reading view as Markdown
- `Download .md`
- `Download .txt`
- No PDF in V1 (the README's shared export layer already has a dependency-free PDF writer in two other extensions, but this PRD keeps V1 to Markdown/TXT/clipboard only — narrower than that layer supports, deliberately)

**Preference**

- Last-used export format (Markdown vs TXT) is remembered locally and pre-selected next time — the only thing this extension persists beyond the current thread being read

### Explicitly out of scope for V1

- No auto-detection of "viral threads" across the internet, no feed of trending threads, no discovery surface at all — this tool only ever acts on a thread the user is already looking at
- No cross-account thread discovery ("show me this person's other threads") — out of scope, a different product
- No saving/bookmarking a library of past unrolls — that's XConversationSaver's job (PRD-13), not this one; this extension has no persistent list of "threads I've read," only the current session's reading view
- No image/video downloading, ever — a thumbnail reference and a count only, never the file
- No PDF (see above)
- No editing/annotating the reading view — read and export only

## 5. Where the data comes from — read before committing

Everything comes from the DOM of the thread already rendered or loading in the user's own authenticated tab — the same posture XConversationSaver (PRD-13) already ships under. No API, no fetch, no background collection, no automation of X itself beyond scrolling the page the user is already on with the panel open.

**Thread detection.** A tweet is offered "Unroll" when it is itself a same-author reply to a preceding post by the same handle, or has at least one same-author reply beneath it — i.e., it sits inside a same-author reply chain of two or more posts. A reply from a different account breaks the chain at that point (see §7) and is never folded into the thread.

**The completeness problem.** X lazy-loads a thread's later replies and gates some behind an explicit "Show more replies" tap. This extension can prove exactly how many posts it has read and rendered — it cannot prove that number is the *whole* thread, because X never exposes a true total in the DOM. Following the truncation-honesty pattern already shipped in `XConversationSaver` (`src/scrape.ts`'s `collectThread`): watch the text rendered *between* consecutive tweet articles for X's own "Show more replies" affordance and for its "More Tweets"/"Discover more" algorithmic-suggestion boundary; stop collection hard at the second, and — critically — never emit a claim like "this is the complete thread." The reading view always says **"N posts shown"** as a verifiable, literal count, plus, only when a "Show more replies" affordance was seen and not expanded, an explicit **"more may exist — X did not fully load this thread"** note. No fraction, no invented denominator, ever — the same "report what you can prove, flag what you can't count" rule XConversationSaver's own build memory documents.

**Auto-scroll's role.** Because a thread's later replies may not be in the DOM at all until the user scrolls, the reading view drives a bounded, visible auto-scroll of the underlying timeline (small steps, a short pause between them so React has time to render) purely to *pull already-public content already available to this session into the DOM* — it never clicks "Show more replies" for the user (same as XConversationSaver's explicit choice not to auto-expand), and it never scrolls indefinitely: it stops after a few consecutive steps produce no new same-author posts, or when it hits the boundary text above.

## 6. Non-functional requirements

| Requirement | Target |
| :-- | :-- |
| Permissions requested | `activeTab`, `storage`, `downloads`, `sidePanel` — no `tabs`, no `scripting` |
| Host permissions | `*://*.x.com/*`, `*://*.twitter.com/*` — no other domain |
| Time to first render of a short thread (≤10 posts, already loaded) | < 1 s |
| Auto-scroll pass on a long thread (50+ posts) | Bounded — stops within ~20 steps / a few seconds of no new posts, never runs unattended in the background |
| Graceful failure | A tweet the extractor can't read degrades to a skipped row in the view, never a blank panel or a thrown error |
| Bundle size | < 500 KB |
| Read-only on the platform | No posting, liking, replying, following, or any write action — ever |
| Foreground only | Auto-scroll and reading only happen while the panel is open and the tab is the active one driving it; nothing runs when the tab is closed or the panel isn't open |
| Local-only instrumentation | Threads unrolled, exports used (by format), copy used — counters only, no thread text, no handles |

## 7. Edge cases

- **Quote-tweets embedded in the thread.** A quote-tweet is a distinct object from a same-author reply. Render it inline inside the post that quotes it (quoted author, handle, text) but never let a quote-tweet's own text be mistaken for the thread author's next post, and never walk *into* a quote-tweet's replies as if they were part of the unrolling thread.
- **Replies from other accounts interleaved with the author's own.** X's UI can render a reply chain where someone else jumps in between two of the original author's posts. Detection must skip a same-handle continuation *across* an interleaved foreign reply without accidentally absorbing the foreign reply itself into the thread — the reading view shows only the original author's chain, in order, and never silently drops a post from a different author into it unlabeled.
- **Very long threads (100+ posts).** Render incrementally as auto-scroll produces more posts rather than blocking on the whole thread; apply a hard cap (200 posts, matching the ceiling XConversationSaver already uses) as a safety valve, and say so plainly ("stopped at 200 posts") rather than truncating silently.
- **Deleted posts mid-thread.** X renders a distinct "this post was deleted"/unavailable placeholder in that slot. Preserve the gap in the reading view and export (e.g., "— a post in this thread is no longer available —") rather than closing the numbering up as if nothing were missing, since a reader stitching quotes back to the original needs to know a post is unaccounted for.

## 8. Success metrics (30 / 90 day)

| Metric | 30d checkpoint | 90d "keep investing" bar |
| :-- | :-- | :-- |
| Installs | 250 | 2,500 |
| 7-day retention | 18% | 28% |
| Unrolls per active user / week | 2 | 4 |
| Export or copy used per unroll | 40% | 55% |
| Store rating | ≥ 4.3 | ≥ 4.5 |

**Instrumented events (local counters only, no PII, no server):** panel opened, thread unrolled, posts-shown count bucket, truncated-thread seen, export by format, copy used.

If copy-to-clipboard dominates over file export, that's a signal V2 should optimize the "paste this into X" path (a newsletter, a note-taking app) rather than adding more file formats.

## 9. Kill criteria

Under 400 installs at 90 days with no organic reviews, or a thread-detection failure rate high enough that support/review feedback consistently describes "Unroll" as broken on ordinary threads → unpublish or leave dormant. Do not iterate past that signal.

## 10. Open questions

- Should "Unroll" also appear as a right-click context-menu entry on a tweet's permalink, for users who navigate straight to a thread's root without scrolling past it first? Decide after V1 ships, based on whether the in-feed control alone gets discovered.
- Does the reading-time estimate need a words-per-minute constant tuned per language, or is one fixed English-oriented constant an acceptable V1 approximation (labelled honestly, not claimed as precise)? Default to the latter unless early reviews specifically flag it.
- Do we ship Firefox/Edge builds day one? Marginal cost is low once the Chrome build is proven; decide after Chrome review passes, same posture as PRD-01.
