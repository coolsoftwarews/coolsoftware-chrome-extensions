import { clearAllData, exportBackup, importBackup } from './storage';
import { clearMetrics, distinctProfileCount, readMetrics } from './metrics';
import { MetricKey } from './types';

/** Human labels for the counters — mirrors PRD §8's success metrics. */
const LABELS: Partial<Record<MetricKey, string>> = {
  hook_panel_opened: 'Hook panel opened',
  export_csv: 'CSV exports',
  export_md: 'Markdown exports',
  filter_ratio: 'Ratio filter used',
  filter_date: 'Date filter used',
  filter_length: 'Length filter used',
  sort_changed: 'Sort changed',
  parse_failure: 'Layout parse errors',
};

async function renderMetrics(): Promise<void> {
  const list = document.getElementById('metrics');
  if (!list) return;

  const metrics = await readMetrics();
  list.replaceChildren();

  const row = (label: string, value: number): void => {
    const term = document.createElement('dt');
    term.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = String(value);
    list.append(term, dd);
  };

  row('Profiles analysed', distinctProfileCount(metrics));
  for (const [key, label] of Object.entries(LABELS)) {
    const value = metrics.counts[key as MetricKey];
    if (value) row(label as string, value);
  }
}

document.getElementById('reset-metrics')?.addEventListener('click', () => {
  void clearMetrics().then(renderMetrics);
});

function setStatus(message: string): void {
  const status = document.getElementById('status');
  if (status) status.textContent = message;
}

document.getElementById('export-data')?.addEventListener('click', () => {
  void exportBackup().then(backup => {
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const stamp = new Date().toISOString().slice(0, 10);
    chrome.downloads.download({ url, filename: `tiktok-creator-outliers-backup-${stamp}.json`, saveAs: true }, () => {
      URL.revokeObjectURL(url);
      setStatus(chrome.runtime.lastError ? 'Export failed.' : 'Backup saved.');
    });
  });
});

document.getElementById('import-data')?.addEventListener('change', event => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    void (async () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        const result = await importBackup(parsed);
        setStatus(`Imported ${result.profiles} cached profile(s).`);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : 'That file could not be imported.');
      } finally {
        input.value = '';
      }
    })();
  };
  reader.readAsText(file);
});

document.getElementById('clear-data')?.addEventListener('click', () => {
  void clearAllData().then(() => setStatus('All data cleared.'));
});

/**
 * `tab.url` is only populated for hosts we hold permission over, so anything
 * else reads as "not TikTok" without needing the broader `tabs` permission.
 */
async function checkPage(): Promise<void> {
  const gate = document.getElementById('gate');
  const intro = document.getElementById('intro');
  if (!gate || !intro) return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (/^https?:\/\/([^/]+\.)?tiktok\.com\/@/.test(tab?.url ?? '')) return;

  gate.hidden = false;
  intro.hidden = true;
}

document.getElementById('open-tiktok')?.addEventListener('click', () => {
  void chrome.tabs.create({ url: 'https://www.tiktok.com/' });
});

void checkPage();
void renderMetrics();
