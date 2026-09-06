/**
 * Screen Capture — page agent (content script).
 *
 * Injected on demand by chrome.scripting.executeScript, which loads it as a
 * classic script: this file must have NO imports and NO exports.
 *
 * Responsibilities: measure the page, drive the scroll, suppress sticky
 * headers between frames, and run the region-select overlay.
 */

(() => {
  const FLAG = '__screencapAgentInstalled';
  const w = window as unknown as Record<string, unknown>;
  if (w[FLAG]) return; // re-injection on a second capture is a no-op
  w[FLAG] = true;

  const SCROLL_SETTLE_MS = 220;
  const LAZY_LOAD_TIMEOUT_MS = 1200;
  const HIDE_STYLE_ID = '__screencap-hide-fixed';

  // ── Scroll container detection ──────────────────────────────

  /**
   * Most pages scroll the document. App shells scroll an inner div, and
   * measuring the document there yields a phantom full height, so find the
   * element that actually owns the scroll.
   */
  function getScroller(): HTMLElement {
    const doc = (document.scrollingElement as HTMLElement) || document.documentElement;
    let best = doc;
    let bestOverflow = doc.scrollHeight - doc.clientHeight;

    if (bestOverflow > 40) return doc; // the document really does scroll

    let checked = 0;
    for (const el of document.querySelectorAll<HTMLElement>('body *')) {
      if (checked++ > 1500) break;
      const overflowY = getComputedStyle(el).overflowY;
      if (overflowY !== 'auto' && overflowY !== 'scroll' && overflowY !== 'overlay') continue;
      const overflow = el.scrollHeight - el.clientHeight;
      // Ignore small widgets; we only want a full-height scroll region.
      if (overflow > bestOverflow + 50 && el.clientHeight > window.innerHeight * 0.5) {
        best = el;
        bestOverflow = overflow;
      }
    }
    return best;
  }

  function measure() {
    const scroller = getScroller();
    const isDoc = scroller === document.documentElement || scroller === document.body;
    return {
      scrollHeight: Math.max(scroller.scrollHeight, scroller.clientHeight),
      viewportHeight: isDoc ? window.innerHeight : scroller.clientHeight,
      viewportWidth: isDoc ? document.documentElement.clientWidth : scroller.clientWidth,
      devicePixelRatio: window.devicePixelRatio || 1,
      innerScroller: !isDoc,
    };
  }

  // ── Scrolling ───────────────────────────────────────────────

  /** Scrolls, waits for lazy content to settle, and reports where we landed. */
  async function scrollTo(y: number): Promise<{ actualY: number; scrollHeight: number }> {
    const scroller = getScroller();
    const previousBehavior = scroller.style.scrollBehavior;
    scroller.style.scrollBehavior = 'auto'; // defeat CSS smooth-scroll
    scroller.scrollTop = y;

    await sleep(SCROLL_SETTLE_MS);
    await waitForLazyContent();

    scroller.style.scrollBehavior = previousBehavior;
    return {
      actualY: Math.round(scroller.scrollTop),
      scrollHeight: Math.max(scroller.scrollHeight, scroller.clientHeight),
    };
  }

  /** Resolves when images below the fold have loaded, or on a hard timeout. */
  function waitForLazyContent(): Promise<void> {
    const pending = Array.from(document.images).filter((img) => !img.complete && img.src);
    if (pending.length === 0) return Promise.resolve();

    return new Promise((resolve) => {
      let outstanding = pending.length;
      const done = () => {
        if (--outstanding <= 0) resolve();
      };
      for (const img of pending) {
        img.addEventListener('load', done, { once: true });
        img.addEventListener('error', done, { once: true });
      }
      setTimeout(resolve, LAZY_LOAD_TIMEOUT_MS);
    });
  }

  // ── Sticky/fixed suppression ────────────────────────────────

  /**
   * The first frame keeps the real header; every frame after it hides
   * fixed/sticky elements so they don't repeat down the stitch. Done with a
   * single stylesheet rather than per-element inline styles so restoring is
   * exact and pages using inline styles of their own aren't clobbered.
   */
  function hideFixed(): void {
    if (document.getElementById(HIDE_STYLE_ID)) return;
    const marked: HTMLElement[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('body *')) {
      const position = getComputedStyle(el).position;
      if (position === 'fixed' || position === 'sticky') {
        el.setAttribute('data-screencap-fixed', '');
        marked.push(el);
      }
    }
    if (marked.length === 0) return;

    const style = document.createElement('style');
    style.id = HIDE_STYLE_ID;
    style.textContent = '[data-screencap-fixed]{visibility:hidden !important;}';
    document.documentElement.appendChild(style);
  }

  function restoreFixed(): void {
    document.getElementById(HIDE_STYLE_ID)?.remove();
    for (const el of document.querySelectorAll('[data-screencap-fixed]')) {
      el.removeAttribute('data-screencap-fixed');
    }
  }

  // ── Region select overlay ───────────────────────────────────

  /**
   * Dims the page and lets the user drag a rectangle. Resolves with CSS-pixel
   * viewport coordinates, or null if cancelled with Escape / right-click.
   */
  function selectRegion(): Promise<{ x: number; y: number; width: number; height: number } | null> {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.style.cssText = [
        'position:fixed', 'inset:0', 'z-index:2147483647', 'cursor:crosshair',
        'background:rgba(15,23,42,.35)',
      ].join(';');

      const box = document.createElement('div');
      box.style.cssText = [
        'position:absolute', 'border:1px solid #fff', 'box-shadow:0 0 0 9999px rgba(15,23,42,.35)',
        'background:transparent', 'display:none', 'pointer-events:none',
      ].join(';');

      const hint = document.createElement('div');
      hint.textContent = 'Drag to select · Esc to cancel';
      hint.style.cssText = [
        'position:absolute', 'top:16px', 'left:50%', 'transform:translateX(-50%)',
        'padding:8px 14px', 'border-radius:8px', 'background:#0f172a', 'color:#fff',
        'font:500 13px/1 system-ui,sans-serif', 'pointer-events:none',
      ].join(';');

      overlay.append(box, hint);
      document.documentElement.appendChild(overlay);

      let startX = 0;
      let startY = 0;
      let dragging = false;

      const finish = (result: { x: number; y: number; width: number; height: number } | null) => {
        overlay.remove();
        window.removeEventListener('keydown', onKeyDown, true);
        resolve(result);
      };

      const onKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          finish(null);
        }
      };

      overlay.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return finish(null);
        dragging = true;
        startX = e.clientX;
        startY = e.clientY;
        // The dim is painted by the box's outer shadow once dragging starts.
        overlay.style.background = 'transparent';
        box.style.display = 'block';
        draw(e.clientX, e.clientY);
      });

      overlay.addEventListener('mousemove', (e) => {
        if (dragging) draw(e.clientX, e.clientY);
      });

      overlay.addEventListener('mouseup', (e) => {
        if (!dragging) return;
        const rect = normalize(startX, startY, e.clientX, e.clientY);
        finish(rect.width < 8 || rect.height < 8 ? null : rect);
      });

      overlay.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        finish(null);
      });

      window.addEventListener('keydown', onKeyDown, true);
      hint.style.display = 'block';

      function draw(x: number, y: number) {
        const rect = normalize(startX, startY, x, y);
        box.style.left = `${rect.x}px`;
        box.style.top = `${rect.y}px`;
        box.style.width = `${rect.width}px`;
        box.style.height = `${rect.height}px`;
      }

      function normalize(x1: number, y1: number, x2: number, y2: number) {
        return {
          x: Math.min(x1, x2),
          y: Math.min(y1, y2),
          width: Math.abs(x2 - x1),
          height: Math.abs(y2 - y1),
        };
      }
    });
  }

  // ── Message routing ─────────────────────────────────────────

  chrome.runtime.onMessage.addListener((message: { action: string; y?: number }, _sender, sendResponse) => {
    switch (message.action) {
      case 'PING':
        sendResponse({ ok: true });
        return false;

      case 'MEASURE_PAGE':
        sendResponse(measure());
        return false;

      case 'SCROLL_TO':
        scrollTo(message.y ?? 0).then(sendResponse);
        return true;

      case 'HIDE_FIXED':
        hideFixed();
        sendResponse({ ok: true });
        return false;

      case 'RESTORE_FIXED':
        restoreFixed();
        sendResponse({ ok: true });
        return false;

      case 'SELECT_REGION':
        selectRegion().then((rect) => sendResponse({ rect, devicePixelRatio: window.devicePixelRatio || 1 }));
        return true;

      default:
        return false;
    }
  });

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
})();
