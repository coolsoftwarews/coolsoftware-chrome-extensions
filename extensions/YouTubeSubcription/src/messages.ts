/**
 * What the extension's contexts say to each other.
 *
 * Here rather than beside either end, because both ends import it: a message
 * name defined next to its sender drags the sender's whole module — and its
 * `chrome.tabs` calls — into a content script that only needed the string.
 */

import { AccountIdentity } from './account';
import { Channel } from './types';

/** Panel → tab: "read your own subscription list". See src/tab-scrape.ts. */
export const SCRAPE_MESSAGE = 'ysg:scrape-subscriptions';

/** Tab → panel. Plain data — it crosses a message port. */
export type ScrapeResponse =
  | { ok: true; channels: Channel[]; account: AccountIdentity | null }
  | { ok: false; signedOut: boolean; message: string };
