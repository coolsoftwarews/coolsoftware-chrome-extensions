# Chrome Web Store listing — Screen Capture

Copy is written to the PRD's positioning: differentiate on **one** axis (privacy + no account,
ever) and say it in the first line.

## Title (45 char limit)

```
Screen Capture — Full Page Screenshot, Annotate
```

`Screen Capture — Full Page Screenshot, Annotate, Blur` is the PRD title but runs 53
characters; the trimmed version above fits. "Blur" stays in the short description.

## Short description (132 char limit)

```
Full-page screenshots with annotate and blur. No account, no upload — your captures never leave your device.
```

## Detailed description

```
Screen Capture takes a full-page screenshot, lets you mark it up, and gets out of your way.

No account. No upload. No watermark. Your captures never leave your device — there is no
server to send them to.

CAPTURE
• Full page — the whole scrollable page, stitched, including content below the fold
• Visible area — just what's on screen
• Selected region — drag a box around exactly what you need
• Alt+Shift+P for a full-page capture without opening the menu

ANNOTATE
• Rectangle and arrow to point at the thing
• Blur to hide names, emails, account numbers and API keys before you share
• Text in three sizes
• Crop

EXPORT
• PNG, JPEG or PDF
• Copy straight to the clipboard and paste into Slack, Jira, Notion or a deck

BUILT FOR REAL PAGES
Sticky headers are removed from the stitch instead of repeating down it. Lazy-loaded images
are given time to load. Pages that scroll inside a container are handled, not guessed at.

PRIVACY
Screen Capture has no account system, no analytics service and no network calls. The only
permissions it requests are the ones it needs to capture the tab you're on and save the file
you asked for. It cannot read pages you haven't invoked it on.
```

## Permission justifications (required at submission)

| Permission | Justification |
| :-- | :-- |
| `activeTab` | Capture the page the user explicitly invoked the extension on. Grants no access to any other tab. |
| `scripting` | Inject the capture agent that measures the page, drives the scroll, and draws the region-select overlay. |
| `downloads` | Save the finished screenshot as PNG, JPEG or PDF to the user's Downloads folder. |
| `offscreen` | Composite captured frames on a canvas; the MV3 service worker has no DOM. |
| `storage` | Store local usage counters and preferences. Nothing is transmitted. |

**Remote code:** none. **Data collected:** none — declare "does not collect user data" and
confirm the three data-usage certifications.

## Assets checklist

- [ ] Icon 128×128 (generated: `public/icons/icon-128.png`)
- [ ] Screenshot 1 — 1280×800 — full-page capture of a long article, seam-free
- [ ] Screenshot 2 — 1280×800 — editor with a blur box over an email address (the support/QA hook)
- [ ] Screenshot 3 — 1280×800 — arrow + text annotation on a bug
- [ ] Screenshot 4 — 1280×800 — export row, with "never leaves your device" visible
- [ ] Small promo tile 440×280
- [ ] Privacy policy URL → `PRIVACY.md` published on the portfolio site
- [ ] Category: Workflow & Planning · Language: English

## Onboarding

None in-product. The popup's three buttons and the footer line
("Captures never leave your device.") are the whole onboarding surface. If installs convert
but week-1 retention misses the 25% bar, that's the first place to add a single first-run tip
— not a tour.
