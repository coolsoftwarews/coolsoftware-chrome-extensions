/**
 * chrome.storage.local is the whole backend, and there is very little in it:
 * a template preference and local-only usage counters (PRD S4 - there is no
 * card library in V1, an export that isn't downloaded is gone). No
 * export/import is offered for this reason: unlike every other Saver-shaped
 * extension in this portfolio, there is no user-created content sitting in
 * storage to take out - the PNG file the user just downloaded already *is*
 * the export. A "Clear local data" action is still provided (README's data-
 * ownership constraint), documented in PRIVACY.md.
 */

import { Preferences, TemplateId, UsageCounters, UsageEvent } from './types';
import { DEFAULT_TEMPLATE, isTemplateId } from './templates';

const PREFS_KEY = 'xce:prefs';
const USAGE_KEY = 'xce:usage';

const EMPTY_USAGE: UsageCounters = {
  cardsExported: 0,
  threadsExported: 0,
  avatarFallbacks: 0,
  exportFailures: 0,
  byTemplate: { light: 0, dark: 0, minimal: 0 },
};

export async function readPreferences(): Promise<Preferences> {
  const stored = await chrome.storage.local.get(PREFS_KEY);
  const raw = stored?.[PREFS_KEY] as Partial<Preferences> | undefined;
  const lastTemplate: TemplateId = isTemplateId(raw?.lastTemplate) ? raw!.lastTemplate! : DEFAULT_TEMPLATE;
  return { lastTemplate };
}

export async function writeLastTemplate(templateId: TemplateId): Promise<void> {
  await chrome.storage.local.set({ [PREFS_KEY]: { lastTemplate: templateId } satisfies Preferences });
}

export async function readUsage(): Promise<UsageCounters> {
  const stored = await chrome.storage.local.get(USAGE_KEY);
  const raw = stored?.[USAGE_KEY] as Partial<UsageCounters> | undefined;
  return {
    ...EMPTY_USAGE,
    ...raw,
    byTemplate: { ...EMPTY_USAGE.byTemplate, ...(raw?.byTemplate ?? {}) },
  };
}

/** Best-effort counter write - a metrics failure must never block or fail
 *  the export itself (same rule as every other extension's metrics.ts). */
export async function recordUsage(event: UsageEvent, templateId?: TemplateId): Promise<void> {
  try {
    const usage = await readUsage();
    switch (event) {
      case 'export_single':
        usage.cardsExported += 1;
        break;
      case 'export_thread':
        usage.threadsExported += 1;
        break;
      case 'avatar_fallback':
        usage.avatarFallbacks += 1;
        break;
      case 'export_failed':
        usage.exportFailures += 1;
        break;
    }
    if (templateId) usage.byTemplate[templateId] = (usage.byTemplate[templateId] ?? 0) + 1;
    await chrome.storage.local.set({ [USAGE_KEY]: usage });
  } catch {
    /* never let a counter write break an export */
  }
}

export async function clearAllData(): Promise<void> {
  await chrome.storage.local.remove([PREFS_KEY, USAGE_KEY]);
}
