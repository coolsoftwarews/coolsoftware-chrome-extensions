/**
 * The export layer: a thread session in, Markdown or plain text out
 * (PRD-25 §4 — Markdown/TXT + copy-to-clipboard only, no PDF in V1).
 * Deliberately pure — no DOM, no chrome.* — so scripts/selftest.mjs can
 * check every format headlessly.
 */

import { completenessNote, postsShownLabel, readingTimeLabel } from './reading';
import { ThreadSession } from './types';

const MAX_FILENAME_LENGTH = 120;

function headerDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function dateLabel(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

export function toMarkdown(session: ThreadSession): string {
  const parts: string[] = [];
  const title = session.rootAuthor ? `${session.rootAuthor}'s thread` : 'Unrolled thread';

  parts.push(`# ${title}`);
  parts.push('');
  parts.push(`**Author:** ${session.rootAuthor || 'Unknown'} (@${session.rootHandle || 'unknown'})  `);
  const reading = readingTimeLabel(session.posts);
  parts.push(`**${postsShownLabel(session.posts)}${reading ? ` · ${reading}` : ''}**  `);
  parts.push(`**Unrolled:** ${headerDate()}`);
  parts.push('');
  parts.push('---');
  parts.push('');

  for (const post of session.posts) {
    if (post.deleted) {
      parts.push('_— a post in this thread is no longer available —_');
      parts.push('');
      continue;
    }
    parts.push(`**${post.author} (@${post.handle})**${post.postDate ? ` — ${dateLabel(post.postDate)}` : ''}`);
    parts.push('');
    parts.push(...(post.text || '_(no text — media only)_').split('\n'));
    if (post.media.count > 0) {
      parts.push('');
      parts.push(`_[${post.media.label}]_`);
    }
    if (post.quoted) {
      parts.push('');
      parts.push(`> Quoting **${post.quoted.author} (@${post.quoted.handle})**:`);
      parts.push(...post.quoted.text.split('\n').map(line => `> ${line}`));
    }
    if (post.url) {
      parts.push('');
      parts.push(`[Open on X](${post.url})`);
    }
    parts.push('');
    parts.push('---');
    parts.push('');
  }

  const note = completenessNote(session);
  if (note) {
    parts.push(`_${note}_`);
    parts.push('');
  }

  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

export function toPlainText(session: ThreadSession): string {
  const parts: string[] = [];
  const title = session.rootAuthor ? `${session.rootAuthor}'s thread` : 'Unrolled thread';

  parts.push(title);
  parts.push(`Author: ${session.rootAuthor || 'Unknown'} (@${session.rootHandle || 'unknown'})`);
  const reading = readingTimeLabel(session.posts);
  parts.push(`${postsShownLabel(session.posts)}${reading ? ` — ${reading}` : ''}`);
  parts.push(`Unrolled: ${headerDate()}`);
  parts.push('');
  parts.push('-'.repeat(60));
  parts.push('');

  for (const post of session.posts) {
    if (post.deleted) {
      parts.push('[a post in this thread is no longer available]');
      parts.push('');
      continue;
    }
    parts.push(`${post.author} (@${post.handle})${post.postDate ? ` — ${dateLabel(post.postDate)}` : ''}`);
    parts.push('');
    parts.push(post.text || '(no text — media only)');
    if (post.media.count > 0) parts.push(`[${post.media.label}]`);
    if (post.quoted) {
      parts.push('');
      parts.push(`Quoting ${post.quoted.author} (@${post.quoted.handle}):`);
      parts.push(post.quoted.text);
    }
    if (post.url) parts.push(post.url);
    parts.push('');
    parts.push('-'.repeat(60));
    parts.push('');
  }

  const note = completenessNote(session);
  if (note) {
    parts.push(note);
    parts.push('');
  }

  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

/**
 * `x-thread-{handle}-{date}.{ext}`, sanitized for Windows/macOS/Linux and
 * truncated so the whole name stays within 120 characters — same convention
 * as YouTubeTranscription's buildFilename.
 */
export function buildFilename(session: Pick<ThreadSession, 'rootHandle'>, ext: string): string {
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

  const handle = clean(session.rootHandle) || 'thread';
  const date = headerDate();
  const suffix = `.${ext}`;
  let stem = `x-thread-${handle}-${date}`;
  const budget = MAX_FILENAME_LENGTH - suffix.length;
  if (stem.length > budget) stem = stem.slice(0, budget).trimEnd().replace(/[-\s]+$/, '');

  return stem + suffix;
}
