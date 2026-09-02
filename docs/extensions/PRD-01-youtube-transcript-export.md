# PRD — YouTube Transcript Export

**Status:** Draft for build
**Build order:** #1 (first to ship)
**Owner:** Gabriel
**Date:** 2026-08-15
**Type:** Chrome extension (MV3), standalone Web Store listing
**Backend:** None
**Accounts:** None

---

## 1. One-line proposition

Turn any YouTube video transcript into a clean document — Markdown, TXT or PDF — in two clicks.

## 2. Why this one first

The hard part is already solved and running in production inside SavePosty (a separate, private project; not part of this repo):

- `transcript-extractor.ts` — POT-token interception + timedtext fetch
- `transcript-tool.ts` — panel UI, timestamp toggle, copy
- `transcript-extraction.md` — the technical writeup, including why naive approaches return 0 bytes

This extension is an **extraction exercise**, not a research project. Estimated build: 2–4 days including store assets.

## 3. Target user

| Segment | Job |
| :-- | :-- |
| Students / researchers | Get a lecture or talk into notes |
| Writers / creators | Reuse a video's content as source material |
| AI users | Paste a transcript into ChatGPT/Claude without hand-scraping |
| Accessibility / non-native speakers | Read instead of watch |

Broadest audience of the four candidates. Low willingness to pay, high install volume.

## 4. Scope — V1

### In scope

**Trigger surfaces**
- Toolbar icon on any `youtube.com/watch` page opens the panel
- Injected button under the video player ("Transcript")
- Keyboard shortcut (`Alt+Shift+T`)

**Panel**
- Transcript rendered with timestamps, scrollable
- Click a line → seek the player to that timestamp
- Search box → filter/highlight matching lines
- Language selector when the video has multiple caption tracks (auto-generated included)

**Export**
- `Copy to clipboard`
- `Download .md`
- `Download .txt`
- `Download .pdf`

**Export options (a single small options row, nothing more)**
- Include timestamps ☐/☑
- Include header block (title, channel, URL, duration, export date) ☐/☑
- Paragraph mode: raw caption lines vs. merged into paragraphs

**Filename convention**
`{channel} - {video title} - transcript.{ext}` (sanitized, truncated to 120 chars)

### Explicitly out of scope for V1

No AI, no summarization, no chat-with-video, no notes, no accounts, no cloud sync, no backend, no subscription, no bulk/playlist export. Those are V2 conversations that only happen if V1 gets traction.

## 5. Non-functional requirements

| Requirement | Target |
| :-- | :-- |
| Time to transcript, cached captions | < 1.5 s |
| Time to transcript, cold (POT dance) | < 4 s |
| Permissions requested | `activeTab`, `scripting`, `storage`, `downloads` — **no** broad host permissions beyond `*://*.youtube.com/*` |
| Works when | Video has any caption track, including auto-generated |
| Graceful failure | Clear message: "This video has no captions available" — never a blank panel |
| Bundle size | < 500 KB (PDF generation is the main risk — see §7) |

## 6. Edge cases to handle

- No captions at all → explicit empty state
- Live streams / premieres → unsupported message
- Age-restricted or member-only videos → unsupported message
- SPA navigation (YouTube never does a full page load) → panel must re-bind on `yt-navigate-finish`
- Very long transcripts (3h+ podcasts) → virtualized list or chunked render so the panel doesn't jank
- Multiple caption tracks with same language code (manual + auto) → label them distinctly
- YouTube DOM changes → extractor must fail loudly to a fallback path, not silently

## 7. Technical notes

- Reuse the SavePosty POT-token approach verbatim. **Never construct timedtext URLs manually** — let YouTube's player make the authenticated request and intercept the token.
- Strip all SavePosty backend/auth coupling during extraction. The new extension talks to nothing but youtube.com.
- PDF: generate client-side. Prefer a lightweight generator over a full headless render; if bundle size becomes a problem, ship MD/TXT in V1.0 and PDF in V1.1 rather than shipping a 3 MB extension.
- Markdown output shape:

```markdown
# {Video Title}

**Channel:** {Channel}
**URL:** {url}
**Duration:** {hh:mm:ss}
**Exported:** {date}

---

**[00:00:12]** First caption line…
```

## 8. Success metrics (30 / 90 day)

| Metric | 30d checkpoint | 90d "keep investing" bar |
| :-- | :-- | :-- |
| Installs | 300 | 3,000 |
| 7-day retention | 20% | 30% |
| Exports per active user / week | 2 | 4 |
| Store rating | ≥ 4.3 | ≥ 4.5 |

**Instrumented events (local counters only, no PII, no server):** panel opened, transcript loaded, transcript failed (with reason bucket), search used, timestamp toggled, export by format, copy used.

If MD/TXT dominate and PDF is unused → drop the PDF dependency.
If search dominates → the product is a *reader*, not an *exporter*, and V2 should follow that.

## 9. Monetization posture

None in V1. This is a volume/audience experiment. If it crosses ~20K users, the plausible paid surface is bulk/playlist export and format presets — not AI features, which are commoditized.

## 10. Kill criteria

Under 500 installs at 90 days with no organic reviews → unpublish or leave dormant. Do not iterate.

## 11. Open questions

- Do we ship Firefox/Edge builds day one? SavePosty already maintains parallel builds for both, so marginal cost is low — decide after Chrome review passes.
- Does the injected under-player button risk store review friction? If yes, toolbar-only for V1.
