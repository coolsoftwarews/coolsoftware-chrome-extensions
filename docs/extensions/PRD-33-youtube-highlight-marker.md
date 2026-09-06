# PRD — YouTube Highlight Marker & Clip-Index Exporter

**Status:** Draft for build
**Owner:** Gabriel
**Date:** 2026-09-02
**Type:** Chrome extension (MV3), standalone Web Store listing
**Platform:** YouTube
**Backend:** None · **Accounts:** None · **Payments:** None

---

## 1. One-line proposition

Mark the good moments while you watch, and walk away with a shot list — timestamps, notes and a thumbnail for every mark — instead of a memory of where they were.

## 2. The hypothesis

The target user is reviewing raw or long-form footage — their own upload, a recorded stream, a long interview — looking for the moments worth keeping before they edit. Today that means scrubbing the timeline by hand with nothing to show for it afterward: no record of what was found, no way to hand the list to someone else, no way to pick it back up tomorrow without re-watching.

The hypothesis: a lightweight in/out-point marker, paired with an exported highlight index — timestamps, a note per mark, and a thumbnail grabbed at that instant — turns idle scrubbing into a reusable artifact. It costs the user two keystrokes per moment and gives back a document they can act on.

There is also a distribution angle specific to this portfolio, worth stating plainly rather than pretending it isn't there: this extension feeds directly into ClipWizard (a separate, private project; not part of this repo), an existing product in this same portfolio that actually cuts video. Someone using a free extension to *find and log* their best moments is exactly the person who, five minutes later, wants a tool to *cut* them. The highlight index this extension exports (timestamps + notes) is a natural, unforced handoff into that workflow — a "found this, now what" moment the listing and in-panel copy can point at once, without the extension depending on ClipWizard in any way. It must stand on its own: someone who never hears of ClipWizard still gets a complete, useful tool for turning a rewatch into a shot list they can hand to an editor or use as a script for their own cut in whatever software they already use.

## 3. Target user

| Segment | Job |
| :-- | :-- |
| Creators reviewing raw footage | Scrub a long recording once, mark the good bits, hand the list to an editor (or themselves, tomorrow) |
| Streamers | Go through a VOD looking for clip-worthy moments before highlights are cut |
| Podcasters / interviewers | Mark the quotable moments in a long-form video interview |
| Researchers / journalists | Log timestamped, citable moments in a long recorded talk or hearing, with a note on why each one matters |

## 4. Scope — V1

### In scope

- "Mark in" / "Mark out" controls — both an on-page button pair under the player and keyboard shortcuts — usable while watching any YouTube video.
- Each mark pair becomes a **clip candidate**: an in-point, an out-point, and a note field the user can type into.
- A thumbnail grabbed via `<canvas>`, drawn directly from the `<video>` element at the marked timestamp — a frame capture of what is already playing, not a network request.
- A side-panel list of every clip candidate for the video currently open, sorted by in-point.
- Click any mark (or its timestamp) to seek the player to that instant.
- Export the full index for the current video as:
  - **Markdown** — timestamps, notes and thumbnails embedded as data URIs, so the file is one self-contained document.
  - **CSV** — timestamps and notes only, no images, for anyone who wants it in a spreadsheet.
- Marks placed in either order (out before in, or in before out) are accepted and resolved into a correctly-ordered clip candidate — see §7.
- Local backup: export all marks (every video) / import / clear all, per the portfolio's standing rule that everything a user creates is theirs to take with them.

### Out of scope for V1

- **No actual video cutting, re-encoding or export of video/audio.** That is ClipWizard's job, not this extension's — this product produces a *list*, never a file you could play.
- No cloud rendering, no upload of any frame or video data anywhere.
- No auto-highlight-detection (silence detection, scene-change analysis, audio-peak detection). Real, but heavy, and squarely a V2-or-never conversation — V1 is a marking tool, not an analysis tool.
- No playlist-wide or channel-wide marking session; one video's marks at a time in the panel (though all videos' marks persist locally and are included in the full backup export).

## 5. Where the data comes from — read before committing

The one non-trivial technical risk in this product is the thumbnail grab: drawing a YouTube `<video>` frame onto a `<canvas>` and reading it back out with `toDataURL()`/`toBlob()`.

This is the same class of risk as any product in this portfolio that touches video or image pixels directly rather than through a network request — canvas reads from cross-origin media without the right CORS headers throw a `SecurityError` ("tainted canvas"), and YouTube's player does not reliably serve its media in a way that guarantees a clean read across all playback paths (DASH-streamed vs. progressive, ad breaks, embedded players, DRM'd content). [`XCardExporter`](../../extensions/XCardExporter) is a sibling product being built in this same batch that touches image/video pixels on a different platform and is worth reading first if its PRD or code exists by the time this is built — the tainted-canvas handling there should not be re-derived from scratch twice in the same week.

