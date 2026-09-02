/**
 * Surviving our own death.
 *
 * When the extension is reloaded or updated, the content scripts already
 * running in open tabs are orphaned: their JavaScript keeps executing, but
 * every `chrome.*` call throws "Extension context invalidated". Nothing puts
 * them out of their misery, so a stale script keeps answering clicks — and
 * throwing — until the page is reloaded. That is what an "Extension context
 * invalidated" error against a group button is.
 *
 * This is not only a development annoyance: every user gets it on every
 * extension update, and what they see is an interface that has silently
 * stopped working.
 *
 * So: check before acting, and when we find ourselves orphaned, remove our own
 * UI and stop. YouTube is then exactly as it was before we loaded, and a page
 * reload brings the new version in cleanly.
 */

const teardowns: Array<() => void> = [];
let dead = false;

/** Register something to undo when the extension context goes away. */
export function onTeardown(fn: () => void): void {
  teardowns.push(fn);
}

/**
 * Is our extension context still valid?
 *
 * `chrome.runtime.id` is the cheapest reliable probe: it is undefined in an
 * orphaned context, and reading it never throws in a live one.
 */
export function isAlive(): boolean {
  if (dead) return false;
  try {
    return Boolean(chrome.runtime?.id);
  } catch {
    return false;
  }
}

/**
 * Remove every trace of this content script. Idempotent, and safe to call from
 * anywhere that has just discovered the context is gone.
 */
export function teardown(): void {
  if (dead) return;
  dead = true;
  console.log(
    '[subscription-groups] extension was reloaded or updated — ' +
      'removing this page’s stale copy. Reload the tab to use the new version.',
  );
  for (const fn of teardowns.splice(0)) {
    try {
      fn();
    } catch {
      // A failed cleanup must not prevent the others.
    }
  }
}

/**
 * Run something that touches `chrome.*`, tearing down instead of throwing if
 * we have been orphaned. Returns false when the action did not run.
 */
export function ifAlive(fn: () => void): boolean {
  if (!isAlive()) {
    teardown();
    return false;
  }
  try {
    fn();
    return true;
  } catch (err) {
    if (String(err).includes('Extension context invalidated')) {
      teardown();
      return false;
    }
    throw err;
  }
}
