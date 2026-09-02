/**
 * Types for TinyMDE, which ships none.
 *
 * Only the surface this extension actually uses is declared. A hand-written
 * declaration that covers four methods is honest about what we depend on; a
 * generated one covering the whole library would imply we had checked it.
 */
declare module 'tiny-markdown-editor' {
  export interface EditorOptions {
    element: HTMLElement;
    content?: string;
    textarea?: HTMLTextAreaElement | string;
  }

  export class Editor {
    constructor(options: EditorOptions);
    getContent(): string;
    setContent(content: string): void;
    addEventListener(type: 'change' | 'selection' | 'drop', listener: (event: unknown) => void): void;
  }

  export interface CommandBarOptions {
    element: HTMLElement;
    editor: Editor;
    /** Command names, or `|` for a separator. Omitted means TinyMDE's default set. */
    commands?: Array<string | { name: string; title?: string; action?: unknown }>;
  }

  export class CommandBar {
    constructor(options: CommandBarOptions);
  }
}