If `XCardExporter` doesn't exist yet or its approach doesn't transfer: **treat the canvas grab as a spike, not a guarantee.** The build must:

1. Attempt the grab and time-box the attempt — no retry loops, no blocking the mark action on it.
2. On any failure (`SecurityError`, `NotAllowedError`, an empty/blank frame, or simply `toDataURL` throwing), fall back to a **timestamp-only mark with no thumbnail** — never a broken export, never a mark that silently fails to save because the image failed.
3. Surface the fallback quietly in the UI (a small "no thumbnail" state on that mark), not as an error dialog — a missing thumbnail is a degraded mark, not a failed one.

Do not commit to "every mark has a thumbnail" as a hard requirement anywhere in the UI copy or the store listing. The honest claim is "marks get a thumbnail when the browser allows it."

## 6. Non-functional requirements

| Requirement | Target |
| :-- | :-- |
| Mark action (in or out) | No visible delay — the timestamp is captured synchronously off `video.currentTime`; the thumbnail grab happens after and never blocks the mark from registering |
| Thumbnail size | Capped (long edge ≤ 320px, JPEG ~70% quality) — this is a reference frame for a shot list, not archival footage |
| Permissions | `activeTab`, `storage`, `downloads`, `sidePanel`. Host permission: `*://*.youtube.com/*`. No broader host access, no `scripting`, no `tabs` |
| Storage | `chrome.storage.local` only, marks keyed by video ID. No account, no sync, no server |
| Failure mode | A failed thumbnail grab degrades to a timestamp-only mark, never a lost mark or a broken export |
| Data ownership | Export all / import / clear all, available from the panel at all times |

## 7. Edge cases

- **Marks placed out of order** (out-point pressed before in-point, or vice-versa): both presses are accepted as two ends of one clip candidate and sorted into in/out by timestamp, not by which button was pressed first or second. The panel notes when a clip's marks were auto-corrected, so the user isn't confused about which button did what.
- **Very short clips (<1s):** allowed, not blocked — a near-instant "bookmark" is a legitimate use (e.g., marking a single quotable line). Flagged in the panel with a small "short" indicator rather than rejected, since duration validation belongs to ClipWizard, not to a marking tool.
- **Marking near the very start or end of the video:** timestamps are clamped to `[0, video.duration]`; a mark at 0:00 or at the final second is valid and exports normally.
- **Video ID changes via SPA navigation while an in-point is set but no out-point yet:** YouTube never does a full page load between videos, so this is the one place data could silently vanish. The unfinished mark is discarded on navigation, but the user is warned — an on-page notice and a status line in the panel — rather than it disappearing with no trace.
- **Thumbnail capture fails** (tainted canvas, blank frame, any thrown error): the mark still saves, timestamp-only, per §5. The export never breaks because one mark has no image.
- **Duplicate/rapid double-marks:** pressing the same mark button twice in a row before completing the pair updates that pending mark's timestamp rather than creating two overlapping candidates.

## 8. Success metrics (30 / 90 day)

| Metric | 30d checkpoint | 90d "keep investing" bar |
| :-- | :-- | :-- |
| Installs | 150 | 1,500 |
| 7-day retention | 20% | 30% |
| Marks created per active user / week | 4 | 8 |
| Export rate (users who export at least once) | 30% | 45% |
| Click-through to ClipWizard from in-panel prompt | tracked, no hard bar at 30d | 5% of exporting users |
| Store rating | ≥ 4.2 | ≥ 4.4 |

**Instrumented events (local only):** mark created (in/out), pending mark discarded on navigation, thumbnail capture failure, clip note added, export by format, seek-from-panel used, ClipWizard link clicked, full backup export/import/clear used.

## 9. Kill criteria

Under 300 installs at 90 days, or an export rate under 15% at 90 days (meaning people mark but never take the list anywhere) → leave published, zero further investment. An export rate that stays low is itself a finding: it would say the marking motion isn't the bottleneck people feel, and the next YouTube workflow experiment should target something else.

## 10. Open questions

- Does the ClipWizard cross-link belong in the panel permanently, or only after a user has exported at least once (so it reads as a natural next step rather than an upsell shown to someone who hasn't found value yet)? Default to the latter unless usage data says otherwise.
- Is a single "current video" panel view sufficient, or will early users want a cross-video library view (like the Saver pattern used elsewhere in the portfolio)? Deferred — V1 keeps all videos' marks in storage and in the full backup export, but the panel itself only surfaces the open video's list, to keep the UI narrow.
- Should the Markdown export offer a "notes only, no thumbnails" toggle for users who find the data-URI file too heavy to paste elsewhere? Watch for support requests before adding it.
