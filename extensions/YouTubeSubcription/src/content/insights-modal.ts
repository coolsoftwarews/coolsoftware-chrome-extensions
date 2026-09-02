/**
 * The insights overlay: charts and table, over the page you were already on.
 *
 * A modal rather than a tab. The charts describe the feed behind them, and
 * sending someone to a separate tab to read about the tab they were in is the
 * kind of navigation that makes a feature feel like a detour. Closing it puts
 * them back exactly where they were, with whatever was playing still playing.
 *
 * Rendered inside a shadow root. YouTube ships thousands of rules and a fair
 * number of `!important`s; a plain injected div inherits all of it. The shadow
 * boundary is what makes this the same component in the panel's world and the
 * page's world without a defensive stylesheet.
 *
 * It owns no filters — those live in the side panel, which is the surface built
 * for controls. See src/viz-state.ts for the wire between them.
 */

import { VIZ_STYLES, VizHandle, mountViz } from '../insights/viz';
import { log } from './debug';

const HOST_ID = 'ysg-insights-host';

let host: HTMLElement | null = null;
let viz: VizHandle | null = null;

export function openInsights(): void {
  if (host) return; // already up; a second open is a no-op, not a second copy

  host = document.createElement('div');
  host.id = HOST_ID;
  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = VIZ_STYLES;

  const backdrop = document.createElement('div');
  backdrop.className = 'viz-backdrop';
  backdrop.setAttribute('role', 'dialog');
  backdrop.setAttribute('aria-modal', 'true');
  backdrop.setAttribute('aria-label', 'Subscription insights');

  // Only a click that both starts and ends on the backdrop dismisses. Without
  // the mousedown check, selecting text in the table and releasing outside it
  // closes the thing you were reading.
  let pressedBackdrop = false;
  backdrop.addEventListener('mousedown', (event) => {
    pressedBackdrop = event.target === backdrop;
  });
  backdrop.addEventListener('click', (event) => {
    if (pressedBackdrop && event.target === backdrop) closeInsights();
  });

  shadow.append(style, backdrop);
  document.documentElement.append(host);

  viz = mountViz({ container: backdrop, onClose: closeInsights });

  // Capture phase: YouTube binds Escape on the document for its own overlays,
  // and the keystroke has to mean "close this" while this is what is on top.
  document.addEventListener('keydown', onKeyDown, true);
  log('insights opened');
}

export function closeInsights(): void {
  if (!host) return;
  document.removeEventListener('keydown', onKeyDown, true);
  viz?.destroy();
  viz = null;
  host.remove();
  host = null;
  log('insights closed');
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return;
  event.stopPropagation();
  closeInsights();
}
