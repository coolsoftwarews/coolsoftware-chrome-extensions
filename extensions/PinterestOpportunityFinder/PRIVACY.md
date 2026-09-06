# Privacy Policy — Pinterest Opportunity Finder

**Last updated:** 2026-09-02

## The short version

This extension makes no network requests. Nothing it reads from a Pinterest search, and nothing you
export, is ever sent anywhere, because there is nowhere for it to be sent — there is no server, no
account and no analytics service behind this product.

## What is stored, and where

Everything is stored in your browser's own local storage (`chrome.storage.local`) on this device:

| Data | Why |
| :-- | :-- |
| Your last filter settings (min ratio, domain, text overlay, last N) | So the panel remembers them next time |
| A cached median save count per search query, and when it was computed | Shown in the panel before a fresh scan completes |
| Anonymous usage counters (e.g. "export_pins_csv: 4") | So the developer can see which features are used |

The usage counters contain no search terms, no pin titles, no domains and no identifiers. Where a
counter needs to recognise "the same search again" (for the "searches analysed" count), it stores a
one-way hash of the query text, never the text itself. Counters stay on your device like everything
else, and you can read them in the popup under **Usage** and reset them there at any time.

## What is never collected

No account, email address or name. No pin content, save counts, titles or images are ever stored or
transmitted — they are read from the page each time you open the popup and discarded when you close
it, except for the small cached median described above. No advertising or tracking identifiers.
Nothing is sold, shared or transmitted, because nothing is transmitted at all.

## Permissions, and what each is for

| Permission | Why it is needed |
| :-- | :-- |
| `activeTab` | Lets the popup ask the active tab's content script for the current search's data, only while you have the popup open. |
| `storage` | Saving your filter preferences, cached medians and usage counters locally. |
| `downloads` | Saving the file when you export a CSV or Markdown report. |
| Pinterest host access (`pinterest.com` and its regional domains — `.co.uk`, `.de`, `.fr` and others) | The extension's content script reads the pin cards already rendered on a Pinterest search page. It cannot function without seeing that page's content, and it accesses no other site. |

## Your data is yours

**Data → Export all data** writes your filters and cached medians to a single JSON file. **Import**
reads it back, on this machine or another one. **Clear all data** deletes everything immediately and
permanently. None of this affects your actual Pinterest account, boards or pins — the extension never
writes anything back to Pinterest.

Because storage is local and per-device, uninstalling the extension or clearing your browser data
removes this local data. Export a backup first if you want to keep it.

## Verifying this yourself

Open devtools on a Pinterest search page with the extension active and watch the Network tab — you
will see no requests from the extension. The source is auditable: no `fetch`, `XMLHttpRequest`,
`WebSocket` or `sendBeacon` call exists anywhere in it.

## Contact

Questions about this policy: raise an issue on the extension's support page.
