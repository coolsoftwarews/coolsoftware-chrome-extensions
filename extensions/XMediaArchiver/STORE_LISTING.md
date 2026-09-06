# Chrome Web Store listing — X Media Archiver

## Name

`X Media Archiver`

## Single purpose

> Save the photos and videos from the logged-in user's own X posts to their device, via
> `chrome.downloads`. The Save control only ever appears on a post the logged-in account authored —
> including correctly resolving reposts and quote-tweets to their *original* author — never on
> anyone else's content.

## Short description (132 char max)

`Save photos and videos from your own X posts to your device. Own content only, enforced automatically.`

## Category

Productivity → Workflow & Planning

## Detailed description

**X has no bulk "download my media" button. This is that button — restricted to your own posts.**

X's official "Download an archive of your data" tool is slow (can take days), bundles everything into
one all-or-nothing dump, and isn't built for "I just need this one photo/video back." This extension
does the narrower, more useful thing: click Save on a post's action row, and the exact image or video
file X's own page already loaded downloads straight to your device — no re-encoding, no re-hosting.

**Your own content, and only your own content.**

The Save button is gated: it reads your logged-in handle from X's own interface and the specific
post's own author, and only renders on a match. That check is correct even for the cases that trip up
a naive version of this idea:

- **A repost of someone else's content** — no Save button, because the check looks at the *original*
  author, not the account that reposted it into your timeline.
- **A quote-tweet of someone else's post** — the quoted post's media is checked against the quoted
  author, not you, even on your own quote-tweet. If you attached your own image to the quote, that
  one is offered; the quoted post's media is not.

This isn't a policy note in fine print — it's how the extension is built. There is no setting, no
toggle, no "advanced mode" that offers Save on a post you didn't author.

**What you get**

- Images, including multi-image posts — Save each one individually, or one click for "Save all"
- Video — the highest-bitrate source the page actually loaded, never a preview/poster frame
- A local log of everything you've saved (post URL, date, media type, filename), exportable as CSV or
  JSON, clearable any time

**No account. No cloud. No server.**

This extension makes no network requests of its own beyond the download itself — verify that in
devtools in about ten seconds. Everything else lives in your browser's local storage, on this device
only.

**Built for**

Creators and small businesses who lost the original file behind a post they made months ago. Anyone
who wants their own photo or video back without requesting (and waiting on) a full account export.

**What it doesn't do**

It never offers to save anyone else's content, under any setting. It never crawls your profile in
bulk — this is a per-post tool, triggered from a post you're already viewing. It never posts, edits or
deletes anything on X.

## Permission justifications (for review)

| Permission | Justification |
| :-- | :-- |
| Host access to `x.com` / `twitter.com` | The Save control is injected only on these two domains; no other site is accessed, and no data is transmitted off-device |
| `activeTab` | Identifying the active tab the Save action targets |
| `storage` | Persisting the user's local save log (post URL, date, media type, filename) on this device only |
| `downloads` | Saving the media file the user explicitly requests via Save, and the CSV/JSON log export |

**Remote code:** none. All code is bundled in the package; no eval, no remote scripts.
**Data usage disclosures:** none of the categories apply — no data is collected or transmitted.

## Screenshots (1280×800)

1. A post on X's timeline with the Save button visible in its action row, next to an image
2. A multi-image post with per-image Save buttons and one "Save all" button
3. A repost of someone else's content showing *no* Save button, alongside the user's own post showing one
4. The popup's saved-media log with Export CSV / Export JSON / Clear all
5. A video post's Save button, with the downloaded file open in a file browser

## Support and privacy links

- Privacy policy: publish [PRIVACY.md](PRIVACY.md) at a stable URL
- Support: repository issues page
