# Chrome Web Store listing — Universal Tab Stash & Reading-List Export

## Name

`Universal Tab Stash & Reading-List Export`

Alternates worth checking against live Web Store search before publishing: *Tab Stash — no account,
ever*, *Stash & Restore Tabs*, *Local Tab Stash*.

## Short description (132 char max)

`Save a tab set, close it, get it back later. Export as Markdown or CSV. No account, no cloud — everything stays on your device.`

## Category

Productivity → Workflow & Planning

## Detailed description

**You have 40 tabs open. Now what?**

Name them as a group, close them, and get them back — whenever you're ready. Stash all your tabs, or
pick exactly the ones you want, give the set a name and a note, and clear your window in one click.

Come back tomorrow, next week, or next quarter — the stash is still there, exactly as you left it.

• **Restore instantly** — the whole stash at once, or one tab at a time
• **Search** across every stashed tab's title and URL, across every stash you've ever saved
• **Export** any stash — or everything — as a Markdown reading list or a CSV
• **Notes per stash** — "research for Q3 project," so you remember why you saved it

**No account. No cloud. No network.**

Most tab managers eventually want you to sign up so your tab sets sync through their server. This one
doesn't ask, because it can't: it makes no network requests at all. Your stashes live in your
browser's local storage, and you can verify that in devtools in about ten seconds.

That cuts both ways, so the tools to own your data are built in: export every stash as one JSON file,
import it back on another machine, or wipe everything with one click.

**Built for**

Anyone mid-context-switch who needs 15 tabs gone right now, but not gone-gone. Research-heavy
knowledge workers saving a project's worth of open threads. Students keeping a term's reading
organized per class. Online shoppers saving a comparison-shopping set before they buy. Anyone who
wants tab decluttering without handing a browsing snapshot to a cloud account.

**Why the permissions are this short**

This extension asks for exactly four permissions — `tabs`, `storage`, `downloads`, `sidePanel` — and
nothing else. No access to what's on any page, because it never looks: it only reads a tab's title,
URL and favicon through the browser's own tab list, the same information already visible in your tab
strip. No host permission of any kind.

## Permission justifications (for review)

| Permission | Justification |
| :-- | :-- |
| `tabs` | Reading the current window's open tabs when the user chooses to stash them, and opening/closing tabs on restore or on explicit close-after-stash. Triggered only by direct user action — no background polling. |
| `storage` | Persisting stashes and notes locally. |
| `downloads` | Writing the exported .md/.csv file and the JSON backup the user requests. |
| `sidePanel` | The stash list, search and export controls are a side panel. |

**Host permissions:** none requested. **Remote code:** none. All code is bundled in the package; no
eval, no remote scripts. **Data usage disclosures:** none of the categories apply — no data is
collected or transmitted.

## Screenshots (1280×800)

1. Side panel with several stashes listed, one expanded showing its tabs
2. The "New stash" tab picker, with pinned tabs visibly unchecked by default
3. The restore confirmation dialog on a 40+ tab stash
4. A Markdown export open next to the panel
5. The "Data" sheet — export / import / clear, with the local-only message

## Support and privacy links

- Privacy policy: publish [PRIVACY.md](PRIVACY.md) at a stable URL
- Support: repository issues page
