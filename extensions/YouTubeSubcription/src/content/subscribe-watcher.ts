/**
 * Catch the moment the user subscribes, and offer to file the channel.
 *
 * Grouping is only ever done in bulk once; after that, every new subscription
 * silently lands ungrouped and the groups rot. Catching it at subscribe time
 * is the only point where the user already knows where the channel belongs.
 *
 * We listen for clicks rather than watching attributes across the whole page:
 * one delegated capture listener costs nothing, whereas observing YouTube's
 * subscribe buttons for state changes means an observer per button on a page
 * that renders dozens of them.
 */

import { resolveChannel, toChannel } from './channel-context';
import { findSubscribeButton } from './group-button';
import { log, warn } from './debug';
import { closePicker, showGroupPicker } from './group-picker';
import { readStore, upsertChannel } from '../storage';
import { isAlive, teardown } from './lifecycle';

const SUBSCRIBE_SELECTOR = [
  'ytd-subscribe-button-renderer',
  'yt-subscribe-button-view-model',
  'ytd-button-renderer#subscribe-button',
  '#subscribe-button',
].join(',');

/** YouTube animates the button; give it a beat before reading the new state. */
const SETTLE_MS = 700;

let attached = false;

export function watchSubscribes(onOpenManager: () => void): void {
  if (attached) return;
  attached = true;

  document.addEventListener(
    'click',
    (event) => {
      // `composedPath` because the newer subscribe button lives in a shadow
      // root, where `event.target` is the host and `closest` finds nothing.
      const clicked = clickedSubscribeButton(event);
      if (!clicked) return;

      // Read the state *before* the click resolves. Deciding "did they just
      // subscribe?" from the after-state alone requires that state to be
      // readable, and it is not reliably: comparing before with after only
      // needs the *change* to be visible, which is a much weaker requirement.
      const before = isSubscribed(clicked);
      log('subscribe button clicked; subscribed before =', before);

      setTimeout(() => void maybePrompt(before, onOpenManager), SETTLE_MS);
    },
    true,
  );
}

function clickedSubscribeButton(event: MouseEvent): Element | null {
  for (const node of event.composedPath()) {
    if (!(node instanceof Element)) continue;
    const hit = node.closest?.(SUBSCRIBE_SELECTOR);
    if (hit) return hit;
  }
  return null;
}

async function maybePrompt(before: boolean, onOpenManager: () => void): Promise<void> {
  if (!isAlive()) return teardown();

  const store = await readStore();
  if (!store.promptOnSubscribe) return;

  /*
   * Re-find the button rather than reusing the clicked one.
   *
   * YouTube replaces the subscribe button when its state changes, so the
   * element we captured on click is detached a moment later — and a detached
   * node still says "Subscribe" forever. Checking it was the bug: the prompt
   * could never fire, because the thing it asked was a copy of the past.
   */
  const button = findSubscribeButton();
  if (!button) {
    warn('no subscribe button after the click — cannot tell what happened');
    return;
  }

  const after = isSubscribed(button);
  log('subscribed after =', after);

  // Only on the way *in*. Clicking an already-subscribed button opens
  // YouTube's own menu, and unsubscribing must never prompt.
  if (before || !after) {
    closePicker();
    return;
  }

  const channel = resolveChannel(button, (handle) => {
    const wanted = handle.toLowerCase();
    return store.channels.find((c) => c.handle?.toLowerCase() === wanted)?.id ?? null;
  });
  if (!channel) return;

  const known = store.channels.some((c) => c.id === channel.id);
  if (!known) await upsertChannel(toChannel(channel));

  log('offering the group picker for', channel.name);
  showGroupPicker({ channel, anchor: button, onOpenManager });
}

/**
 * Is this button in the subscribed state?
 *
 * Reads *every* label in the button, not the first one. Once you subscribe,
 * YouTube adds a notification bell inside the same container — so the first
 * `[aria-label]` descendant becomes "Notification settings", which matches
 * nothing, and the button was reported as unsubscribed forever after. That was
 * the second half of why the prompt never appeared.
 *
 * The text test is English-only by nature. On a localised UI it simply fails to
 * match, and the before/after comparison then sees no change and stays quiet —
 * a missed prompt is a minor annoyance; a prompt while unsubscribing is a bug
 * the user notices.
 */
function isSubscribed(button: Element): boolean {
  if (button.hasAttribute('subscribed')) return true;
  if (button.querySelector('[subscribed]')) return true;

  const labels = [
    button.getAttribute('aria-label') ?? '',
    ...[...button.querySelectorAll('[aria-label]')].map(
      (el) => el.getAttribute('aria-label') ?? '',
    ),
    button.textContent ?? '',
  ]
    .join(' ')
    .toLowerCase();

  return labels.includes('unsubscribe') || /\bsubscribed\b/.test(labels);
}
