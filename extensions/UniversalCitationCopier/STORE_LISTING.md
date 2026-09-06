# Chrome Web Store listing — Universal Citation & Link Copier

## Name

`Universal Citation & Link Copier`

## Short description (132 char max)

`Copy this page as a Markdown link or an APA/MLA/Chicago citation. One shortcut, no account, no cloud — nothing leaves your device.`

## Category

Productivity → Tools

## Detailed description

**One shortcut. A perfectly formatted reference, every time.**

You're reading a source. You need it in your paper, your notes, or a "further reading" list — and
you need it *right now*, not after opening a citation manager and starting a new project for one
link.

Press the shortcut, or click the toolbar icon, and copy the current page as:

• **A Markdown link** — `[Title](URL)`, straight into Obsidian, Notion, Logseq or an AI chat
• **A plain URL** — just the link, cleaned of tracking parameters
• **APA** — `Author. (Year, Month Day). Title. Site. URL`
• **MLA** — `Author. "Title." Site, Day Month Year, URL.`
• **Chicago** — `Author. "Title." Site. Month Day, Year. URL.`

The popup shows a live preview of all five before you copy anything. Whichever one you use becomes
the shortcut's default — press it again on the next page and it's on your clipboard instantly, no
popup, no clicking.

**No account. No cloud. No network.**

Everything is read from the page already open in your tab and formatted right there. Nothing is
uploaded, nothing is saved to a server, because there is no server. You can verify that in devtools
in about ten seconds.

**Built for**

Students and academic writers who need a citation while reading the source, not after. Bloggers and
writers building a source list while drafting. Obsidian/Notion/Logseq users who want a clean Markdown
link instead of a bare pasted URL. Anyone who's tired of retyping "Author, Title, Site, Date" by hand
and getting the punctuation wrong.

**What this is not**

Not a citation manager. It doesn't save, organize, or build a bibliography across a research project
— it copies *this page*, right now, and gets out of your way. If you need a library, you want Zotero;
if you need one clean citation for the source in front of you, that's this.

**Why it needs access to all sites**

A citation tool that only works on an approved list of sites isn't very useful. That permission is
what lets the current page's metadata be read wherever you're reading — it grants no ability to send
anything anywhere, because there is no code in this extension that opens a network connection.

## Permission justifications (for review)

| Permission | Justification |
| :-- | :-- |
| `<all_urls>` host access | The extension's core function is reading `<meta>` tags on the current, user-chosen page to build a citation. This is not possible with a site allowlist. No data is transmitted off-device. |
| `activeTab` / `scripting` | Reading the active page's title, canonical URL and metadata at the moment the user requests a citation. |
| `storage` | Remembering the user's last-used citation format locally, so the keyboard shortcut can reuse it. |
| `offscreen` | Provides a document context so the background script can write the copied text to the clipboard when the keyboard shortcut is used (a service worker has no document of its own). No other purpose. |

**Remote code:** none. All code is bundled in the package; no eval, no remote scripts.
**Data usage disclosures:** none of the categories apply — no data is collected or transmitted.

## Screenshots (1280×800)

1. The toolbar popup open on a news article, showing all five format previews
2. A "Copied" confirmation on one of the format rows
3. A Markdown link pasted into a notes app right after copying
4. The keyboard shortcut in `chrome://extensions/shortcuts`, next to the toolbar icon showing its
   success badge
5. An APA citation copied and pasted into a document draft

## Support and privacy links

- Privacy policy: publish [PRIVACY.md](PRIVACY.md) at a stable URL
- Support: repository issues page
