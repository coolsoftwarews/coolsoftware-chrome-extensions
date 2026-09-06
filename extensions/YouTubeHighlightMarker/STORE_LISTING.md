# Chrome Web Store listing — Highlight Marker & Clip-Index Exporter for YouTube

## Name

`Highlight Marker & Clip-Index Exporter for YouTube`

Positioning note (PRD §2): this is a top-of-funnel discovery path for ClipWizard, an existing
product in the same portfolio that actually cuts video — but the listing should read as a complete,
standalone marking tool. Someone who never hears of ClipWizard still gets full value: a shot list
they can hand to an editor or use themselves in any video software.

## Short description (132 char max)

`Mark in/out highlights while you watch any YouTube video. Export timestamps, notes and thumbnails as Markdown or CSV.`

## Category

Productivity → Workflow & Planning

## Detailed description

**Stop scrubbing the same video twice.**

Watching raw footage, a VOD, a long interview, looking for the good parts? Press **Mark in** where
it starts, **Mark out** where it ends — on-page buttons or `Alt+Shift+I` / `Alt+Shift+O` — and it's
saved: timestamps, a thumbnail frame, and a note field for why it matters.

**A shot list, not a memory.**

Every mark you make on a video shows up in a side panel — click any timestamp to jump straight back
to it. Add a note while the context is fresh. Mark the ends in either order; if you press "out"
before "in," it's sorted out for you and flagged, not rejected.

**Get it out**

- **Markdown** — every mark with its timestamp, your note and an embedded thumbnail, one
  self-contained file.
- **CSV** — timestamps and notes only, for the spreadsheet workflow.

**No account. No cloud. No network.**

This extension makes no network requests at all — verifiable in devtools in about ten seconds. Every
mark, note and thumbnail lives in your browser's local storage, keyed to the video it belongs to.
Export everything as one JSON backup, import it back on another machine, or wipe it all with one
click.

**Built for**

Creators reviewing raw footage before an edit. Streamers logging clip-worthy moments in a VOD.
Podcasters and interviewers marking the quotable parts of a long recording. Researchers and
journalists who need a timestamped, citable log of a long talk or hearing.

**Why it needs access to youtube.com**

The entire function of this extension happens on YouTube: reading the video's current playback
position and the frame on screen when you mark it. That's the only site it touches, and no data ever
leaves your device.

## Permission justifications (for review)

| Permission | Justification |
| :-- | :-- |
| `activeTab` | Lets the toolbar icon and the two keyboard shortcuts (mark in / mark out) act on the currently active tab without a standing grant over every open tab. |
| Host `*://*.youtube.com/*` | The extension's core function — reading playback position and capturing the current video frame — only happens on YouTube. This also lets the mark-button UI load automatically under the player. No data is transmitted off-device. |
| `storage` | Persisting marks, notes, thumbnails, export preferences and local usage counters. |
| `downloads` | Writing the exported .md/.csv file and the JSON backup the user requests. |
| `sidePanel` | The clip list, note editing, seek-to-mark and export controls are a side panel. |

**Not requested:** `scripting`, a general `tabs` grant. The content script is declared in the
manifest against the host permission above.

**Remote code:** none. All code is bundled in the package; no eval, no remote scripts.
**Data usage disclosures:** none of the categories apply — no data is collected or transmitted.

## Screenshots (1280×800)

1. A YouTube video with the "Mark in" / "Mark out" buttons under the player, one marked
2. The side panel: a clip list with thumbnails, timestamps and notes
3. An in-progress mark with the "press Mark out to finish" status line
4. A Markdown export open in a viewer, showing embedded thumbnails
5. The Data sheet — export / import / clear, with the local-only message

## Support and privacy links

- Privacy policy: publish [PRIVACY.md](PRIVACY.md) at a stable URL
- Support: repository issues page
