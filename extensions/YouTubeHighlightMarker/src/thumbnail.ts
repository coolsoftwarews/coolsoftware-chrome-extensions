/**
 * Frame-grab a playing <video> element via <canvas> — no network request,
 * a capture of exactly what is already on screen.
 *
 * PRD §5: this is the one real technical risk in the product. Cross-origin
 * media can taint a canvas and throw `SecurityError` on read-back
 * (`toDataURL`/`toBlob`), and YouTube's playback path (DASH vs. progressive,
 * ad breaks, DRM) does not guarantee a clean read every time. There is no fix
 * for a tainted canvas from content-script code — the browser is enforcing a
 * security boundary, not reporting a bug — so the only correct behaviour is
 * to try once, fail quietly, and let the caller fall back to a
 * timestamp-only mark. Never block or retry-loop a mark on this.
 */

const MAX_EDGE = 320;
const JPEG_QUALITY = 0.72;

export function grabThumbnail(video: HTMLVideoElement): string | undefined {
  try {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return undefined;

    const scale = Math.min(1, MAX_EDGE / Math.max(vw, vh));
    const width = Math.max(1, Math.round(vw * scale));
    const height = Math.max(1, Math.round(vh * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;

    ctx.drawImage(video, 0, 0, width, height);

    // The read-back is where a tainted canvas throws — drawImage above never
    // does. Wrapped separately so the intent of each failure mode is clear
    // if this is ever debugged from a stack trace.
    return canvas.toDataURL('image/jpeg', JPEG_QUALITY);
  } catch {
    // SecurityError (tainted canvas), or any other failure reading pixels
    // back — degrade to a timestamp-only mark, per PRD §5.
    return undefined;
  }
}
