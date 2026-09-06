/**
 * Pure logic for turning two button presses into a clip candidate.
 *
 * Deliberately DOM-free and storage-free: this is the part covered by
 * scripts/selftest.mjs, and the part the PRD's edge cases (§7) are actually
 * about — out-of-order marks, very short clips, clamping near the ends of a
 * video. content.ts and storage.ts are thin, untestable wrappers around it.
 */
import { ClipCandidate, MarkKind, PendingPoint } from './types';

const SHORT_CLIP_THRESHOLD_SECONDS = 1;

let counter = 0;

/** A collision-resistant id with no dependency and no crypto requirement. */
export function newClipId(): string {
  counter += 1;
  return `clip_${Date.now().toString(36)}_${counter.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Combine two presses — of either kind, in either order — into one clip
 * candidate. The earlier timestamp always becomes `inSeconds`; `swapped` is
 * set when that required correcting which button was actually pressed first
 * (PRD §7: "marks placed out of order").
 */
export function buildClipCandidate(
  a: PendingPoint,
  b: PendingPoint,
  videoId: string,
  options: { id?: string; now?: number; note?: string } = {},
): ClipCandidate {
  const [earlier, later] = a.seconds <= b.seconds ? [a, b] : [b, a];

  // The press order was "correct" when the earlier-timed point was the one
  // pressed as "in" and the later-timed one was pressed as "out". Anything
  // else means the user pressed them in the other order and this function
  // corrected it.
  const pressOrderCorrect = earlier.kind === 'in' && later.kind === 'out';

  const inSeconds = earlier.seconds;
  const outSeconds = later.seconds;

  return {
    id: options.id ?? newClipId(),
    videoId,
    inSeconds,
    outSeconds,
    note: options.note ?? '',
    inThumbnail: earlier.thumbnail,
    outThumbnail: later.thumbnail,
    createdAt: options.now ?? Date.now(),
    swapped: !pressOrderCorrect,
    isShort: outSeconds - inSeconds < SHORT_CLIP_THRESHOLD_SECONDS,
  };
}

/** Sorted, stable on ties by createdAt so re-renders don't jitter the list. */
export function sortClips(clips: ClipCandidate[]): ClipCandidate[] {
  return [...clips].sort((x, y) => x.inSeconds - y.inSeconds || x.createdAt - y.createdAt);
}

export function insertClip(clips: ClipCandidate[], clip: ClipCandidate): ClipCandidate[] {
  return sortClips([...clips, clip]);
}

export function removeClip(clips: ClipCandidate[], id: string): ClipCandidate[] {
  return clips.filter(c => c.id !== id);
}

export function setClipNote(clips: ClipCandidate[], id: string, note: string): ClipCandidate[] {
  return clips.map(c => (c.id === id ? { ...c, note } : c));
}

export function clipDuration(clip: ClipCandidate): number {
  return Math.max(0, clip.outSeconds - clip.inSeconds);
}

/**
 * What one button press does to the pending state.
 *
 * - Nothing pending, or re-pressing the same button: the press (re)starts or
 *   moves the pending point — no pair yet.
 * - A point of the other kind is already pending: this press completes the
 *   pair, and pending goes back to empty.
 */
export function applyPress(
  pending: PendingPoint | null,
  kind: MarkKind,
  seconds: number,
  thumbnail: string | undefined,
): { nextPending: PendingPoint | null; pair: [PendingPoint, PendingPoint] | null } {
  const point: PendingPoint = { kind, seconds, thumbnail };
  if (!pending || pending.kind === kind) {
    return { nextPending: point, pair: null };
  }
  return { nextPending: null, pair: [pending, point] };
}
