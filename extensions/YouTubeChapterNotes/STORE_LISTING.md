# Chrome Web Store listing — YouTube Chapter Notes & Timestamp Exporter

## Name

`YouTube Chapter Notes & Timestamp Exporter`

Positioning note (PRD-29 §2): this shares a platform with
[YouTube Transcript Export](../YouTubeTranscription) but tests a different problem class — a
transcript dump vs. viewer-curated chapter markers. The listing should read as a note-taking companion
for long-form video, not a transcript tool, so the two don't cannibalise each other in search.

## Short description (132 char max)

`Drop a timestamped note while you watch — even with no captions. Click to jump back, export as Markdown or CSV.`

## Category

Productivity → Workflow & Planning

## Detailed description

**Your own chapter markers for any video — captions or not.**

Most lectures, podcasts and conference talks never get chapters. Click "+ Note" under the player (or
press `Alt+Shift+N`) and the current moment is captured instantly — type what's worth remembering, and
keep watching. No waiting for a transcript, no reading through one afterward: you decide what mattered,
in real time.

**A running list for the video you're on**

Your notes for the current video live in a side panel, in the order they occur. Click any timestamp to
jump the player straight back to it. Come back to the same video next week and every note you took is
still there.

**Works on videos with zero captions**

This extension never reads YouTube's caption track at all — it only needs the current playback time
and the video's own URL. That's what makes it work identically on a captioned video and one that has no
captions whatsoever, unlike a transcript tool.

**Get it out**

- **Markdown** — the note list for the current video, each entry a clickable jump-back link. Paste it
  into a study doc, a set of show notes, or a follow-up email.
- **CSV** — for pasting into a spreadsheet alongside other research.
- Full **JSON backup** — export everything, import it back on another machine, or wipe it all with one
  click.

**No account. No cloud. No network.**

This extension makes no network requests at all — verifiable in devtools in about ten seconds. Your
notes live in your browser's local storage.

**A note in progress is never lost**

Start typing, then click to a different video before you're done? The draft is still there when you
come back to the video you were noting.

**Built for**

Students turning a 90-minute lecture into their own index. Podcast and interview viewers marking the
three moments worth quoting. Conference-talk watchers noting the one tool or claim to follow up on.
Anyone who wants their own words at a timestamp, not a full transcript to dig through.

**Why it needs access to youtube.com**

The entire function of this extension happens on YouTube: reading the current playback position and
saving your note locally. That's the only site it touches, and no data ever leaves your device.

## Permission justifications (for review)

| Permission | Justification |
| :-- | :-- |
| Host `*://*.youtube.com/*` | The extension's core function — reading `video.currentTime` and the video id from the tab's URL, and injecting the "+ Note" button — only happens on YouTube. This also lets the content script load automatically on YouTube pages without a separate `activeTab` or `scripting` grant. No data is transmitted off-device. |
| `storage` | Persisting saved notes, the one in-progress draft, and local usage counters. |
| `downloads` | Writing the exported .md/.csv file and the JSON backup the user requests. |
| `sidePanel` | The current video's note list, search and export controls are a side panel. |

**Not requested:** `activeTab`, `tabs`, `scripting`. The content script is declared in the manifest
against the host permission above; the side panel exchanges exactly two narrow message types with it
("what video is open", "seek to this timestamp") and otherwise talks only to `chrome.storage.local`.

**Remote code:** none. All code is bundled in the package; no eval, no remote scripts.
**Data usage disclosures:** none of the categories apply — no data is collected or transmitted.

## Screenshots (1280×800)

1. A video with the "+ Note" button under the player and the capture card open, timestamp badge visible
2. The side panel: a video's note list, timestamps as clickable jump links
3. The Markdown export open in an editor, showing the video header and linked timestamps
4. The capture card mid-type, showing the frozen timestamp badge
5. "Data" sheet — export / import / clear, with the local-only message

## Support and privacy links

- Privacy policy: publish [PRIVACY.md](PRIVACY.md) at a stable URL
- Support: repository issues page
