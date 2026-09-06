/**
 * Shared shapes. This product has no "library" of saved items (PRD §4 — an
 * export that isn't downloaded immediately is gone); the only things that
 * persist locally are a template preference and local-only usage counters
 * (README's "local-only instrumentation" + "local storage only, and only
 * where genuinely needed" constraints).
 */

export type TemplateId = 'light' | 'dark' | 'minimal';

export interface TemplateConfig {
  id: TemplateId;
  label: string;
  /** Card background. A flat colour, not an image — keeps rendering pure canvas ops. */
  background: string;
  cardText: string;
  mutedText: string;
  accent: string;
  /** Minimal deliberately omits the metrics row (PRD §4 — a fixed template
   *  property, not a separate per-export toggle, to keep the export panel
   *  to one decision). */
  showMetrics: boolean;
  /** Max wrapped body lines before truncating with an ellipsis (PRD §7). */
  maxLines: number;
}

export interface PostMetrics {
  replies: number | null;
  reposts: number | null;
  likes: number | null;
}

/** What the content script reads out of the live DOM for one post (PRD §5 —
 *  only what's already rendered for the post the user clicked on). */
export interface ScrapedPost {
  /** The status id parsed from the post's permalink, used for filenames. */
  id: string | null;
  author: string;
  handle: string;
  /** Raw avatar <img src> as found in the DOM, before upgradeAvatarUrl(). */
  avatarUrl: string;
  text: string;
  /** ISO datetime from the post's <time datetime>, or '' if absent. */
  postDate: string;
  metrics: PostMetrics;
}

/** A fully measured, DOM-free description of everything render.ts needs to
 *  draw — the pure half of the pipeline (layout.ts), fixture-testable
 *  without a real canvas. Coordinates are in CSS px at 1x scale; render.ts
 *  multiplies by the export scale factor when it actually draws. */
export interface CardLayout {
  width: number;
  height: number;
  padding: number;
  avatarSize: number;
  avatarX: number;
  avatarY: number;
  nameX: number;
  nameY: number;
  handleY: number;
  dateText: string;
  dateY: number;
  textLines: string[];
  textX: number;
  textStartY: number;
  lineHeight: number;
  truncated: boolean;
  showMetrics: boolean;
  metricsY: number;
  metricsText: string;
  direction: 'ltr' | 'rtl';
}

export interface CardInput {
  author: string;
  handle: string;
  text: string;
  /** Already human-formatted (e.g. "Jan 4, 2026"), not a raw ISO string —
   *  the caller runs formatDateLabel() before building this. */
  dateLabel: string;
  metrics: PostMetrics;
}

export type UsageEvent = 'export_single' | 'export_thread' | 'avatar_fallback' | 'export_failed';

export interface UsageCounters {
  cardsExported: number;
  threadsExported: number;
  avatarFallbacks: number;
  exportFailures: number;
  byTemplate: Record<TemplateId, number>;
}

export interface Preferences {
  lastTemplate: TemplateId;
}

/** The content script's only message to the background worker (PRD §6 — the
 *  download is the whole exit; there is nothing else to relay). canvas's own
 *  toDataURL() already produces a data: URL, so no base64/Blob gymnastics
 *  are needed on either side of this message. */
export interface DownloadMessage {
  type: 'XCE_DOWNLOAD';
  dataUrl: string;
  filename: string;
}

export interface DownloadResponse {
  ok: boolean;
  error?: string;
}
