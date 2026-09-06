/**
 * Popup: usage counters + last-used template + a "Clear local data" action
 * (README's data-ownership constraint). No export/import — see storage.ts's
 * own comment on why this product has nothing to take out beyond what's
 * already in the two fields shown here.
 */

import { readPreferences, readUsage, clearAllData } from './storage';
import { TEMPLATES } from './templates';

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el;
}

async function render(): Promise<void> {
  const [prefs, usage] = await Promise.all([readPreferences(), readUsage()]);
  $('xce-cards-exported').textContent = String(usage.cardsExported);
  $('xce-threads-exported').textContent = String(usage.threadsExported);
  $('xce-last-template').textContent = TEMPLATES[prefs.lastTemplate].label;
}

function wireClear(): void {
  const btn = $('xce-clear-btn') as HTMLButtonElement;
  const status = $('xce-clear-status');
  btn.addEventListener('click', () => {
    void (async () => {
      btn.disabled = true;
      try {
        await clearAllData();
        status.textContent = 'Cleared.';
        await render();
      } catch {
        status.textContent = "Couldn't clear local data — try again.";
      } finally {
        btn.disabled = false;
      }
    })();
  });
}

wireClear();
void render();
