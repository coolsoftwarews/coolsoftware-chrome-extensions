# Chrome Web Store listing — YouTube Sign-in-Free Playlist Sorter

## Name

`YouTube Sign-in-Free Playlist Sorter`

Worth 30 minutes against live Web Store search before publishing, same as this portfolio's other
PRDs flag. Alternates that keep the "no sign-in" wedge: *Playlist Sorter — No Sign-in*, *Sort Any
YouTube Playlist*, *Instant Playlist Sorter (No Login)*.

## Short description (132 char max)

`Sort any YouTube playlist by duration, title or date — yours or anyone else's. No sign-in, no API key, nothing leaves your device.`

## Category

Productivity → Tools

## Detailed description

**Sort any playlist. Not just your own.**

Open a playlist — yours, a friend's, a stranger's public "100 best" list, a course, Watch Later — and
get it sorted by duration, title or upload date in a side panel. No dropdown of "your playlists"
required, because this doesn't ask what account you're signed into. It doesn't ask at all.

**Why no sign-in?**

Most playlist sorters go through Google's own API, which means signing in and handing over account
access just to reorder a list of video titles — and, because of how that API works, they can usually
only sort playlists *you* made. This extension reads the playlist page you already have open. That
means:

• **Works on any playlist** — yours, someone else's, a public list you just found
• **No Google sign-in, ever** — nothing to authorize, nothing to revoke later
• **No API key, no backend, no network requests at all**

**What it does**

• Sort the loaded videos by **duration**, **title (A–Z)**, **upload date**, or YouTube's own order
• **Load full playlist** — a bounded auto-scroll with a visible progress readout, because YouTube
  only renders a playlist's rows as you scroll and this extension never claims to have seen more than
  it actually loaded
• **Running total duration** of whatever's currently loaded
• **Build a set that fits N minutes** — tell it your commute length, it picks a set of videos that fit
• **Export** the sorted/filtered list as CSV or Markdown

**The honest trade-off**

Because this reads only the rendered page, a freshly opened long playlist starts with only what's
loaded — use "Load full playlist" first for an accurate total. This extension will tell you plainly
when it's stopped loading early rather than pretend a partial list is the whole thing.

**Never touches your playlist**

Sorting only changes what the panel displays. There is no code path in this extension that reorders,
edits, or removes anything from a playlist on YouTube itself — it's read-only, permanently.

## Permission justifications (for review)

| Permission | Justification |
| :-- | :-- |
| `*://*.youtube.com/*` host access | Reading the currently open playlist page's rendered content. No data is transmitted anywhere — there is no network code in this extension at all. |
| `activeTab` | Identifying which tab the side panel should read from. |
| `storage` | Persisting the user's last sort choice and time-budget value locally. |
| `downloads` | Writing the exported .csv/.md file and the JSON preferences backup the user requests. |
| `sidePanel` | The sort controls, table and export buttons are a side panel. |

**Remote code:** none. All code is bundled in the package; no eval, no remote scripts.
**Data usage disclosures:** none of the categories apply — no data is collected or transmitted, and no
account or sign-in of any kind is requested.

## Screenshots (1280×800)

1. A playlist page with the side panel open, sorted by duration
2. "Load full playlist" mid-scroll, showing the progress readout
3. The time-budget filter — "fits in 45 minutes" — with the included/excluded split
4. A public playlist that isn't the user's own, sorting normally
5. The Data sheet — export / import / clear, with the local-only message

## Support and privacy links

- Privacy policy: publish [PRIVACY.md](PRIVACY.md) at a stable URL
- Support: repository issues page
