# PRD — YouTube Chapter Notes & Timestamp Exporter

**Status:** Draft for build
**Owner:** Gabriel
**Date:** 2026-09-02
**Type:** Chrome extension (MV3), standalone Web Store listing
**Platform:** YouTube
**Backend:** None · **Accounts:** None · **Payments:** None

---

## 1. One-line proposition

Drop a timestamped note while you watch, and walk away with your own chapter markers for any video — even one with no captions at all.

## 2. The hypothesis

The already-shipped sibling on this platform, [YouTubeTranscription](../../extensions/YouTubeTranscription) (PRD-01, "Transcript to PDF & Markdown"), solves a different problem: it needs the video to **have** a caption track, and its whole job is exporting that track verbatim, in full, as a document. It is a dump of what YouTube already knows about the video.

This product needs none of that. It reads nothing from YouTube's caption system — it works identically on a video with zero captions, which describes a large share of lecture recordings, conference talks, and independently produced podcasts-on-video that never got auto-captioned well or at all. And it isn't a dump: it is driven entirely by the viewer's own judgment of what's worth marking. A transcript export gives you everything that was said; this gives you the six moments *you* decided mattered.

**The hypothesis:** viewers of long-form video — lectures, podcasts, conference talks, tutorials — want a lightweight way to build their own chapter markers and notes as they watch, without waiting for the creator to add chapters (most never do) and without reading a full transcript to extract the three things they actually wanted. If this is true, retention should look like a *tool people reach for on their next long video*, not a one-off novelty — the test is whether "+ Note" gets clicked on a second, unrelated video in the same week.

## 3. Target user

| Segment | Job |
| :-- | :-- |
| Students | Build a personal index into a 90-minute lecture without transcribing all of it |
| Podcast/interview viewers | Mark the three moments worth quoting or replaying, skip the rest |
| Conference-talk watchers | Note the slide/claim/tool worth following up on later, keep watching |
| Note-takers who dislike transcripts | Want their own words at a timestamp, not the creator's words in full |

Narrower than the Transcript Export audience by design — this is for people actively taking notes, not everyone who wants a document.

## 4. Scope — V1

### In scope

**Capture**
- A "+ Note" button injected into the action row under the video player
- A keyboard shortcut (`Alt+Shift+N`) that opens the same capture card without leaving the video
- Capturing freezes the current player timestamp the instant the button/shortcut fires, then opens a small card to type a short note against that moment — the clock does not keep moving on you while you type
- Unsaved text is kept as a draft (see §7) so switching videos or dismissing the card does not throw it away

**Side panel**
- A running list of notes for the video currently open, sorted by timestamp
- Clicking any note's timestamp seeks the player to that moment
- Notes persist per video, keyed by video ID — returning to a video later (same session or a future one) shows every note taken on it before
- A search box that filters the current video's note list by text, for videos with a long list of notes

**Export**
- Export the current video's note list as **Markdown**, with each entry a clickable `youtube.com/watch?v={id}&t={seconds}s` timestamp link
- Export the current video's note list as **CSV**
- Whole-library JSON backup (export all / import / clear all), per this portfolio's data-ownership rule — separate from the per-video Markdown/CSV export, which is what a viewer actually wants to hand to someone else

### Explicitly out of scope for V1

- **No auto-chapter-detection.** Scene-change or silence analysis to guess chapter boundaries is real client-side signal processing, not a narrow V1 feature, and it competes with a different, heavier product than this one.
- **No AI summarization.** A note is the viewer's own words at a moment they chose; the product's value is that judgment, not an automated substitute for it.
- **No transcript reading of any kind.** That is the sibling extension's entire job (PRD-01). This product never touches YouTube's caption system, timedtext endpoint, or POT-token dance — see §5.
- No accounts, no cloud sync, no backend, no subscription, no cross-device sync beyond the user's own manual JSON export/import.

## 5. Where the data comes from — read before committing

Everything this extension needs comes from two places, both already visible on the page with no extraction risk:

- `document.querySelector('video').currentTime` — the timestamp at the moment "+ Note" fires
- The video ID, parsed from the tab's own URL (`?v=` on `/watch`, or the path segment on `/live/{id}`)

