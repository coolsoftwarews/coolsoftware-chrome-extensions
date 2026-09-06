/**
 * Service worker. Deliberately minimal — this product has no export/save
 * feature (PRD §6: no `downloads`, no `activeTab`), so there is no relay
 * job for it to do. Its only responsibility is making sure the five
 * toggles exist in storage with their declutter-first defaults the moment
 * the extension is installed, so content.ts's very first read on the
 * user's next x.com page load already has real values rather than racing
 * readToggles()'s own in-code defaults.
 */

import { readToggles, writeToggles } from './storage';

chrome.runtime.onInstalled.addListener(async details => {
  if (details.reason !== 'install') return;
  const toggles = await readToggles(); // already falls back to DEFAULT_TOGGLES
  await writeToggles(toggles);
});
