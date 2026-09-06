/**
 * Screen Capture — local-only instrumentation.
 *
 * Counters live in chrome.storage.local and are never transmitted anywhere.
 * They exist so the PRD's success metrics can be read off a real install
 * (chrome.storage.local.get('metrics') in the extension console) without
 * breaking the "captures never leave your device" promise.
 */

export type MetricEvent =
  | `capture.${'fullPage' | 'visibleArea' | 'selectedRegion'}`
  | `capture.fail.${string}`
  | `tool.${'crop' | 'rect' | 'arrow' | 'blur' | 'text'}`
  | `export.${'png' | 'jpeg' | 'pdf'}`
  | 'export.copy';

export async function track(event: MetricEvent): Promise<void> {
  try {
    const { metrics = {} } = await chrome.storage.local.get('metrics');
    metrics[event] = (metrics[event] ?? 0) + 1;
    await chrome.storage.local.set({ metrics });
  } catch {
    // Instrumentation must never break a capture.
  }
}
