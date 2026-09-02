import { cleanSegments, finishSegments } from './cleanup';
import { formatTimestamp, groupSegments } from './transcript-extractor';
import { Chapter, ExportOptions, TranscriptResult, TranscriptSegment } from './types';

const MAX_FILENAME_LENGTH = 120;

export interface RenderedLine {
  timestamp: string;
  text: string;
  start: number;
  /** Set on the first line of a chapter, when the video has chapters. */
  chapter?: string;
}

/** A link back to the moment, which is what a timestamp is actually for. */
export function momentUrl(result: TranscriptResult, start: number): string {
  return `${result.meta.url}${result.meta.url.includes('?') ? '&' : '?'}t=${Math.floor(start)}`;
}

/**
 * Applies cleanup, paragraph mode and chapters; everything downstream works off
 * these lines.
 *
 * Order matters: cleaning happens before grouping, so a `>>` speaker marker is
 * resolved while it is still at the start of its own fragment rather than
 * buried mid-paragraph.
 */
export function renderLines(result: TranscriptResult, options: ExportOptions): RenderedLine[] {
  const cleaned = options.cleanCaptions ? cleanSegments(result.segments) : result.segments;

  const grouped: TranscriptSegment[] =
    options.paragraphMode === 'paragraphs' ? groupSegments(cleaned) : cleaned;

  // Casing last, on whole lines — see finishText.
  const segments = options.cleanCaptions ? finishSegments(grouped) : grouped;

  const useHours = (result.meta.durationSeconds || segments[segments.length - 1]?.start || 0) >= 3600;

  const chapters = options.useChapters ? (result.chapters ?? []) : [];

  return segments.map(s => ({
    timestamp: formatTimestamp(s.start, useHours),
    text: s.text,
    start: s.start,
    chapter: chapterStartingAt(chapters, s.start, segments),
  }));
}

/**
 * The chapter a line opens, if it opens one.
 *
 * A chapter belongs to the first line at or after its start, so a heading never
 * lands in the middle of a paragraph and never goes missing because no line
 * begins on its exact second.
 */
function chapterStartingAt(
  chapters: Chapter[],
  start: number,
  segments: TranscriptSegment[],
): string | undefined {
  for (const chapter of chapters) {
    const owner = segments.find(s => s.start >= chapter.start - 0.001);
    if (owner && Math.abs(owner.start - start) < 0.001) return chapter.title;
  }
  return undefined;
}

function headerDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function durationLabel(seconds: number): string {
  return seconds > 0 ? formatTimestamp(seconds, true) : 'unknown';
}

export function toMarkdown(result: TranscriptResult, options: ExportOptions): string {
  const lines = renderLines(result, options);
  const parts: string[] = [];

  if (options.includeHeader) {
    parts.push(`# ${result.meta.title}`);
    parts.push('');
    parts.push(`**Channel:** ${result.meta.channel}  `);
    parts.push(`**URL:** ${result.meta.url}  `);
    parts.push(`**Duration:** ${durationLabel(result.meta.durationSeconds)}  `);
    parts.push(`**Language:** ${result.languageName}  `);
    parts.push(`**Exported:** ${headerDate()}`);
    parts.push('');
    parts.push('---');
    parts.push('');
  }

  for (const line of lines) {
    if (line.chapter) {
      parts.push(`## ${line.chapter}`);
      parts.push('');
    }

    if (!options.includeTimestamps) {
      parts.push(line.text);
    } else if (options.linkTimestamps) {
      // A timestamp that cannot be clicked is a number about a video you are no
      // longer looking at. Every reader of Markdown follows a link.
      parts.push(`**[[${line.timestamp}](${momentUrl(result, line.start)})]** ${line.text}`);
    } else {
      parts.push(`**[${line.timestamp}]** ${line.text}`);
    }
    parts.push('');
  }

  return parts.join('\n').trimEnd() + '\n';
}

export function toPlainText(result: TranscriptResult, options: ExportOptions): string {
  const lines = renderLines(result, options);
  const parts: string[] = [];

  if (options.includeHeader) {
    parts.push(result.meta.title);
    parts.push(`Channel: ${result.meta.channel}`);
    parts.push(`URL: ${result.meta.url}`);
    parts.push(`Duration: ${durationLabel(result.meta.durationSeconds)}`);
    parts.push(`Language: ${result.languageName}`);
    parts.push(`Exported: ${headerDate()}`);
    parts.push('');
    parts.push('-'.repeat(60));
    parts.push('');
  }

  for (const line of lines) {
    if (line.chapter) {
      parts.push(line.chapter.toUpperCase());
      parts.push('-'.repeat(Math.min(line.chapter.length, 60)));
      parts.push('');
    }
    parts.push(options.includeTimestamps ? `[${line.timestamp}] ${line.text}` : line.text);
    parts.push('');
  }

  return parts.join('\n').trimEnd() + '\n';
}

