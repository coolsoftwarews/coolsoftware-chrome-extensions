# Chrome Web Store listing — Web Highlighter & Markdown Export

## Name

`Web Highlighter & Markdown Export`

PRD §12 flags the naming as worth 30 minutes against live Web Store search before publishing.
Alternates that keep the Markdown keyword (the wedge) while cutting the crowded "web highlighter"
head term: *Highlight to Markdown*, *Markdown Highlighter — clip any page*, *Marginalia — highlight
& export*.

## Short description (132 char max)

`Highlight any page, add notes, export as Markdown, PDF, HTML or TXT. No account, no cloud — your notes never leave your device.`

## Category

Productivity → Workflow & Planning

## Detailed description

**Highlight what matters. Take it with you as clean Markdown.**

Select text on any page, pick a colour, and it's saved. Add a note to a highlight, or a note to the
whole page. Come back tomorrow and your marks are still where you left them.

When you're done reading, get it out:

• **Copy as Markdown** — straight into Obsidian, Logseq, Notion, or an AI chat
• **Markdown (.md)** — YAML front matter with title, source, author and date; highlights as blockquotes
• **Clean HTML** — reader view, self-contained, no scripts or trackers
• **PDF** — the clean version, not the ad-covered one
• **Plain text (.txt)**

Export just your highlights, or the whole page cleaned up.

**No account. No cloud. No network.**

Most highlighters want you to sign up so your research lives on their server. This one doesn't ask,
because it can't: it makes no network requests at all. Your highlights and notes live in your
browser's local storage, and you can verify that in devtools in about ten seconds.

That cuts both ways, so the tools to own your data are built in: export every highlight across every
page as one JSON file, import it back on another machine, or wipe everything with one click.

**Built for**

Researchers and students pulling quotes out of a dozen articles. Writers collecting evidence.
Obsidian and Logseq users who want clean Markdown, not soup. Anyone turning a page into clean text
to paste into a model. Analysts marking the three paragraphs that matter in a fifty-page report.

**Why it needs access to all sites**

A highlighter that only works on an approved list of sites isn't a highlighter. That permission is
what lets your marks come back on whatever you're reading — and it grants no ability to send
anything anywhere, because there is no code in this extension that opens a network connection.

## Permission justifications (for review)

| Permission | Justification |
| :-- | :-- |
| `<all_urls>` host access | The extension's core function is highlighting arbitrary user-chosen web pages and restoring those highlights on return. This is not possible with a site allowlist. No data is transmitted off-device. |
| `storage` | Persisting highlights, notes and export preferences locally. |
| `downloads` | Writing the exported .md/.html/.pdf/.txt file and the JSON backup the user requests. |
| `sidePanel` | The highlight list and export controls are a side panel. |
| `tabs` / `activeTab` | Identifying the active page so the panel shows its highlights, and disabling the panel on unsupported pages. |
| `scripting` | Injecting the highlighting UI into the page. |

**Remote code:** none. All code is bundled in the package; no eval, no remote scripts.
**Data usage disclosures:** none of the categories apply — no data is collected or transmitted.

## Screenshots (1280×800)

1. Article with three coloured highlights and the selection toolbar open
2. Side panel listing highlights with notes, next to the article
3. The export row, with a Markdown file open in Obsidian beside it
4. "Data" sheet — export / import / clear, with the local-only message
5. The unanchored-highlight state, showing the text and note preserved

## Support and privacy links

- Privacy policy: publish [PRIVACY.md](PRIVACY.md) at a stable URL
- Support: repository issues page
