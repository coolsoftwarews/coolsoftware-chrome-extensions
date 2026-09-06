/**
 * Service worker. Deliberately minimal: this extension has no export/import
 * (nothing worth exporting — six booleans), no in-page UI that needs a
 * chrome.downloads relay, and no per-tab state to enable or disable. The
 * only job here is writing the default toggle values once, on install, so
 * content.ts and popup.ts both find a real record in storage on first run
 * rather than each independently guessing at defaults.
 *
 * No fetch, no XMLHttpRequest, no sendBeacon, no alarms — nothing here opens
 * a network connection or runs in the background beyond this one-time setup.
 * See PRIVACY.md.
 */

import { DEFAULT_TOGGLES } from './classify';

const STORAGE_KEY = 'liff:toggles';

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  if (!stored[STORAGE_KEY]) {
    await chrome.storage.local.set({ [STORAGE_KEY]: DEFAULT_TOGGLES });
  }
});