/**
 * The transcript with a summarising instruction on the front.
 *
 * The competing extensions all sell AI summaries behind an account. This does
 * the one part of that which needs no account, no key and no server: it hands
 * you the text, framed, ready for whichever assistant you already pay for.
 * Nothing is sent anywhere by us.
 */
export function toPrompt(
  result: TranscriptResult,
  options: ExportOptions,
  instruction: string,
): string {
  const body = toPlainText(result, { ...options, includeHeader: false, includeTimestamps: true });

  return [
    instruction.trim(),
    '',
    `Title: ${result.meta.title}`,
    `Channel: ${result.meta.channel}`,
    `URL: ${result.meta.url}`,
    '',
    '--- TRANSCRIPT ---',
    '',
    body,
  ].join('\n');
}

/** What the PDF writer needs: a title block plus the same lines every other format gets. */
export function toPdfDocument(result: TranscriptResult, options: ExportOptions) {
  return {
    title: result.meta.title,
    header: options.includeHeader
      ? [
          `Channel: ${result.meta.channel}`,
          `URL: ${result.meta.url}`,
          `Duration: ${durationLabel(result.meta.durationSeconds)}`,
          `Language: ${result.languageName}`,
          `Exported: ${headerDate()}`,
        ]
      : [],
    lines: renderLines(result, options).flatMap(line => {
      const own = options.includeTimestamps
        ? { label: `[${line.timestamp}]`, text: line.text }
        : { label: '', text: line.text };
      // A chapter opens with its own line so the PDF gets the same structure
      // the Markdown does, rather than one unbroken column of speech.
      return line.chapter ? [{ label: '', text: line.chapter.toUpperCase() }, own] : [own];
    }),
  };
}

/**
 * A notes document, as the PDF writer wants it.
 *
 * Markdown is flattened rather than rendered: the writer draws label/text pairs
 * with one standard font, so the job here is to keep the structure that survives
 * that — headings on their own line, list bullets, timestamps as labels — and
 * quietly drop the syntax that would only show up as punctuation.
 */
export function notesToPdfDocument(title: string, markdown: string) {
  const lines: Array<{ label: string; text: string }> = [];

  for (const raw of markdown.split('\n')) {
    const line = raw.trim();
    if (!line || line === '---') continue;

    // The seeded transcript's own lines: **[00:00](url)** text → [00:00] text.
    const stamped = /^\*\*\[\[?(\d{1,2}:\d{2}(?::\d{2})?)\](?:\([^)]*\))?\]?\*\*\s*(.*)$/.exec(line);
    if (stamped) {
      lines.push({ label: `[${stamped[1]}]`, text: plain(stamped[2]) });
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      lines.push({ label: '', text: plain(heading[2]).toUpperCase() });
      continue;
    }

    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) {
      if (plain(quote[1])) lines.push({ label: '', text: `“${plain(quote[1])}”` });
      continue;
    }

    const bullet = /^[-*+]\s+(.*)$/.exec(line);
    if (bullet) {
      lines.push({ label: '', text: `• ${plain(bullet[1])}` });
      continue;
    }

    const numbered = /^(\d+)[.)]\s+(.*)$/.exec(line);
    if (numbered) {
      lines.push({ label: `${numbered[1]}.`, text: plain(numbered[2]) });
      continue;
    }

    lines.push({ label: '', text: plain(line) });
  }

  return { title, header: [], lines };
}

/** Strip the inline syntax that would otherwise print as punctuation. */
function plain(text: string): string {
  return text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1') // links keep their words
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * `{channel} - {title} - transcript.{ext}`, sanitized for Windows/macOS/Linux
 * and truncated so the whole name stays within 120 characters.
 */
export function buildFilename(result: TranscriptResult, ext: string): string {
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

  const suffix = ` - transcript.${ext}`;
  const channel = clean(result.meta.channel);
  const title = clean(result.meta.title);

  let stem = [channel, title].filter(Boolean).join(' - ') || 'youtube';
  const budget = MAX_FILENAME_LENGTH - suffix.length;
  if (stem.length > budget) stem = stem.slice(0, budget).trimEnd().replace(/[-\s]+$/, '');

  return stem + suffix;
}
