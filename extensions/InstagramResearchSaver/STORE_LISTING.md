# Chrome Web Store listing — Instagram Creator Research Saver

## Single purpose

Save Instagram posts and Reels you're viewing into a local, organized research library — with
numbers, notes and export — so nothing leaves your account and nothing leaves your device.

## Name

`Instagram Creator Research Saver`

## Short description (132 char max)

`Save Instagram posts & Reels with notes and numbers. Collections, search, CSV/Markdown/JSON export. No account, no cloud.`

## Category

Productivity → Workflow & Planning

## Detailed description

**Instagram's own Save button is a bookmark with no context. This one keeps the numbers.**

Hover any post or Reel — in a grid or open in detail view — and click **+ Save to Research**. It's
saved instantly, no navigation, no sign-in. A small card appears right after so you can drop a note or
move it to a collection, both optional and both skippable — the save already happened.

Every card keeps what you'd otherwise have to re-find later:

• Creator handle and a direct link back to the post
• Views, likes and comments as they stood when you saved it
• The full caption, and the post date
• Your note, and which collection you filed it under
• Carousels save the first slide and note how many there are

**Four collections to start, infinitely renameable**

Hooks · Competitors · Ad Ideas · Reel Ideas — rename any of them, or add your own. Search across
every caption, handle and note in the panel.

**Get it out whenever you want**

• **CSV** — one row per saved post, every field, straight into a spreadsheet
• **Markdown** — one section per post: thumbnail, numbers, caption, note, link — ready for Notion or Obsidian
• **JSON** — a full backup you can re-import later, on this machine or another one

**No account. No cloud. No network.**

This extension makes no network requests at all — verify that in devtools in about ten seconds. Your
research library lives in your browser's local storage, which cuts both ways: **Export → Import →
Clear all** are one click away in the panel, because it's on this device and nowhere else until you
say so.

**Built for**

Creators building a hook file from what's working. Agencies collecting reference for a client pitch.
Marketers tracking a competitor's angles over a campaign. Freelancers assembling a mood board that
survives closing the tab.

**Why it only asks for access to Instagram**

The save button and everything it reads only exist on instagram.com. This extension has no reason to
run anywhere else, and it doesn't ask to.

## Permission justifications (for review)

| Permission | Justification |
| :-- | :-- |
| Host access to `*.instagram.com` | The extension's entire function is capturing posts/Reels the user is already viewing on Instagram. Scoped to this one site; no broader host access is requested. |
| `activeTab` | Identifying the active Instagram tab so a save action applies to the post the user is looking at. |
| `storage` | Persisting the saved-post library, collections, notes and export preferences locally. |
| `downloads` | Writing the exported .csv/.md/.json file the user explicitly requests. |
| `sidePanel` | The research library — search, collections, export — is a side panel. |

**Remote code:** none. All code is bundled in the package; no eval, no remote scripts.
**Data usage disclosures:** no data is collected or transmitted off-device; none of the Chrome Web
Store data-usage categories apply.

## Screenshots (1280×800)

1. Instagram grid with the "+ Save to Research" pill on a hovered post
2. The save confirmation card — collection picker and inline note field
3. Side panel: cards grouped by collection, thumbnails and numbers visible
4. Search filtering across caption, handle and note
5. The "Data" sheet — CSV/Markdown/JSON export, import and clear, with the local-only message

## Support and privacy links

- Privacy policy: publish [PRIVACY.md](PRIVACY.md) at a stable URL
- Support: repository issues page
