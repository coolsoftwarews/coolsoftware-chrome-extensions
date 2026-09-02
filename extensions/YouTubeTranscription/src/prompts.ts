/**
 * The prompt library.
 *
 * A prompt is the instruction that goes in front of a transcript before it is
 * handed to an assistant. They ship as a starting set, and the reader can edit
 * them, add their own, delete them and choose which one the Prompt button uses
 * without being asked every time.
 *
 * Storage only — the editor and the menu live in the panel.
 */

const KEY = 'ytx_prompts';

export interface Prompt {
  id: string;
  name: string;
  body: string;
}

export interface PromptStore {
  prompts: Prompt[];
  /** Id of the prompt the Prompt button uses. */
  defaultId: string;
}

/**
 * The starting set.
 *
 * Deliberately few and deliberately different from each other: three prompts
 * that answer three different questions teach the feature better than ten
 * variations on "summarise this".
 */
export const BUILT_IN: Prompt[] = [
  {
    id: 'summary',
    name: 'Summarise',
    body: [
      'Below is the transcript of a YouTube video. Please:',
      '',
      '1. Summarise it in a short paragraph.',
      '2. List the key points as bullets, each with the timestamp it starts at.',
      '3. Note anything the speaker claims as fact that would be worth checking.',
    ].join('\n'),
  },
  {
    id: 'notes',
    name: 'Study notes',
    body: [
      'Below is the transcript of a YouTube video. Turn it into study notes:',
      '',
      '- Group the material under headings that follow the argument, not the clock.',
      '- Keep the timestamp where each idea is introduced, so I can go back to it.',
      '- End with the three things worth remembering a month from now.',
    ].join('\n'),
  },
  {
    id: 'quotes',
    name: 'Pull quotes',
    body: [
      'Below is the transcript of a YouTube video. Find the passages worth quoting:',
      '',
      '- Give me up to eight direct quotes, verbatim, each with its timestamp.',
      '- Prefer claims, admissions and turns of phrase over pleasantries.',
      '- After each, add one line on why it stands out.',
    ].join('\n'),
  },
];

const DEFAULT_STORE: PromptStore = { prompts: BUILT_IN, defaultId: BUILT_IN[0].id };

export async function readPrompts(): Promise<PromptStore> {
  try {
    const raw = await chrome.storage.local.get(KEY);
    const store = raw?.[KEY] as PromptStore | undefined;
    if (!store || !Array.isArray(store.prompts) || store.prompts.length === 0) {
      return { ...DEFAULT_STORE };
    }
    // A default pointing at a deleted prompt would leave the button doing
    // nothing, so it falls back rather than trusting what was stored.
    const defaultId = store.prompts.some(p => p.id === store.defaultId)
      ? store.defaultId
      : store.prompts[0].id;
    return { prompts: store.prompts, defaultId };
  } catch {
    return { ...DEFAULT_STORE };
  }
}

export async function writePrompts(store: PromptStore): Promise<void> {
  try {
    await chrome.storage.local.set({ [KEY]: store });
  } catch {
    /* a prompt that fails to save is not worth interrupting anyone for */
  }
}

/** Ids only have to be unique within one small list, so the clock is enough. */
export function newPromptId(): string {
  return `p${Date.now().toString(36)}`;
}

export async function savePrompt(prompt: Prompt): Promise<PromptStore> {
  const store = await readPrompts();
  const index = store.prompts.findIndex(p => p.id === prompt.id);
  const prompts =
    index === -1
      ? [...store.prompts, prompt]
      : store.prompts.map(p => (p.id === prompt.id ? prompt : p));

  const next = { ...store, prompts };
  await writePrompts(next);
  return next;
}

/**
 * Delete one, refusing to empty the list.
 *
 * A prompt library with nothing in it makes the Prompt button unusable, and
 * "restore the built-ins" would be a second concept to explain. Keeping the
 * last one is the cheaper promise.
 */
export async function deletePrompt(id: string): Promise<PromptStore> {
  const store = await readPrompts();
  if (store.prompts.length <= 1) return store;

  const prompts = store.prompts.filter(p => p.id !== id);
  const defaultId = prompts.some(p => p.id === store.defaultId) ? store.defaultId : prompts[0].id;

  const next = { prompts, defaultId };
  await writePrompts(next);
  return next;
}

export async function setDefaultPrompt(id: string): Promise<PromptStore> {
  const store = await readPrompts();
  if (!store.prompts.some(p => p.id === id)) return store;

  const next = { ...store, defaultId: id };
  await writePrompts(next);
  return next;
}

/* ── Assistants ──────────────────────────────────────────────────────── */

export interface Assistant {
  id: string;
  name: string;
  url: string;
}

/**
 * Where a prompt can be taken.
 *
 * The transcript goes via the clipboard rather than the URL: every one of these
 * accepts a query parameter, and every one of them would truncate a transcript
 * long before it ended. Copy-then-open is one paste for the reader and never
 * loses half the material.
 */
export const ASSISTANTS: Assistant[] = [
  { id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com/' },
  { id: 'claude', name: 'Claude', url: 'https://claude.ai/new' },
  { id: 'gemini', name: 'Gemini', url: 'https://gemini.google.com/app' },
];
