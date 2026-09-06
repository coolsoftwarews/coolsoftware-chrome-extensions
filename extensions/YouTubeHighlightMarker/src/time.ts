/** `mm:ss`, or `hh:mm:ss` once the clip runs past an hour (or when forced). */
export function formatTimestamp(totalSeconds: number, forceHours = false): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;

  const pad = (n: number): string => String(n).padStart(2, '0');

  if (hours > 0 || forceHours) {
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${pad(minutes)}:${pad(seconds)}`;
}

/** Clamp a captured time into a video's known bounds, tolerating unknown duration. */
export function clampSeconds(seconds: number, durationSeconds?: number): number {
  if (!Number.isFinite(seconds)) return 0;
  let value = Math.max(0, seconds);
  if (Number.isFinite(durationSeconds) && (durationSeconds as number) > 0) {
    value = Math.min(value, durationSeconds as number);
  }
  return value;
}
