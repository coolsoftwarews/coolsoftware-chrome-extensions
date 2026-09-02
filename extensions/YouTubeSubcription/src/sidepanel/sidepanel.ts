/**
 * The side panel — the primary home for the manager.
 *
 * It beats both surfaces it replaced. Against the popup: it stays open while
 * you browse, so filing channels as you go is not a sequence of open-click-
 * close. Against the modal overlay it replaced: it sits *beside* the page
 * instead of on top of it, so the feed you are organising stays visible and
 * playing — a stronger reading of "never make the user leave the tab".
 */

import { MANAGER_STYLES, mountManager, openSubscriptionFeed } from '../manager/manager';

const style = document.createElement('style');
style.textContent = MANAGER_STYLES;
document.head.append(style);

const host = document.getElementById('host') as HTMLElement;

/**
 * Whether the tab in front of the panel is a YouTube tab.
 *
 * `tab.url` is only populated for hosts we hold permission over, so a tab on
 * any other site reports `undefined` and reads as "not YouTube" — which is the
 * answer we want. That is why this needs no "tabs" permission: we are not
 * reading the user's browsing, we are asking whether the one thing we are
 * allowed to see is in front of us.
 */
async function onYouTube(): Promise<boolean> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return /^https?:\/\/([^/]+\.)?youtube\.com\//.test(tab?.url ?? '');
  } catch {
    // Never let a tab query decide the panel is unusable. Mounting the manager
    // on a wrong guess costs nothing; withholding it strands the user.
    return true;
  }
}

let mounted = false;

/**
 * Mount once, and never unmount.
 *
 * The gate is an entry condition, not a guard: once the manager is up, walking
 * away from YouTube for a moment should not tear down a half-finished sort and
 * throw away scroll, search text and selection. Anything that genuinely needs
 * the page — the feed filter, the insights window — already reports its own
 * absence.
 */
function mount(): void {
  if (mounted) return;
  mounted = true;
  host.replaceChildren();
  host.classList.remove('host--gate');
  mountManager({ container: host });
}

/**
 * The panel's own empty state, for a panel opened away from YouTube.
 *
 * Rendering the full manager here would be a shell around nothing: no feed to
 * filter, no channel to file, and a Refresh button whose result you cannot
 * see. One sentence and the button that fixes it is the whole screen.
 */
function renderGate(): void {
  if (mounted || host.classList.contains('host--gate')) return;
  host.classList.add('host--gate');

  const icon = document.createElement('img');
  icon.src = '../icons/icon128.png';
  icon.alt = '';
  icon.className = 'gate__icon';

  const title = document.createElement('h1');
  title.className = 'gate__title';
  title.textContent = 'Open YouTube to get started';

  const body = document.createElement('p');
  body.className = 'gate__body';
  body.textContent =
    'This panel organises the YouTube page beside it — grouping your subscriptions, filtering the feed and charting what your channels post. Open YouTube and it fills in.';

  const button = document.createElement('button');
  button.className = 'gate__button';
  button.type = 'button';
  button.textContent = 'Open YouTube';
  button.addEventListener('click', () => void openSubscriptionFeed());

  host.replaceChildren(icon, title, body, button);
}

async function sync(): Promise<void> {
  if (mounted) return;
  if (await onYouTube()) mount();
  else renderGate();
}

// Three ways the answer changes: another tab is selected, the tab in front
// navigates to or away from YouTube, or another window takes focus.
chrome.tabs.onActivated.addListener(() => void sync());
chrome.tabs.onUpdated.addListener((_id, change) => {
  if (change.url || change.status === 'complete') void sync();
});
chrome.windows.onFocusChanged.addListener(() => void sync());

void sync();
