export type ReaderFont = 'serif' | 'sans' | 'mono';
export type ReaderTheme = 'light' | 'dark' | 'sepia';
export type ReaderWidth = 'narrow' | 'medium' | 'wide';

export interface ReaderPreferences {
  font: ReaderFont;
  fontSize: number; // px, clamped 14-28
  theme: ReaderTheme;
  width: ReaderWidth;
}

export const DEFAULT_PREFERENCES: ReaderPreferences = {
  font: 'serif',
  fontSize: 18,
  theme: 'light',
  width: 'medium',
};

export const FONT_SIZE_MIN = 14;
export const FONT_SIZE_MAX = 28;
export const FONT_SIZE_STEP = 2;

/** Page metadata read directly from the live DOM (title/author/site/url). */
export interface PageMeta {
  url: string;
  title: string;
  author: string;
  site: string;
  published: string;
  captured: string;
}

export type ExtractConfidence = 'high' | 'low';

/** Why extraction was rejected (or accepted), for the honest empty state. */
export type ExtractReason =
  | 'ok'
  | 'insufficient-content'
  | 'too-few-paragraphs'
  | 'no-content-found';

export interface ExtractedArticle {
  confidence: ExtractConfidence;
  reason: ExtractReason;
  /** Sanitized HTML of the winning content block. Empty when confidence is 'low'. */
  html: string;
  /** Plain text of the same content. */
  text: string;
  wordCount: number;
  readingMinutes: number;
}

export type ExportFormat = 'md' | 'pdf' | 'txt';

/* ── Messages (content ⇄ background) ─────────────────────────────────── */

export type ContentToBackground =
  | { type: 'URM_DOWNLOAD'; filename: string; dataUrl: string };

export type BackgroundResponse = { ok: true } | { ok: false; error: string };
