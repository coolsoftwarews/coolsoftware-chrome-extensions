# Chrome Web Store listing — X Card Exporter

## Name

`X Card Exporter — Save Posts as Images`

## Short description (132 char max)

`Turn any X post or thread into a clean PNG card. Rendered on your device — no upload, no account, no server, ever.`

## Category

Productivity → Workflow & Planning

## Detailed description

**Turn a post into a picture, instantly.**

See a post worth keeping? Click the image icon next to it. A clean, branded card appears — the
author, their avatar, the text, the date — ready to download as a PNG in under a second.

**Three looks, one click each**

• **Light** — clean white card with the metrics row (replies, reposts, likes)
• **Dark** — same layout, dark background
• **Minimal** — a plain pull-quote look, no metrics row, for when the numbers aren't the point

Your last-used style is remembered for next time.

**Threads too**

Reading a thread? "Save thread as images" walks it from wherever you are and downloads one clean
card per post — no need to screenshot each reply by hand.

**No upload. No account. No server. Ever.**

Every other "tweet to image" tool works the same way: you give it a link, it fetches the post on
*its* server, renders it there, and hands you back a file. That's a real product, and a slower, less
private one. This one draws the card on your own device from what your browser already loaded —
nothing is ever sent anywhere, because there is no server behind this product to send it to. Verify
it yourself in about ten seconds: open devtools, export a card, watch the Network tab.

**Built for**

Creators pulling a good post into a slide, a newsletter or another platform. Founders grabbing a
customer compliment or a milestone tweet for a build-in-public recap. Anyone who wants a clean image
of a post they're already reading, right now, without opening a separate site.

## Permission justifications (for review)

| Permission | Justification |
| :-- | :-- |
| `activeTab` | Lets the toolbar popup read the current tab's context |
| `storage` | Saves the user's last-used card style and local, anonymous usage counters — both stay on-device |
| `downloads` | Writes the exported PNG file(s) the user explicitly requests |
| Host access: `x.com`, `twitter.com` | The "Save as image" control only needs to run on these two domains |

**Remote code:** none. All code is bundled in the package; no eval, no remote scripts.
**Data usage disclosures:** none of the categories apply — no data is collected or transmitted.

## Screenshots (1280×800)

1. A tweet on the X timeline with the "Save as image" icon visible in its action row
2. The export panel open: live preview, the three template buttons, Download PNG
3. Side-by-side of the same post exported in Light, Dark and Minimal
4. A thread being exported — "Downloaded 3 of 5…" status visible
5. The toolbar popup: usage counters, last-used style, Clear local data

## Support and privacy links

- Privacy policy: publish [PRIVACY.md](PRIVACY.md) at a stable URL
- Support: repository issues page
