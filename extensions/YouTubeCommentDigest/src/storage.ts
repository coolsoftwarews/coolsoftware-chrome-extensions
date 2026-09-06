/**
 * chrome.storage.local, used narrowly. This extension never archives a
 * comment — it is a live mirror of the current page (PRD §6), so there is
 * nothing "created" here for the user to own the way a Saver-type extension's
 * captures are theirs. The only thing worth persisting is how the panel is
 * configured, so it doesn't reset to defaults every time it opens.
 */

import { ExportFormat, SortMode } from './types';

const OPTIONS_KEY = 'ycd:options';

export interface PanelOptions {
  sortMode: SortMode;
  wordFreqOpen: boolean;
  lastExportFormat: ExportFormat;
}

export const DEFAULT_OPTIONS: PanelOptions = {
  sortMode: 'top',
  wordFreqOpen: false,
  lastExportFormat: 'md',
};

export async function readOptions(): Promise<PanelOptions> {
  try {
    const stored = await chrome.storage.local.get(OPTIONS_KEY);
    return { ...DEFAULT_OPTIONS, ...((stored?.[OPTIONS_KEY] as Partial<PanelOptions>) ?? {}) };
  } catch {
    return { ...DEFAULT_OPTIONS };
  }
}

export async function writeOptions(options: PanelOptions): Promise<void> {
  try {
    await chrome.storage.local.set({ [OPTIONS_KEY]: options });
  } catch {
    /* preferences are best-effort; never break the panel over a write failure */
  }
}

export async function clearOptions(): Promise<void> {
  try {
    await chrome.storage.local.remove(OPTIONS_KEY);
  } catch {
    /* ignore */
  }
}
