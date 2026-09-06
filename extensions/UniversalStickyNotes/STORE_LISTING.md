# Chrome Web Store listing — Universal Sticky Notes

## Name

`Universal Sticky Notes`

PRD §10 flags the naming as worth a quick pass against live Web Store search before publishing — this
category (Sticky Notes, Note Anywhere and similar) is crowded. Alternates: *Sticky Notes for the Web*,
*Page Notes — leave yourself a reminder*, *Anywhere Notes*.

## Short description (132 char max)

`Drop a sticky note anywhere on any page. Drag, resize, color it — it's there next time. No account, no cloud.`

## Category

Productivity → Workflow & Planning

## Detailed description

**Leave yourself a note, right where you'll need it.**

Click the toolbar icon (or press a shortcut) and a small colored note appears on the page — drag it
wherever it's useful, resize it, pick a color, type your reminder. Come back tomorrow, next week, next
month, and it's still there, roughly where you left it.

That's it. No folders inside folders, no rich text editor, no signing in to sync it somewhere. Just a
sticky note, the way sticky notes have always worked, except this one is attached to the exact page
where the thought happened.

**Find every note you've left, anywhere**

Open the side panel to see every note across every page you've annotated — search by what you wrote,
or by the page it's on. Click one to jump straight there, whether that tab is already open or not.

**Take it with you**

• **Export as Markdown** — every note, grouped by page, one file
• **Export all data as JSON**, **import it back** (merges, never duplicates), or **clear everything**
  with one click

**No account. No cloud. No network.**

This extension makes no network requests at all — you can verify that in devtools in about ten
seconds. Your notes live in your browser's local storage, on this device, full stop.

**Built for**

Anyone mid-task on a form or dashboard who wants to remember to fix one field. Researchers who want a
visual marker on where a thought happened, without breaking their flow to write it somewhere else.
Freelancers reviewing a client's site before a call. Anyone who's ever used browser bookmarks as an
informal to-do list and wanted something more specific than just the URL.

**Why it needs access to all sites**

A sticky-note tool that only works on an approved list of sites isn't a sticky-note tool. That
permission is what lets your notes come back on whatever you're looking at — and it grants no ability
to send anything anywhere, because there is no code in this extension that opens a network connection.

## Permission justifications (for review)

| Permission | Justification |
| :-- | :-- |
| `<all_urls>` host access | The extension's core function is placing notes on arbitrary user-chosen web pages and restoring them on return, and the side panel reads a tab's title/URL to list and search notes. Not possible with a site allowlist. No data is transmitted off-device. |
| `storage` | Persisting notes, page metadata and usage counters locally. |
| `downloads` | Writing the exported .md file and the JSON backup the user requests. |
| `sidePanel` | The notes list, search and data controls are a side panel. |
| `activeTab` / `scripting` | Injecting the note overlay into the page. |

**Remote code:** none. All code is bundled in the package; no eval, no remote scripts.
**Data usage disclosures:** none of the categories apply — no data is collected or transmitted.

## Screenshots (1280×800)

1. A page with three colored sticky notes at different sizes and positions
2. Dragging a note by its header, mid-drag
3. The color swatch popover open on a note
4. Side panel — searchable list of notes across several pages, one selected
5. The "Data" sheet — export / import / clear, with the local-only message

## Support and privacy links

- Privacy policy: publish [PRIVACY.md](PRIVACY.md) at a stable URL
- Support: repository issues page
