# Privacy Policy — TikTok Product Scout

**Last updated:** 2026-09-02

## The short version

This extension makes no network requests. Nothing you browse, track or export is ever sent
anywhere, because there is nowhere for it to be sent — there is no server, no account and no
analytics service behind this product. It only reads what TikTok has already rendered in your tab;
it never crawls, polls or fetches anything on its own.

## What is stored, and where

Everything is stored in your browser's own local storage (`chrome.storage.local`) on this device:

| Data | Why |
| :-- | :-- |
| Products you choose to track, and the videos you add to them (creator handle, view/like/comment counts, commercial markers, the video link) | This is the product board — it only exists because you built it |
| A cached median view count per creator whose profile you've visited | To compute the outlier ratio badge without re-reading their profile every time |
| A running count of videos you've viewed, and a short list of recently seen video ids | To show an honest coverage line ("from N videos you've viewed") and avoid double-counting a tile the feed recycled back into view |
| Anonymous usage counters (e.g. "products tracked: 4") | So the developer can see which features are used |

**Videos you merely scroll past are never stored.** Only videos you explicitly track with "+ Track"
on a badge are written to storage — the badge itself is computed live from the page each time.

The usage counters contain no video ids, captions or creator handles — only totals and the dates the
extension was used. They stay on your device like everything else, and **Clear all** in the product
board removes them along with your tracked products and creator baselines.

## What is never collected

No account, email address or name. No browsing history beyond the counters above. No TikTok
credentials or session data — this extension reads the page the same way you do, through your
existing logged-in session, and never touches your account (no posting, liking, following or any
other write action). No advertising or tracking identifiers. Nothing is sold, shared or transmitted,
because nothing is transmitted at all.

## What the badge shows, and what it doesn't claim

The outlier ratio badge is calculated entirely from numbers TikTok already displays — it is not a
prediction and it is not sales data. This extension never estimates revenue, GMV or units sold, and
never will: those numbers aren't visible to a browser extension, and presenting an invented one would
be the fastest way to lose your trust. Shop-link markers come from TikTok's own shop UI; caption-text
markers ("link in bio", a discount code) are pattern guesses and are always labelled as such.

## Permissions, and what each is for

| Permission | Why it is needed |
| :-- | :-- |
| `activeTab` | Lets a toolbar click reach the tab you're looking at, to toggle the product board |
| `storage` | Saving your tracked products, creator baselines and preferences locally |
| `downloads` | Saving the file when you export a CSV or Markdown summary |
| Host access to `*://*.tiktok.com/*` | Reading video tiles, counts and markers on the TikTok pages you visit — this extension does nothing on any other site |

## Your data is yours

The product board's **Backup** button writes every tracked product and creator baseline to a single
JSON file. **Import** reads it back, on this machine or another one. **Clear all** deletes everything
immediately and permanently.

Because storage is local and per-device, uninstalling the extension or clearing your browser data
removes your product board. Export a backup first if you want to keep it.

## Verifying this yourself

Open devtools on tiktok.com with the extension active and watch the Network tab — you will see no
requests from the extension. The source is auditable: no `fetch`, `XMLHttpRequest`, `WebSocket` or
`sendBeacon` call exists anywhere in it.

## Contact

Questions about this policy: raise an issue on the extension's support page.
