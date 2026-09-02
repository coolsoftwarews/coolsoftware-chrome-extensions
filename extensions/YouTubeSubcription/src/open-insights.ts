/**
 * "Show me the charts", from the side panel.
 *
 * The charts render over a YouTube tab, because that is the tab the data is
 * about. The panel, though, opens from the toolbar anywhere — so pressing
 * Charts on a banking site has to mean something. It means: go to YouTube.
 *
 * The alternative was to grey the toggles out off-YouTube, which makes the
 * feature blink in and out depending on where you happen to be standing, or to
 * keep a full-page fallback, which is a second copy of the same charts to keep
 * working. One destination, always the same.
 *
 * Runs from extension pages only (side panel, options) — a content script may
 * not touch `chrome.tabs`.
 */

const YOUTUBE_MATCH = '*://*.youtube.com/*';
const YOUTUBE_HOME = 'https://www.youtube.com/feed/subscriptions';

export async function showInsights(): Promise<boolean> {
  const tab = (await existingTab()) ?? (await chrome.tabs.create({ url: YOUTUBE_HOME }));
  if (tab.id === undefined) return false;

  // Bring it forward first: the overlay appearing in a background tab is a
  // click that did nothing, as far as anyone watching can tell.
  await chrome.tabs.update(tab.id, { active: true });
  if (tab.windowId !== undefined) {
    await chrome.windows.update(tab.windowId, { focused: true }).catch(() => undefined);
  }

  return deliver(tab.id);
}

/**
 * Prefer a YouTube tab in this window, and the active one above the rest —
 * "the tab I was just looking at" is almost always the intended target, and
 * hijacking one in another window would be a surprise.
 */
async function existingTab(): Promise<chrome.tabs.Tab | null> {
  const current = await chrome.windows.getCurrent();
  const tabs = await chrome.tabs.query({ url: YOUTUBE_MATCH });
  if (tabs.length === 0) return null;

  return (
    tabs.find((t) => t.windowId === current.id && t.active) ??
    tabs.find((t) => t.windowId === current.id) ??
    tabs[0]
  );
}

/**
 * Ask the content script to draw, retrying while it boots — and if it never
 * answers, put a fresh one in the tab and ask again.
 *
 * Two different tabs look identical from here, because `sendMessage` rejects
 * in both: one we just created, whose script is still booting, and one that
 * was open when the extension was reloaded or updated, whose script is
 * orphaned and will never answer again. Waiting fixes the first. Only
 * injecting fixes the second, and that case is not rare — every user gets it
 * on every update, and it presents as a button that does nothing.
 *
 * Injecting is safe precisely because we only do it once nothing has answered:
 * a live script would have replied, so there is none to duplicate.
 */
async function deliver(tabId: number): Promise<boolean> {
  if (await ask(tabId, [0, 200, 500])) return true;

  try {
    await chrome.scripting.insertCSS({ target: { tabId }, files: ['content/content.css'] });
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content/index.js'] });
  } catch {
    // No `scripting` permission, a restricted page, or the tab went away.
    return false;
  }

  return ask(tabId, [0, 300, 800]);
}

async function ask(tabId: number, schedule: number[]): Promise<boolean> {
  for (const delay of schedule) {
    if (delay) await sleep(delay);
    try {
      const response = (await chrome.tabs.sendMessage(tabId, { type: 'ysg:show-insights' })) as
        | { shown?: boolean }
        | undefined;
      if (response?.shown) return true;
    } catch {
      // Not listening yet — or not any more. Either way, try again.
    }
  }
  return false;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
