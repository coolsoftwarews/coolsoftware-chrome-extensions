# YouTube Chapter Notes & Timestamp Exporter

Chrome MV3 extension. Click "+ Note" under any YouTube video (or press `Alt+Shift+N`) to save a
timestamped note. Notes live in a side panel, click one to jump the player back to that moment,
export a video's list as Markdown or CSV. No account, no backend, no network requests, and — unlike
its sibling below — no dependency on the video having captions at all.

Built from
[PRD-29](../../docs/extensions/PRD-29-youtube-chapter-notes.md). Same platform as
[YouTubeTranscription](../YouTubeTranscription) (PRD-01, "Transcript to PDF & Markdown"), a
deliberately different problem class: that product dumps a video's caption track verbatim and needs
one to exist; this product captures only what the viewer decides is worth marking, and works
identically on a video with zero captions.

## Quick start

```bash
npm install
npm run icons          # regenerate src/icons/*.png (no image dependency)
npm run build           # dev build into dist/
npm run build:watch     # rebuild on change
npm run build:prod      # minified, production manifest name
npm test                # headless checks — url parsing, note CRUD, draft, exports, filenames, import merge
npm run typecheck
npm run zip              # production build + dist/ packed for the Web Store
```

Node 18+ is required. Load it: `chrome://extensions` → Developer mode → **Load unpacked** → select
`dist/`.

## How it works

| File | Job |
| :-- | :-- |
| `src/url.ts` | Pure video-id/URL parsing — the whole of PRD-29 §5's data surface |
| `src/notes.ts` | Pure note-list logic: capture/edit/delete, per-video filtering, draft continuation |
| `src/backup.ts` | Backup shape + merge-by-id import logic — pure |
| `src/formatters.ts` | Markdown/CSV export + filenames + time labels — pure |
| `src/storage.ts` | The only file that touches `chrome.storage.local`; wraps the pure modules |
| `src/content.ts` | DOM-bound: "+ Note" button, capture card, draft autosave, seek, video-change push |
| `src/panel.ts` | Side panel: the current video's notes — search, click-to-seek, export, data ownership |
| `src/background.ts` | Opens the side panel on toolbar click; relays the `Alt+Shift+N` shortcut |

### Why this is simpler than the transcript extension

`YouTubeTranscription` intercepts YouTube's own caption-fetch machinery (POT tokens, the timedtext
endpoint) because its whole job is reading what YouTube already knows about a video. This product
reads exactly two things — `video.currentTime` and the tab's own URL — both already available to a
declaratively injected content script, so there is no extraction pipeline to keep working against
YouTube's changes. See PRD-29 §5 for why this is a genuinely low-risk build, not an optimistic one.

### The one live-tab message this panel needs

Saved notes never travel through messaging — `content.ts` writes straight to `chrome.storage.local`,
and `panel.ts` refreshes on `chrome.storage.onChanged`, the same zero-messaging-for-data shape
`RedditVoiceOfCustomer`'s panel uses. But unlike that standing library, this panel *is* a per-page
view — "the notes for the video in front of you" is the product — so it needs exactly one live-tab
question, `YCN_GET_STATE` (which video is this, is it live), request/response,
`chrome.tabs.query({active, currentWindow})` + `chrome.tabs.sendMessage`, neither of which needs the
`tabs` permission once `host_permissions` already covers youtube.com. `content.ts` also pushes
`YCN_VIDEO_CHANGED` to any open panel on every YouTube SPA navigation, so the list updates without the
panel having to poll.

### Draft persistence (PRD §7)

Typing into the capture card writes a single debounced draft to `chrome.storage.local`, keyed to the
video it was started on. Navigating to a different video (YouTube's own SPA nav) closes the card but
never discards the draft; reopening the card on the *original* video restores the text. See
`continueDraftFor()` in `src/notes.ts` and the `draft continuation` section of `scripts/selftest.mjs`.

### Livestreams (PRD §7)

A note captured mid-stream is saved and exported like any other, but flagged `isLive` and shown
without a click-to-seek affordance in the panel — a livestream's buffer position isn't a fixed point
to seek back to later, so the panel says so rather than offering a jump that might land somewhere
else.

## Privacy

No `fetch`, no `XMLHttpRequest`, no `sendBeacon`, no `WebSocket` — enforced by `scripts/selftest.mjs`
grepping `src/*.ts` for all four, and verifiable yourself in devtools' network tab. Notes and usage
counters live in `chrome.storage.local` and are never transmitted. See [PRIVACY.md](PRIVACY.md).

## Manual test checklist

The DOM-bound half (`content.ts`, and the button-injection selectors it reuses from
`YouTubeTranscription`) needs a real browser:

- [ ] Open a long video, click "+ Note" under the player — the capture card opens with the timestamp
      frozen at the moment of the click, not drifting while you type
- [ ] Press `Alt+Shift+N` instead — same card opens, without needing to find the button
- [ ] Type a note, click Save — it appears in the side panel immediately, sorted by timestamp
- [ ] Click a note's timestamp badge in the panel — the player seeks to that moment
- [ ] Start typing a note, navigate to a different video via a suggested-video click (no full page
      load) — the capture card closes; navigate back to the original video and reopen the card — the
      draft text is still there
- [ ] Start typing a note, dismiss the card with Escape or a click outside it — reopen the card on the
      same video — the draft text is still there
- [ ] A video with **no captions at all** — capture and export work identically to a captioned video
- [ ] A livestream — capturing a note works, but the panel shows it as "live" with no seek link
- [ ] Navigate between several videos in the same tab (SPA nav) — the panel's note list updates to
      match whichever video is current, without a manual refresh
- [ ] A video with many notes — the search box filters the list by note text
- [ ] Export `.md` — headings, video URL and clickable per-note jump links are correct; export `.csv`
      — opens cleanly in a spreadsheet
- [ ] Reload the extension (simulating an update) while a YouTube tab is already open, then click
      "+ Note" on that tab — see "Known limits" below for the expected degraded behavior
- [ ] Data sheet: export all data, clear it, import the JSON back — nothing is lost or duplicated
- [ ] Storage warning appears once local storage crosses 80% (shrink `QUOTA_BYTES` temporarily to test)

## Known limits

- This extension deliberately holds no `scripting`/`activeTab` permission, so unlike
  `YouTubeTranscription` it cannot self-heal a tab that was already open before the extension was
  installed or reloaded — "+ Note" and the shortcut will do nothing on such a tab until it's
  refreshed. The panel's seek action fails the same way, with an explicit "Reload the YouTube tab"
  status message rather than a silent no-op.
- The action-row button-injection selectors are reused verbatim from `YouTubeTranscription`'s already
  live-validated `content.ts`. If YouTube changes that markup, the button may stop appearing — the
  keyboard shortcut is the fallback path and does not depend on the button existing.
- No auto-chapter-detection, no AI summarization, no transcript reading — all deliberately out of
  scope per PRD-29 §4.
