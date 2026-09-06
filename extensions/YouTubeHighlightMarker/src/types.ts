/** One end of a not-yet-completed mark: the first button press of a pair. */
export type MarkKind = 'in' | 'out';

export interface PendingPoint {
  kind: MarkKind;
  seconds: number;
  /** Data URI (JPEG), absent when the grab failed or was skipped. */
  thumbnail?: string;
}

/** A completed in/out pair: what the panel lists and what gets exported. */
export interface ClipCandidate {
  id: string;
  videoId: string;
  inSeconds: number;
  outSeconds: number;
  note: string;
  inThumbnail?: string;
  outThumbnail?: string;
  createdAt: number;
  /**
   * True when the point that ended up as "in" was originally pressed as
   * "out" (or vice-versa) — i.e. the user marked out-before-in and this was
   * corrected rather than rejected. See PRD §7.
   */
  swapped: boolean;
  /** outSeconds - inSeconds < 1. Flagged, not blocked — PRD §7. */
  isShort: boolean;
}

export interface VideoMeta {
  videoId: string;
  title: string;
  channel: string;
  url: string;
}

/* ── Local-only usage counters ──────────────────────────────────────── */

export type MetricEvent =
  | 'panel_opened'
  | 'mark_in'
  | 'mark_out'
  | 'clip_created'
  | 'clip_swapped'
  | 'thumbnail_failed'
  | 'note_added'
  | 'clip_deleted'
  | 'seek_used'
  | 'pending_discarded'
  | 'export_md'
  | 'export_csv'
  | 'export_all'
  | 'import_all'
  | 'clear_all'
  | 'clipwizard_clicked';

export interface Metrics {
  counts: Record<string, number>;
  activeDays: string[];
}

/* ── Messages between content.ts, background.ts and panel.ts ──────────── */

export interface PingMessage {
  type: 'YHM_PING';
}
export interface PingResponse {
  ok: boolean;
  url?: string;
  videoId?: string | null;
  title?: string;
  channel?: string;
  pending?: { kind: MarkKind; seconds: number } | null;
}

export interface MarkMessage {
  type: 'YHM_MARK_IN' | 'YHM_MARK_OUT';
}
export interface MarkResponse {
  ok: boolean;
  reason?: string;
}

export interface CancelPendingMessage {
  type: 'YHM_CANCEL_PENDING';
}

export interface SeekMessage {
  type: 'YHM_SEEK';
  seconds: number;
}
export interface SeekResponse {
  ok: boolean;
}

/** Broadcast (best-effort) whenever the tab's video or pending state changes. */
export interface NavigatedMessage {
  type: 'YHM_NAVIGATED';
  videoId: string | null;
  url: string;
}

export interface PendingChangedMessage {
  type: 'YHM_PENDING_CHANGED';
  pending: { kind: MarkKind; seconds: number } | null;
}

export interface ClipAddedMessage {
  type: 'YHM_CLIP_ADDED';
  videoId: string;
}

export interface PendingDiscardedMessage {
  type: 'YHM_PENDING_DISCARDED';
}
