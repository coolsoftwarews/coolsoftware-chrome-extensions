/**
 * One captured moment: a timestamp plus the viewer's own words about it.
 * Nothing here comes from YouTube's caption system — see PRD-29 §5.
 */
export interface VideoNote {
  id: string;
  videoId: string;
  /** The video's title when the note was taken, for exports and the panel header. */
  videoTitle: string;
  /** Seconds into the video when "+ Note" fired. */
  seconds: number;
  text: string;
  /** True when captured during a livestream, whose buffer position isn't stable
   *  to seek back to later (PRD §7). Purely a display/seek-affordance flag. */
  isLive: boolean;
  createdAt: number;
}

export type NewNoteInput = Omit<VideoNote, 'id' | 'createdAt'>;

/**
 * The one in-progress note, if any. A single slot rather than one per video:
 * only one capture card can be open at a time in one browser, so there is
 * never more than one draft to lose (PRD §7, "user navigates away mid-note").
 */
export interface Draft {
  videoId: string;
  videoTitle: string;
  seconds: number;
  text: string;
  isLive: boolean;
  updatedAt: number;
}

export interface Backup {
  format: 'youtube-chapter-notes';
  version: 1;
  exportedAt: string;
  notes: VideoNote[];
}

export interface ImportResult {
  notes: number;
}

export interface QuotaStatus {
  bytes: number;
  ratio: number;
  warn: boolean;
}

/** What the panel asks the content script for, and what it answers with. */
export interface TabState {
  videoId: string;
  videoTitle: string;
  url: string;
  isLive: boolean;
}
