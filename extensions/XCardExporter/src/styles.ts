/**
 * CSS for the shadow-root UI, embedded as a string constant (same convention
 * as EtsyListingAnalyzer/TikTokProductScout in this portfolio) so the badge
 * and export panel need no extra build-time asset copy. Namespaced under
 * `.xce-` so nothing here can collide with X's own styles, and nothing of
 * X's page CSS can reach in (both directions are already true just by being
 * inside a shadow root, but the prefix keeps this file self-documenting).
 */

export const CSS = `
:host { all: initial; }

.xce-badge {
  position: fixed;
  display: flex;
  gap: 4px;
  z-index: 2147483000;
  pointer-events: none;
}

.xce-badge-btn {
  pointer-events: auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 999px;
  border: 1px solid rgba(120, 120, 120, 0.35);
  background: rgba(255, 255, 255, 0.95);
  color: #0f1419;
  cursor: pointer;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.18);
  font: 15px system-ui, -apple-system, "Segoe UI", sans-serif;
}

.xce-badge-btn:hover { background: #ffffff; }
.xce-badge-btn:focus-visible {
  outline: 2px solid #1d9bf0;
  outline-offset: 2px;
}

.xce-badge-btn[disabled] {
  opacity: 0.4;
  cursor: default;
}

.xce-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 2147483001;
  display: flex;
  align-items: center;
  justify-content: center;
  font: 14px system-ui, -apple-system, "Segoe UI", sans-serif;
}

.xce-panel {
  width: min(720px, calc(100vw - 32px));
  max-height: calc(100vh - 32px);
  overflow: auto;
  background: #ffffff;
  color: #0f1419;
  border-radius: 16px;
  padding: 20px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.3);
}

.xce-panel h2 {
  margin: 0 0 4px;
  font-size: 17px;
}

.xce-panel p.xce-sub {
  margin: 0 0 16px;
  color: #536471;
  font-size: 13px;
}

.xce-preview {
  border: 1px solid #e1e8ed;
  border-radius: 12px;
  padding: 12px;
  margin-bottom: 16px;
  display: flex;
  justify-content: center;
  background: #f7f9f9;
}

.xce-preview img {
  max-width: 100%;
  height: auto;
  border-radius: 8px;
  display: block;
}

.xce-templates {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
}

.xce-template-btn {
  flex: 1;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid #cfd9de;
  background: #ffffff;
  cursor: pointer;
  font: inherit;
  color: #0f1419;
}

.xce-template-btn[aria-pressed="true"] {
  border-color: #1d9bf0;
  background: #e8f5fd;
  font-weight: 600;
}

.xce-template-btn:focus-visible {
  outline: 2px solid #1d9bf0;
  outline-offset: 2px;
}

.xce-status {
  min-height: 18px;
  margin-bottom: 12px;
  font-size: 13px;
  color: #536471;
}

.xce-status.xce-status-error { color: #b3261e; }

.xce-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.xce-btn {
  padding: 9px 16px;
  border-radius: 999px;
  border: 1px solid #cfd9de;
  background: #ffffff;
  color: #0f1419;
  cursor: pointer;
  font: 14px system-ui, -apple-system, "Segoe UI", sans-serif;
}

.xce-btn:focus-visible {
  outline: 2px solid #1d9bf0;
  outline-offset: 2px;
}

.xce-btn-primary {
  background: #0f1419;
  border-color: #0f1419;
  color: #ffffff;
}

.xce-btn-primary[disabled] {
  opacity: 0.5;
  cursor: default;
}

.xce-btn:hover:not([disabled]) { filter: brightness(0.97); }
`;
