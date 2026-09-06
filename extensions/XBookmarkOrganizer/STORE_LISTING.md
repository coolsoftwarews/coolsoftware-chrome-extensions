# Chrome Web Store listing — X Bookmark Organizer

## Name

`X Bookmark Organizer`

## Single purpose

> Organize and search the user's own X Bookmarks page locally — folders, tags and a personal note per
> bookmark — and let them export that library as Markdown, CSV or JSON. Read-only: never modifies
> bookmarks on X.

## Short description (132 char max)

`Organize and search your X bookmarks locally. Folders, tags, notes. Export to Markdown, CSV or JSON. No account, no sync.`

## Category

Productivity → Workflow & Planning

## Detailed description

**X's Bookmarks tab is where good posts go to die. This gives them a second life — on your device,
under your control.**

Open your Bookmarks page on X and scroll — this extension quietly indexes what's rendered as you go.
File anything into a folder, tag it, add a note. Come back next month and search across all of it —
text, author, tags, notes — even if the original post gets deleted.

**Honest about what it can see.** This is not an API integration and it never asks you to connect an
account. It indexes what X has rendered on your own Bookmarks page as you scroll it — or during a
bounded "Re-index" pass you trigger yourself. Scroll further (or hit Re-index) to add more. That's
the whole trade: no account, no cloud, no trust handed to a third party — in exchange for building
your index gradually rather than getting your whole history on day one.

**Get it out whenever you want**

• **Markdown** — a readable digest, grouped by folder
• **CSV** — one row per bookmark, for the spreadsheet users
• **JSON** — a full backup you can re-import, on this device or another one

**No account. No cloud. No network. No sync with X.**

This extension makes no network requests at all — verify that in devtools in about ten seconds.
Deleting a bookmark here does not un-bookmark it on X — this stays permanently read-only. Everything
lives in your browser's local storage. Export everything as one file, import it back in, or clear it
all with one click.

**Built for**

Creators rediscovering a swipe file buried in hundreds of old bookmarks. Researchers keeping a
working, searchable archive of sourced posts without a vendor relationship. Founders and operators
who want bookmark structure without connecting a third-party tool to their X account. Anyone whose
Bookmarks tab has quietly become unusable.

**What it doesn't do**

It never un-bookmarks, posts, replies, likes, reposts or follows on your behalf — read-only, always.
It never runs in the background, and it never asks you to sign in anywhere.

## Permission justifications (for review)

| Permission | Justification |
| :-- | :-- |
| Host access to `x.com` / `twitter.com` | The side panel's search/organize surface works from any tab on these domains; the indexing content script itself is injected only on the Bookmarks page (`/i/bookmarks`). No other site is accessed, and no data is transmitted off-device. |
| `activeTab` | Identifying the active tab so the panel and the Re-index action target the right page. |
| `storage` | Persisting the user's indexed bookmarks, folders, tags, notes and export preferences locally. |
| `downloads` | Writing the exported .md/.csv/.json file the user requests. |
| `sidePanel` | The library, search, filters and export controls are a side panel. |

**Remote code:** none. All code is bundled in the package; no eval, no remote scripts.
**Data usage disclosures:** none of the categories apply — no data is collected or transmitted.

## Screenshots (1280×800)

1. The Bookmarks page on X with the small "Indexed N bookmarks so far" status pill visible
2. Side panel library — folders, a bookmark card with tags and a note
3. Search in action, filtered by folder and tag
4. The Re-index button mid-pass, with progress in the status line
5. The "Data" sheet — export / import / clear, with the local-only message

## Support and privacy links

- Privacy policy: publish [PRIVACY.md](PRIVACY.md) at a stable URL
- Support: repository issues page
