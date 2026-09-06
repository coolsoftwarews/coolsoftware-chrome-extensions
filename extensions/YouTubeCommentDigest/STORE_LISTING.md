# Chrome Web Store listing — YouTube Comment Digest & Best-Comments Finder

## Name

`YouTube Comment Digest & Best-Comments Finder`

## Short description (132 char max)

`Sort, search and export YouTube comments already loaded in the page. Word-frequency digest. No account, no API, no network.`

## Category

Productivity → Tools

## Detailed description

**Find the comments that actually answer your question.**

Does this tutorial really work? Did this product review hold up? What does the audience actually
think, past the pinned comment and the first three replies? YouTube's own comment section makes you
scroll for it — this panel doesn't.

Open any video, open the panel, and the comments already loaded on the page show up sorted and
searchable:

• **Sort** by most-liked, most-replies, or newest — or leave it in YouTube's own top-comments order
• **Search** every loaded comment by keyword, live as you type
• **Load more** — one click scrolls YouTube's own comment section to pull in more, then re-indexes
• **Pinned and creator-heart comments** are marked distinctly, so you know which ones the creator
  actually engaged with
• **Word-frequency digest** — the most-repeated words and short phrases across what's loaded, plain
  counts with common stopwords filtered out. Not an AI summary — just what's actually being said,
  most often, computed entirely on your device
• **Export** what you're looking at as **Markdown** or **CSV**

**No account. No API key. No network requests.**

This isn't a comment-fetching service — it reads exactly what YouTube has already loaded into the
page in front of you, the same comments you'd see by scrolling down yourself. Nothing is fetched from
anywhere else, and nothing you read is ever sent anywhere. Verify that yourself in devtools' Network
tab in about ten seconds.

**Read-only, always.** This extension never posts, likes, or replies to anything on YouTube. It only
reads and organizes what's already there.

**Built for**

Researchers and students checking whether a tutorial's claims hold up. Buyers reading past the first
three reviews before a purchase. Creators skimming their own audience's real reaction without reading
every reply. Journalists and analysts getting a quick read on community sentiment.

## Permission justifications (for review)

| Permission | Justification |
| :-- | :-- |
| `activeTab` | Reading the comment DOM on the YouTube tab the user has open when the panel is used. |
| `storage` | Persisting sort/export preferences and anonymous local usage counters — no comment content. |
| `downloads` | Writing the exported .md/.csv file the user explicitly requests. |
| `sidePanel` | The comment list, search, sort and export controls are a side panel. |
| `*://*.youtube.com/*` host permission | Required to read the comment section on YouTube watch pages. No data is transmitted off-device. |

**Remote code:** none. All code is bundled in the package; no eval, no remote scripts.
**Data usage disclosures:** none of the categories apply — no data is collected or transmitted.

## Screenshots (1280×800)

1. Side panel open next to a video, comments sorted by "Most liked"
2. The search box filtering comments live by keyword
3. The word-frequency digest, words and phrases as chips with counts
4. A pinned comment and a creator-hearted comment, badges visible side by side
5. The export row, with a Markdown file open beside it

## Support and privacy links

- Privacy policy: publish [PRIVACY.md](PRIVACY.md) at a stable URL
- Support: repository issues page
