# Chrome Web Store listing — LinkedIn Post Draft Bank & Formatting Checker

## Name

`LinkedIn Post Draft Bank & Formatting Checker`

## Short description (132 char max)

`See exactly where LinkedIn's "see more" cutoff lands as you type, plus a local library of your own drafts, templates and posts.`

## Category

Productivity → Workflow & Planning (alt: Business Tools)

## Detailed description

**Grammarly doesn't know LinkedIn truncates your post at ~210 characters.**

Every serious LinkedIn writer optimizes their opening line around the point where LinkedIn hides the
rest of a post behind "…see more." A generic writing assistant has no idea this mechanic even exists.
This extension does one narrow thing well: while you're writing in LinkedIn's own "Start a post" box,
a small overlay shows a live character count and roughly where that cutoff tends to land — so you can
see, in real time, whether your hook survives the fold.

**A place for your own hooks and formats to live**

Save any draft or finished post as a reusable template, tag it ("hooks", "carousels", "launch posts" —
whatever makes sense to you), and search your whole library later. When you find the right template,
one click drops it straight into an open composer.

**Your own published posts, archived automatically**

Visit your own profile's "Posts" activity tab and this extension quietly builds a personal archive of
what you've actually posted — never anyone else's posts, only yours, verified against your own signed-in
profile before anything is saved.

**No AI. No account. No cloud.**

This extension makes no network requests at all, and never will — verify that yourself in ten seconds
in devtools. There is no AI writing or rewriting anywhere in it; everything you see is text you wrote
yourself. It never posts, schedules, or publishes anything — the only thing it ever writes into
LinkedIn's page is a saved template's text, and only when you click "Insert."

**Export anytime**

CSV or Markdown, filtered to what you're looking at or your whole library — plus a full JSON backup
you can move to another machine.

**Built for**

Founders and executives who post regularly and want their hook to survive the fold. Creators and
ghostwriters who want a personal swipe file without a separate notes app. Anyone who has ever lost a
half-written LinkedIn post to a closed tab.

## Permission justifications (for review)

| Permission | Justification |
| :-- | :-- |
| `activeTab` | Identifying the active LinkedIn tab so the panel can check whether a post composer is currently open. |
| `storage` | Persisting drafts, templates, archived posts, tags and export preferences locally. |
| `downloads` | Writing the exported .csv/.md file and the JSON backup the user requests. |
| `sidePanel` | The library, search, filters and export controls are a side panel. |
| Host access to `*://*.linkedin.com/*` | The extension's entire function happens on linkedin.com: showing the character-count overlay in the post composer, archiving the signed-in user's own published posts, and inserting a saved template's text into an open composer on explicit click. No other site is accessed, and no data leaves the device. |

**Remote code:** none. All code is bundled in the package; no eval, no remote scripts.
**Data usage disclosures:** none of the categories apply — no data is collected or transmitted off the
device. Everything read from linkedin.com is stored only in `chrome.storage.local`.

## Screenshots (1280×800)

1. The composer overlay: live character count and the "see more" marker while typing a post
2. The side panel: a library list with Draft/Template/Published badges and tag chips
3. Search and tag filtering across the whole library
4. "Insert into composer" landing a saved template into an open post
5. "Data" sheet — export / import / clear, with the local-only message

## Support and privacy links

- Privacy policy: publish [PRIVACY.md](PRIVACY.md) at a stable URL
- Support: repository issues page
