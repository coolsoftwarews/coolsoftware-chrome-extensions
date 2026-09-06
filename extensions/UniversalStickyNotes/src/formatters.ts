/**
 * The one export format this product has: Markdown, across every page at
 * once (PRD §4). JSON is handled separately in storage.ts as the raw backup
 * format, not a "formatted" export.
 */

import { PageRecord } from './types';

function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, '\n');
}

export function toMarkdown(pages: PageRecord[]): string {
  const withNotes = pages.filter(page => page.notes.length > 0);

  if (!withNotes.length) {
    return '# Sticky Notes\n\nNo notes yet — drop one on any page and it shows up here.\n';
  }

  const lines: string[] = ['# Sticky Notes', '', `_Exported ${new Date().toISOString().slice(0, 10)}_`, ''];

  for (const page of withNotes) {
    lines.push(`## ${page.meta.title || page.meta.url}`);
    lines.push(`Source: ${page.meta.url}`);
    lines.push('');
    for (const note of [...page.notes].sort((a, b) => a.createdAt - b.createdAt)) {
      const text = normalizeLineEndings(note.text).trim() || '_(empty note)_';
      const body = text
        .split('\n')
        .map((line, index) => (index === 0 ? line : `  ${line}`))
        .join('\n');
      lines.push(`- **[${note.color}]** ${body}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

export function buildMarkdownFilename(): string {
  return `sticky-notes-${new Date().toISOString().slice(0, 10)}.md`;
}

export function buildBackupFilename(): string {
  return `sticky-notes-backup-${new Date().toISOString().slice(0, 10)}.json`;
}
