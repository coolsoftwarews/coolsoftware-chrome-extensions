import { clipDuration, sortClips } from './marks';
import { formatTimestamp } from './time';
import { ClipCandidate, VideoMeta } from './types';

const MAX_FILENAME_LENGTH = 120;

/** A link back to the exact moment, the same convention used across this portfolio. */
export function momentUrl(meta: VideoMeta, seconds: number): string {
  const base = meta.url || `https://www.youtube.com/watch?v=${meta.videoId}`;
  return `${base}${base.includes('?') ? '&' : '?'}t=${Math.floor(seconds)}`;
}

function headerDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function useHours(clips: ClipCandidate[]): boolean {
  return clips.some(c => c.outSeconds >= 3600);
}

function escapeCsv(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Markdown export — the one that carries thumbnails. Embedded as data URIs
 * per PRD §4, so the file is one self-contained document rather than a
 * document plus a folder of images that can go missing in transit.
 */
export function toMarkdown(meta: VideoMeta, clipsIn: ClipCandidate[]): string {
  const clips = sortClips(clipsIn);
  const hours = useHours(clips);
  const parts: string[] = [];

  parts.push(`# ${meta.title || 'Untitled video'} — highlights`);
  parts.push('');
  if (meta.channel) parts.push(`**Channel:** ${meta.channel}  `);
  parts.push(`**URL:** ${meta.url}  `);
  parts.push(`**Marks:** ${clips.length}  `);
  parts.push(`**Exported:** ${headerDate()}`);
  parts.push('');
  parts.push('---');
  parts.push('');

  if (clips.length === 0) {
    parts.push('_No highlights marked yet._');
    return parts.join('\n').trimEnd() + '\n';
  }

  clips.forEach((clip, index) => {
    const inLabel = formatTimestamp(clip.inSeconds, hours);
    const outLabel = formatTimestamp(clip.outSeconds, hours);
    const range = `[${inLabel} – ${outLabel}]`;
    const link = momentUrl(meta, clip.inSeconds);

    parts.push(`## ${index + 1}. [${range}](${link})`);
    parts.push('');

    const badges: string[] = [];
    if (clip.isShort) badges.push('_short clip (<1s)_');
    if (clip.swapped) badges.push('_marks corrected to in/out order_');
    if (badges.length) {
      parts.push(badges.join(' · '));
      parts.push('');
    }

    if (clip.note.trim()) {
      parts.push(clip.note.trim());
      parts.push('');
    }

    if (clip.inThumbnail) {
      parts.push(`![In-point thumbnail at ${inLabel}](${clip.inThumbnail})`);
      parts.push('');
    } else {
      parts.push('_(thumbnail unavailable)_');
      parts.push('');
    }
  });

  return parts.join('\n').trimEnd() + '\n';
}

/** CSV export — timestamps and notes only, no images, per PRD §4. */
export function toCsv(meta: VideoMeta, clipsIn: ClipCandidate[]): string {
  const clips = sortClips(clipsIn);
  const hours = useHours(clips);
  const header = [
    'index',
    'in_timestamp',
    'in_seconds',
    'out_timestamp',
    'out_seconds',
    'duration_seconds',
    'note',
    'has_thumbnail',
    'short_clip',
    'order_corrected',
    'video_title',
    'video_url',
  ];

  const rows = clips.map((clip, index) => [
    String(index + 1),
    formatTimestamp(clip.inSeconds, hours),
    clip.inSeconds.toFixed(2),
    formatTimestamp(clip.outSeconds, hours),
    clip.outSeconds.toFixed(2),
    clipDuration(clip).toFixed(2),
    clip.note ?? '',
    clip.inThumbnail || clip.outThumbnail ? 'yes' : 'no',
    clip.isShort ? 'yes' : 'no',
    clip.swapped ? 'yes' : 'no',
    meta.title ?? '',
    meta.url ?? '',
  ]);

  const lines = [header, ...rows].map(row => row.map(escapeCsv).join(','));
  return lines.join('\r\n') + '\r\n';
}

/**
 * `{channel} - {title} - highlights.{ext}`, sanitized for Windows/macOS/Linux
 * and truncated so the whole name stays within 120 characters — the same
 * convention YouTubeTranscription uses for its own exports.
 */
export function buildFilename(meta: VideoMeta, ext: string): string {
  const stripControlChars = (value: string): string =>
    Array.from(value)
      .filter(ch => {
        const code = ch.codePointAt(0) ?? 0;
        return code >= 32 && code !== 127;
      })
      .join('');

  const clean = (value: string): string =>
    stripControlChars(value)
      .replace(/[\\/:*?"<>|]/g, '')
      .replace(/\.+$/, '')
      .replace(/\s+/g, ' ')
      .trim();

  const suffix = ` - highlights.${ext}`;
  const channel = clean(meta.channel ?? '');
  const title = clean(meta.title ?? '');

  let stem = [channel, title].filter(Boolean).join(' - ') || 'youtube';
  const budget = MAX_FILENAME_LENGTH - suffix.length;
  if (stem.length > budget) stem = stem.slice(0, budget).trimEnd().replace(/[-\s]+$/, '');

  return stem + suffix;
}
