/**
 * "Open the manager", from inside the page.
 *
 * The side panel is the destination and the only one: it sits beside the page
 * rather than over it, so the feed stays visible and whatever is playing keeps
 * playing. The in-page overlay that used to back this up is gone — the panel
 * opens reliably, and a second full copy of the manager was a second thing to
 * keep working for no gain.
 *
 * A content script cannot open the panel itself; only extension contexts may.
 * So we ask the service worker, which must in turn be inside a user gesture —
 * the click that got us here.
 */

import { log, warn } from './debug';
import { isAlive, teardown } from './lifecycle';

export async function openManager(): Promise<void> {
  if (!isAlive()) {
    teardown();
    return;
  }

  try {
    const response = (await chrome.runtime.sendMessage({ type: 'ysg:open-panel' })) as
      | { opened?: boolean }
      | undefined;

    if (response?.opened) {
      log('opened side panel');
      return;
    }
    warn('the side panel refused to open');
  } catch (err) {
    // Usually an orphaned content script after an extension update.
    warn('could not reach the service worker', err);
    if (!isAlive()) teardown();
  }
}
