/**
 * Which YouTube account the data we hold belongs to.
 *
 * One browser profile can be signed in to several YouTube accounts at once,
 * and `chrome.storage` knows nothing about that — it is per *browser* profile.
 * So a single store meant the second account's subscription scrape overwrote
 * the first account's channel list, and `saveChannels` then pruned every group
 * membership that was not in the new list. Groups survived; their contents did
 * not. That is data loss, and no amount of care in the UI can undo it.
 *
 * The fix is to give each account its own store, which needs a stable id for
 * "the account this page is signed in as". YouTube states it in the `ytcfg`
 * blob every page ships: `DATASYNC_ID` is the pair
 * `<delegated brand id>||<google account id>`, and it changes exactly when the
 * account does. We hash it before it ever reaches storage — we need to tell
 * accounts apart, not to know who they are.
 */

/** `"DATASYNC_ID":"113…||"` — present on every signed-in YouTube page. */
const DATASYNC_RE = /"DATASYNC_ID"\s*:\s*"([^"]+)"/;
/** A brand account's own id, when the session is acting as one. */
const DELEGATED_RE = /"DELEGATED_SESSION_ID"\s*:\s*"([^"]+)"/;
/** Which of the signed-in Google accounts this page is — `authuser=N`. */
const SESSION_INDEX_RE = /"SESSION_INDEX"\s*:\s*"?(\d+)"?/;
const LOGGED_IN_RE = /"LOGGED_IN"\s*:\s*(?:true|1)\b/;

export interface AccountIdentity {
  /** Opaque, stable, and ours — a hash, never the raw account id. */
  id: string;
  /**
   * Which signed-in account this is, as YouTube counts them.
   *
   * Kept raw because it is not an identifier, it is an *address*: a later
   * request has to be able to say "that one" and be understood. A hash would
   * be useless for that.
   */
  sessionIndex: string | null;
  /**
   * The brand account being acted as, when there is one.
   *
   * Same reasoning — YouTube's own client addresses a brand account by this
   * value, and a request that omits it is answered for the Google account
   * behind the brand, which is a different subscription list.
   */
  pageId: string | null;
}

/**
 * Read the account out of a page's own bootstrap config.
 *
 * Returns null rather than guessing: an unrecognised page must leave the
 * active account alone. Switching to a wrong-but-plausible id would split one
 * account's groups across two stores, which looks exactly like the bug this
 * exists to fix.
 */
export function readAccount(text: string): AccountIdentity | null {
  if (!LOGGED_IN_RE.test(text)) return null;

  const datasync = DATASYNC_RE.exec(text)?.[1] ?? null;
  const delegated = DELEGATED_RE.exec(text)?.[1] ?? null;
  const raw = datasync ?? delegated;
  // `"||"` is the signed-out placeholder: present, and meaningless.
  if (!raw || !/[A-Za-z0-9]/.test(raw)) return null;

  // `DATASYNC_ID` is `<brand>||<google account>` when acting as a brand, and
  // `<google account>||` when not — so the first half names a brand only when
  // something follows it. Reading it unconditionally would hand a personal
  // account's own id to `X-Goog-PageId` and address a brand that isn't there.
  const [firstHalf, secondHalf] = (datasync ?? '').split('||');
  const pageId = delegated ?? (secondHalf ? firstHalf : null);

  return {
    id: hash(raw),
    sessionIndex: SESSION_INDEX_RE.exec(text)?.[1] ?? null,
    pageId: pageId && /[A-Za-z0-9]/.test(pageId) ? pageId : null,
  };
}

/**
 * The account the live document is signed in as.
 *
 * `ytcfg` is set by an inline script near the top of the document, so the scan
 * usually ends on its first or second hit. Scripts with a `src` are skipped —
 * their text is empty here, and reading them would mean a network round trip
 * per navigation.
 */
export function readAccountFromDocument(): AccountIdentity | null {
  for (const script of document.scripts) {
    if (script.src) continue;
    const text = script.textContent;
    if (!text || !text.includes('DATASYNC_ID')) continue;
    const account = readAccount(text);
    if (account) return account;
  }
  return null;
}

/**
 * cyrb53 — a short, fast, non-cryptographic digest.
 *
 * Not a security boundary: it keeps a Google account id out of local storage
 * and bounds the key length. Two accounts colliding across 53 bits is not a
 * risk worth writing code against.
 */
function hash(value: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < value.length; i++) {
    const ch = value.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
