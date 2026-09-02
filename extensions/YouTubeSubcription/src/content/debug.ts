/**
 * Development logging.
 *
 * A content script on someone else's page cannot be debugged by reading the
 * console — YouTube and every other extension are shouting into it already
 * (the 403s and `Timeout waiting for element` lines you'll see there are not
 * ours). So every line we write is prefixed, which makes it filterable, and
 * silenceable with `localStorage.ysgDebug = '0'`.
 */

const PREFIX = '[subscription-groups]';

/**
 * Off by default: logging on someone else's page is rude, and it advertises
 * how the internals work to anyone reading their console. Turn it on per tab
 * with `localStorage.ysgDebug = '1'`, then reload.
 */
let enabled = false;
try {
  enabled = localStorage.getItem('ysgDebug') === '1';
} catch {
  // Storage access can throw in a partitioned context; the default stands.
}

/**
 * Whether anything would be printed.
 *
 * Exported because a call to `log()` still *evaluates its arguments* when
 * logging is off, and some of ours cost real work — scanning every
 * unidentified tile for a byline, once per animation frame, to build a string
 * nobody was going to read. Guard those call sites with this.
 */
export function isDebug(): boolean {
  return enabled;
}

export function log(...args: unknown[]): void {
  if (enabled) console.log(PREFIX, ...args);
}

export function warn(...args: unknown[]): void {
  if (enabled) console.warn(PREFIX, ...args);
}

/**
 * The one line that is *not* opt-in.
 *
 * It answers the first question in any bug report — is the content script
 * running at all? — which cannot be answered by a flag the reporter has to set
 * before reproducing. One line per page load is a fair price for that.
 */
export function banner(): void {
  console.log(`${PREFIX} loaded on ${location.pathname}`);
}

/**
 * The other line that is not opt-in.
 *
 * Same reasoning as `banner`, for facts a bug report cannot be filed without:
 * which YouTube account this page reported itself as decides which groups the
 * panel shows, and getting it wrong looks like the groups were lost.
 */
export function note(...args: unknown[]): void {
  console.log(PREFIX, ...args);
}
