# Chrome Web Store listing — X Conversation Saver

## Name

`X Conversation Saver`

## Single purpose

> Save posts and threads the user is viewing on X to a local library — with the full thread text,
> a personal note and a collection — and let them export that library as Markdown, CSV or JSON.

## Short description (132 char max)

`Save posts and threads from X with a click. Full thread text, notes, collections. Export to Markdown, CSV or JSON. No account.`

## Category

Productivity → Workflow & Planning

## Detailed description

**X's bookmarks are a black hole. This isn't.**

Click **+ Save** on any post, or **+ Save thread** to capture a whole thread in order — the one
thing bookmarks can't do. Add a note. File it under Hooks, Prospects, Ideas or Reference (rename any
of them). Come back next week and it's all still there, searchable, even if the original post gets
deleted.

**People view.** Every saved item is also grouped by the person who posted it — "saved 6 posts from
this person" — with a note per person. Not a CRM, just enough structure to remember why you saved
someone's post in the first place.

**Get it out whenever you want**

• **Markdown** — a readable digest, threads rendered as threads, grouped by collection
• **CSV** — one row per post, for the spreadsheet users
• **JSON** — a full backup you can re-import, on this device or another one

**No account. No cloud. No network.**

This extension makes no network requests at all — verify that in devtools in about ten seconds.
Everything lives in your browser's local storage. Export everything as one file, import it back in,
or clear it all with one click.

**Built for**

Founders keeping track of the threads and people relevant to the business. Creators building a swipe
file of hooks and formats that worked. Sales people noting a prospect who posted something worth
replying to. Writers and researchers collecting source material with context intact.

**What it doesn't do**

It never posts, replies, likes, reposts or follows on your behalf — read-only, always. It never
auto-saves anything you didn't click Save on, and it never runs in the background.

## Permission justifications (for review)

| Permission | Justification |
| :-- | :-- |
| Host access to `x.com` / `twitter.com` | The extension's core function — reading a post the user is viewing and adding the "+ Save" control — only happens on these two domains. No other site is accessed, and no data is transmitted off-device. |
| `activeTab` | Identifying the active X tab so the panel and save actions target the right page. |
| `storage` | Persisting the user's saved items, collections, notes and export preferences locally. |
| `downloads` | Writing the exported .md/.csv/.json file the user requests. |
| `sidePanel` | The library, people view and export controls are a side panel. |

**Remote code:** none. All code is bundled in the package; no eval, no remote scripts.
**Data usage disclosures:** none of the categories apply — no data is collected or transmitted.

## Screenshots (1280×800)

1. A thread on X with the "+ Save · + Save thread" control visible
2. Side panel library — collections, a saved thread expanded, a note
3. People view — grouped by author with a save count and a note
4. The export row with a Markdown digest open beside it
5. The "Data" sheet — export / import / clear, with the local-only message

## Support and privacy links

- Privacy policy: publish [PRIVACY.md](PRIVACY.md) at a stable URL
- Support: repository issues page