That's the entire data surface. No caption track, no timedtext fetch, no POT-token interception, no DOM scraping of YouTube's own UI beyond finding a stable place to inject a button (reusing the same action-row selector list YouTubeTranscription's `content.ts` already validated live) — and even that selector search is only for *where the button goes*, not for anything the product depends on to function correctly. If the action row can't be found on a given YouTube layout, the keyboard shortcut still works.

**Technical risk here is low, and it's worth saying plainly rather than inventing a spike this PRD doesn't need one for.** There is no fragile extraction pipeline to break when YouTube ships a redesign — the two inputs above are about as stable as anything on the page gets, and a broken button-injection selector degrades to "use the shortcut," not to a broken product.

## 6. Non-functional requirements

| Requirement | Target |
| :-- | :-- |
| Permissions requested | `storage`, `downloads`, `sidePanel` — **no** `scripting`, **no** `activeTab`, **no** `tabs` |
| Host permission | `*://*.youtube.com/*` |
| Time from click to capture card open | < 100 ms (no network call is ever on this path) |
| Works when | The video has captions, has none, is a Short, is a livestream (see §7), is age-gated to the point the player still loads |
| Graceful failure | If the panel can't reach a YouTube tab (extension just reloaded, or no YouTube tab is active), show "Open a YouTube video to start taking notes" — never a blank panel |
| Bundle size | < 500 KB |
| No layout shift | The injected button and capture card never push page content; the card is an overlay |

Why no `scripting`/`activeTab`: nothing in this product ever needs to read page content beyond `video.currentTime` and the URL, both of which the content script already has by being declaratively injected against the host permission. The side panel's job is to read and write `chrome.storage.local` and to ask the content script "what video are you on, and please seek here" — two narrow message types, not a general page-reading capability. Dropping the permission the code doesn't use is this portfolio's own stated practice (see `RedditVoiceOfCustomer`'s manifest, which reasons through the identical "does any function actually call `chrome.tabs`/`chrome.scripting`" test).

## 7. Edge cases

- **User navigates away mid-note.** A note in progress is persisted to `chrome.storage.local` as a draft on every keystroke (debounced), keyed to the video it was started on. Switching to a different video via YouTube's own SPA navigation closes the capture card rather than silently discarding what was typed; reopening the card on the original video restores the draft, timestamp and all.
- **Video ID changes via YouTube's SPA navigation.** YouTube never does a full page load between videos, so the content script listens for `yt-navigate-finish` (with a `popstate` fallback) the same way YouTubeTranscription's `content.ts` already does, and tells the panel the video changed rather than the panel silently going stale.
- **Live streams have no seekable timeline.** A note captured during a livestream is saved and exported like any other, but is labelled "live" in the panel instead of being offered as a click-to-seek link, since the moment it names may not land at the same spot in the stream's buffer later.
- **Very long note lists.** The panel's search box filters the current video's list by note text — the same "search across everything, filter in memory" approach the rest of this portfolio's panels use, since even an unusually heavy note-taker is nowhere near the volume that needs virtualization.

## 8. Success metrics (30 / 90 day)

| Metric | 30d checkpoint | 90d "keep investing" bar |
| :-- | :-- | :-- |
| Installs | 200 | 2,000 |
| 7-day retention | 20% | 30% |
| Users who capture a note on a **second, unrelated** video within 30 days | 15% | 25% |
| Exports per active user / week | 1 | 2 |
| Store rating | ≥ 4.3 | ≥ 4.5 |

**Instrumented events (local counters only, no PII, no server):** panel opened, note captured, note deleted, note edited, seek used, search used, export by format, data exported/imported.

The second-video-capture metric is the real test of the hypothesis in §2 — a note taken once, on one lecture, and never again is a different product finding than a note-taking habit that follows the viewer across videos.

## 9. Kill criteria

Under 400 installs at 90 days with no organic reviews, or under 10% of installed users ever capturing a second note (on the same or a different video) → unpublish or leave dormant. Do not iterate on the capture UI past that point; the finding would be that viewers don't want to interrupt watching to type, which no amount of button-placement tuning fixes.

## 10. Open questions

- Should a note optionally attach a short auto-captured caption line, when one exists at that timestamp, as extra context — without becoming the transcript-dump feature this product deliberately isn't? Deferred: it would blur the differentiation from PRD-01 and adds a caption-reading dependency this V1 explicitly avoids. Revisit only if user feedback specifically asks for it.
- Is `Alt+Shift+N` free across the handful of other extensions in this portfolio that also touch YouTube (`YouTubeTranscription` uses `Alt+Shift+T`, `YouTubeProFilters` uses none as of this writing)? Confirm at Web Store submission, since Chrome only warns about a collision with another *installed* extension, not this portfolio's other listings in the abstract.
- Does exporting a single video's notes want a "copy as Markdown" clipboard action in addition to file download, matching the pattern PRD-23's panel already ships? Left out of V1 scope above; cheap to add later if usage data shows people want it faster than a file download.
