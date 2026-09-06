# Privacy Policy — Screen Capture

_Last updated: 15 August 2026_

Screen Capture does not collect, transmit, sell or share any user data.

## What the extension does with your screenshots

Screenshots are created, annotated and exported entirely inside your browser. They are held
in memory while you work on them and written to disk only when you choose Download, into the
folder you have configured for downloads. There is no server component, no account system and
no upload feature — the extension makes no network requests of any kind.

## What is stored on your device

Local usage counters (how many captures per mode, which editor tools were used, which export
formats) are kept in `chrome.storage.local` so the developer can be told, by users who choose
to report it, which features matter. These counters contain no page content, no URLs and no
identifiers, and they never leave your device. Uninstalling the extension deletes them.

## Permissions

- **activeTab** — capture the page you explicitly invoke the extension on. It grants no
  access to any other tab and no standing access to any site.
- **scripting** — inject the script that measures the page, scrolls it during a full-page
  capture, and draws the region-select overlay.
- **downloads** — save the finished screenshot to your Downloads folder.
- **offscreen** — composite the captured frames on a canvas.
- **storage** — keep the local counters described above.

## Contact

Questions about this policy: gabler777@gmail.com
