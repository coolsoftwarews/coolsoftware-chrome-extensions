/**
 * One shadow root for every piece of UI this extension draws over TikTok:
 * per-tile badges and the product-board drawer. A shadow root keeps the
 * host page's CSS from reaching in (TikTok's own styles cannot mangle a
 * badge) and keeps our styles from leaking out onto the page — the same
 * reasoning as WebHighlighter's `ui()` helper, which this is ported from.
 *
 * Everything here is host-page-cosmetic only: fixed, zero-size, out of flow.
 * Nothing in this file changes the layout of the page underneath it, which is
 * the "zero layout shift" requirement in PRD §6.
 */

export const UI_ATTR = 'data-tps-ui';

let shadow: ShadowRoot | null = null;

const SHELL_CSS = `
  :host { all: initial; }
  .badge {
    position: fixed;
    display: none;
    align-items: center;
    gap: 6px;
    box-sizing: border-box;
    background: rgba(15, 15, 15, 0.82);
    color: #fff;
    border-radius: 999px;
    padding: 4px 9px;
    font: 600 12px/1.3 -apple-system, "Segoe UI", Roboto, sans-serif;
    white-space: nowrap;
    pointer-events: none;
    z-index: 2147483000;
    backdrop-filter: blur(2px);
  }
  .badge--on { display: inline-flex; }
  .badge__ratio { color: #ffd633; }
  .badge__ratio--low { color: #ffb84d; }
  .badge__ratio--pending { color: #b8bcc4; font-weight: 500; }
  .badge__shop { color: #7ce0a3; }
  .badge__track {
    pointer-events: auto;
    cursor: pointer;
    border: none;
    background: rgba(255,255,255,0.16);
    color: #fff;
    border-radius: 999px;
    padding: 2px 7px;
    font: 600 11px/1.3 -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  .badge__track:hover { background: rgba(255,255,255,0.28); }
  .badge__track[aria-pressed="true"] { background: #ffd633; color: #1a1400; }
  @media (prefers-reduced-motion: no-preference) {
    .badge { transition: opacity .12s ease; }
  }
`;

export function ui(): ShadowRoot {
  if (shadow) return shadow;

  const host = document.createElement('div');
  host.setAttribute(UI_ATTR, '');
  host.style.cssText = 'all:initial;position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647';
  document.documentElement.appendChild(host);

  shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = SHELL_CSS;
  shadow.appendChild(style);
  return shadow;
}

let toastEl: HTMLDivElement | null = null;
let toastTimer: number | undefined;

export function toast(message: string): void {
  const root = ui();
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.style.cssText =
      'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);' +
      'background:#0f0f0f;color:#fff;padding:8px 14px;border-radius:999px;' +
      'font:13px/1.4 -apple-system,"Segoe UI",Roboto,sans-serif;opacity:0;' +
      'transition:opacity .18s ease;pointer-events:none;z-index:2147483647';
    root.appendChild(toastEl);
  }
  toastEl.textContent = message;
  toastEl.style.opacity = '0.94';
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    if (toastEl) toastEl.style.opacity = '0';
  }, 1800);
}
