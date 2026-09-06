# Chrome Web Store listing — Reddit Voice-of-Customer Saver

## Name

`Reddit Voice-of-Customer Saver`

Positioning note (PRD §10): this shares an engine with the [Web Highlighter](../WebHighlighter) —
select, save with context, export Markdown. The listing should read as a Reddit-specific research
tool for founders/marketers, not a repackaged general highlighter, so the two don't cannibalise each
other in search.

## Short description (132 char max)

`Save the sentences customers use on Reddit — with the thread and your note. Organize by theme, export as Markdown/CSV/JSON.`

## Category

Productivity → Workflow & Planning

## Detailed description

**Save the exact sentences where customers describe their problem.**

Highlight any text in a Reddit post or comment and a small "+ Save quote" control appears. Click it
and the quote is saved with the thread, the subreddit, the author and the date — the citation, not
just the sentence. Add a note. Assign a theme in one click: Pain, Objections, Language, Alternatives,
Feature requests, or your own.

**A research panel, not a spreadsheet**

Your saved quotes live in a side panel, grouped by theme, searchable across the quote, your note, the
subreddit and the author. See at a glance which subreddits and which themes are producing the most —
"19 pain quotes, 12 from r/freelance" is itself a finding.

**Get it out**

- **Markdown** — grouped by theme, each quote with its citation link. Paste straight into a messaging
  doc.
- **CSV** — for the spreadsheet workflow this replaces.
- **JSON** — a full, re-importable backup.

**No account. No cloud. No network.**

This extension makes no network requests at all — verifiable in devtools in about ten seconds. Your
quotes and notes live in your browser's local storage. Export everything as one JSON file, import it
back on another machine, or wipe it all with one click.

**Save without a name attached**

A "save without usernames" toggle in the panel, and a one-click "Hide author" on any saved quote, for
when you want the sentence, not the person.

**Built for**

SaaS founders collecting the words customers use for their problem. Copywriters sourcing landing page
copy from real language. Product marketers building a messaging doc from evidence. Researchers
assembling qualitative data with citations intact.

**Why it needs access to reddit.com**

The entire function of this extension happens on Reddit: reading the post or comment you've selected
and saving it locally. That's the only site it touches, and no data ever leaves your device.

## Permission justifications (for review)

| Permission | Justification |
| :-- | :-- |
| Host `*://*.reddit.com/*` | The extension's core function — capturing user-selected text from a Reddit post or comment, with its author, subreddit, thread and permalink — only happens on Reddit. This also lets the content script load automatically on Reddit pages without a separate `activeTab` or `scripting` grant. No data is transmitted off-device. |
| `storage` | Persisting saved quotes, themes, notes, export preferences and local usage counters. |
| `downloads` | Writing the exported .md/.csv/.json file and the JSON backup the user requests. |
| `sidePanel` | The saved-quotes research library, search and export controls are a side panel. |

**Not requested:** `activeTab`, `tabs`, `scripting`. The content script is declared in the manifest
against the host permission above, and the side panel talks to it only through
`chrome.storage.local` — never `chrome.tabs`.

**Remote code:** none. All code is bundled in the package; no eval, no remote scripts.
**Data usage disclosures:** none of the categories apply — no data is collected or transmitted.

## Screenshots (1280×800)

1. A Reddit comment with text selected and the "+ Save quote" control open
2. The confirmation toast with one-click theme chips
3. Side panel: quotes grouped by theme, with per-theme and per-subreddit counts
4. The export row, with a Markdown file open showing grouped, cited quotes
5. "Data" sheet — export / import / clear, with the local-only message

## Support and privacy links

- Privacy policy: publish [PRIVACY.md](PRIVACY.md) at a stable URL
- Support: repository issues page
