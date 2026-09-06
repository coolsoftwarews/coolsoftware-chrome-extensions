# Chrome Web Store listing — Universal Reader Mode & Export

## Name

`Universal Reader Mode & Export`

PRD-39 §10 flags the naming as worth a quick pass against live Web Store search before publishing —
"reader mode" sits near the browser's own built-in feature name. Alternates that keep the export
wedge explicit: *Clean Reader — save any article*, *Reader & Export — strip, read, keep*.

## Short description (132 char max)

`Strip any page to a clean reading view, then export it as Markdown, PDF or TXT. No account, no cloud — nothing ever leaves your device.`

## Category

Productivity → Workflow & Planning

## Detailed description

**Strip the page. Keep the article.**

Click the toolbar icon (or press Alt+Shift+R) on any article and reader mode strips the ads,
navigation, sidebars and comments, leaving just the writing — adjustable font, line width, and a
light, dark or sepia theme.

Your browser probably already has a reader view like this. The difference is what happens when
you're done:

• **Markdown (.md)** — front matter with title, source and date, straight into Obsidian, Logseq,
Notion or an AI chat
• **PDF** — the clean version, not the ad-covered one
• **Plain text (.txt)**

Close the built-in reader view and it's gone. Export from this one and you have a real file.

**No account. No cloud. No network.**

Most "save it for later" tools want you to sign up so your reading list lives on their server. This
one doesn't ask, because it can't: it makes no network requests at all, verifiable in devtools in
about ten seconds. Reading preferences (font, theme, width) are saved locally so they carry over to
the next article — no page content is ever stored.

**Honest about what it can't do**

Reader mode only works on pages that actually look like articles. On a dashboard, a search results
page, or anything else that isn't long-form content, it says so plainly instead of handing you a
mangled export.

**Built for**

Researchers and writers who want a clean file, not a screenshot. Obsidian and Logseq users who want
clean Markdown, not soup. Anyone turning a cluttered page into clean text to paste into a model.
Anyone who wants a genuinely readable PDF of an article instead of the ad-covered live page.

**Why it needs access to all sites**

A reader mode that only works on an approved list of sites isn't a reader mode. That permission lets
extraction run on whatever you're currently reading — and it grants no ability to send anything
anywhere, because there is no code in this extension that opens a network connection. Nothing runs
on a page automatically, either: the extension only activates when you click the icon or press the
shortcut.

## Permission justifications (for review)

| Permission | Justification |
| :-- | :-- |
| `<all_urls>` host access | The extension's core function is reader-mode extraction on arbitrary user-chosen web pages. This is not possible with a site allowlist. No data is transmitted off-device. |
| `activeTab` | Identifying the page the user wants read when they invoke the extension. |
| `scripting` | Injecting the reader-mode UI into the page — on demand only, never automatically on page load. |
| `storage` | Persisting reading preferences and local usage counters. |
| `downloads` | Writing the exported .md/.pdf/.txt file the user requests. |

**Remote code:** none. All code is bundled in the package; no eval, no remote scripts.
**Data usage disclosures:** none of the categories apply — no data is collected or transmitted.

## Screenshots (1280×800)

1. A cluttered news article, then the same page in reader mode side by side
2. The theme/font/width controls, with the sepia theme active
3. The export row, with a Markdown file open in Obsidian beside it
4. The honest "this doesn't look like an article" state on a dashboard-style page
5. Reader mode's dark theme on a long-form essay

## Support and privacy links

- Privacy policy: publish [PRIVACY.md](PRIVACY.md) at a stable URL
- Support: repository issues page
