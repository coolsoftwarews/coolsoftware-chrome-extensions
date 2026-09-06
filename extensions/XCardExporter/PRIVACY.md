# Privacy Policy — X Card Exporter

**Last updated:** 2026-09-02

## The short version

This extension makes no network requests. The post you're exporting is never sent anywhere — there
is no server behind this product, and there never will be (see the PRD's own hypothesis for why:
that's the entire point of building this client-side rather than the way every other "tweet to
image" tool works).

## What actually happens when you click "Save as image"

The card is drawn on your device from what your browser has already loaded: the post's author name,
handle, avatar image, text, date and (depending on the style you pick) its reply/repost/like counts
— all read directly from the X page you're already looking at. That drawing happens in a `<canvas>`
element that never leaves your browser tab, and the resulting PNG is saved straight to your Downloads
folder via Chrome's own download API. At no point does this extension fetch a post from anywhere,
call any API, or transmit anything.

The avatar image is drawn from the same address (`pbs.twimg.com`) the X page itself already loaded
it from — it is never re-hosted, downloaded to a server, or sent anywhere else.

## What is stored, and where

Almost nothing. Everything lives in your browser's own local storage (`chrome.storage.local`) on
this device:

| Data | Why |
| :-- | :-- |
| Your last-used card style (Light / Dark / Minimal) | So it's pre-selected next time |
| Anonymous usage counters (cards exported, threads exported, template used, how often the avatar fallback was needed, export failures) | So the developer can see which features are used and whether the avatar-loading approach described below is working in practice |

There is no saved library of exported cards. Unlike most other extensions in this developer's
portfolio, an export that isn't downloaded immediately is gone by design — the PNG file you download
*is* the product's entire output, there is nothing else being kept.

## What is never collected

No account, email address or name. No browsing history. No record of which posts you've exported,
their text, or their authors — the usage counters above are totals only (e.g. "cards exported: 12"),
never content. No advertising or tracking identifiers. Nothing is sold, shared or transmitted,
because nothing is transmitted at all.

## Permissions, and what each is for

| Permission | Why it is needed |
| :-- | :-- |
| `activeTab` | Lets the extension's own popup act on the X tab you're viewing |
| `storage` | Saving your last-used template and the local usage counters, both on this device only |
| `downloads` | Saving the PNG file(s) when you export a card or a thread |
| Host access to `x.com` and `twitter.com` | The "Save as image" button only needs to appear on those two domains — it is not requested for any other site |

## A note on the avatar image and canvas security

Browsers block a canvas from exporting an image if it drew a cross-origin picture (like a post's
avatar) without that image explicitly allowing it. When that happens, this extension does not fail
or show a broken file — it quietly re-renders the same card with a plain initials circle in place of
the avatar and exports that instead. Either way, nothing about the avatar image is ever uploaded,
fetched by a server, or stored — it is either drawn from the copy already in your browser tab, or not
drawn at all.

## Your data is yours

**Clear local data**, in the toolbar popup, deletes your saved template preference and usage counters
immediately and permanently. There is no export/import for this product, because there is no saved
content beyond those two small settings to take out — everything you've actually created (the
exported cards) is already sitting in your Downloads folder as a normal PNG file.

## Verifying this yourself

Open devtools on x.com with the extension active and watch the Network tab while exporting a card —
you will see no requests from the extension. The source is auditable: no `fetch`, `XMLHttpRequest`,
`WebSocket` or `sendBeacon` call exists anywhere in it, and `scripts/selftest.mjs` enforces this
automatically on every build.

## Contact

Questions about this policy: raise an issue on the extension's support page.
