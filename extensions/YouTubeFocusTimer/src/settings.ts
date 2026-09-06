/** Default hide-toggle/reminder state and a forward-compatible merge helper. */
import type { Settings } from './types';

export const DEFAULT_SETTINGS: Settings = {
  hideRecommendations: false,
  hideHomeFeed: false,
  hideShorts: false,
  hideEndScreen: false,
  hideComments: false,
  reminderMinutes: 45,
};

/**
 * Merges a possibly-partial/possibly-stale stored value over the defaults,
 * so a settings object saved by an older version of this extension (missing
 * a field added since) still loads instead of producing `undefined` toggles.
 */
export function mergeSettings(partial: Partial<Settings> | null | undefined): Settings {
  return { ...DEFAULT_SETTINGS, ...(partial ?? {}) };
}
