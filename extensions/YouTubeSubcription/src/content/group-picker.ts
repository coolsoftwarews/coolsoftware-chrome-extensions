/**
 * The "add to a group" popover shown right after subscribing.
 *
 * Deliberately small and anchored to the subscribe button: this is a two-second
 * decision taken in the flow of watching, not a management session. Anything
 * more elaborate belongs in the side panel, which is one click away from here.
 *
 * Shadow-rooted because YouTube's stylesheet would otherwise repaint every
 * control inside it.
 */

import { createGroup, onStoreChanged, readStore, setChannelInGroup } from '../storage';
import { PageChannel } from './channel-context';
import { StoreShape } from '../types';
import { onTeardown } from './lifecycle';

const HOST_ID = 'ysg-picker-host';

const STYLES = `
:host { all: initial; }
.pop {
  position: fixed;
  z-index: 2147482000;
  width: 300px;
  max-height: 380px;
  display: flex;
  flex-direction: column;
  background: #fff;
  color: #0f0f0f;
  border-radius: 12px;
  box-shadow: 0 12px 32px rgba(0,0,0,.28);
  font: 14px/1.5 'Roboto','Segoe UI',system-ui,sans-serif;
  padding: 12px;
}
@media (prefers-color-scheme: dark) {
  .pop { background: #212121; color: #f1f1f1; }
  .row:hover { background: #383838; }
  .input { background: #121212; color: #f1f1f1; border-color: #3f3f3f; }
}
.head { display:flex; align-items:flex-start; gap:8px; margin-bottom:8px; }
.title { font-weight:600; font-size:13px; margin:0; flex:1; }
.sub { font-size:12px; opacity:.7; margin:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.x { appearance:none; border:none; background:none; color:inherit; cursor:pointer; font-size:15px; opacity:.6; padding:0 2px; }
.x:hover { opacity:1; }
.list { list-style:none; margin:0 0 8px; padding:0; overflow-y:auto; flex:1; }
.row { display:flex; align-items:center; gap:8px; padding:6px 6px; border-radius:8px; cursor:pointer; }
.row:hover { background: rgba(0,0,0,.06); }
.row input { width:16px; height:16px; accent-color:#065fd4; margin:0; cursor:pointer; }
.empty { font-size:13px; opacity:.7; margin:4px 2px 10px; }
form { display:flex; gap:6px; }
.input { flex:1; min-width:0; border:1px solid #d9d9d9; border-radius:8px; padding:6px 8px; font:inherit; font-size:13px; }
.btn { appearance:none; border:none; border-radius:8px; padding:6px 12px; font:inherit; font-size:13px; cursor:pointer; background:#065fd4; color:#fff; }
.link { appearance:none; border:none; background:none; color:#065fd4; font:inherit; font-size:12px; cursor:pointer; padding:6px 2px 0; text-align:left; }
@media (prefers-color-scheme: dark) { .link, .btn { } .link { color:#3ea6ff; } }
`;

let open: { host: HTMLElement; dispose: () => void } | null = null;

export function closePicker(): void {
  open?.dispose();
  open = null;
}

export interface PickerOptions {
  channel: PageChannel;
  /** Element to anchor the popover to; falls back to the viewport corner. */
  anchor: Element | null;
  onOpenManager: () => void;
}

export function showGroupPicker(opts: PickerOptions): void {
  closePicker();
  onTeardown(closePicker);

  const host = document.createElement('div');
  host.id = HOST_ID;
  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = STYLES;

  const pop = document.createElement('div');
  pop.className = 'pop';
  shadow.append(style, pop);
  document.body.append(host);

  /* Header */
  const head = document.createElement('div');
  head.className = 'head';
  const titles = document.createElement('div');
  titles.style.flex = '1';
  titles.style.minWidth = '0';
  const title = document.createElement('p');
  title.className = 'title';
  title.textContent = 'Add to a group';
  const sub = document.createElement('p');
  sub.className = 'sub';
  sub.textContent = opts.channel.name;
  titles.append(title, sub);
  const close = document.createElement('button');
  close.className = 'x';
  close.textContent = '✕';
  close.setAttribute('aria-label', 'Close');
  close.addEventListener('click', closePicker);
  head.append(titles, close);

  const list = document.createElement('ul');
  list.className = 'list';

  const empty = document.createElement('p');
  empty.className = 'empty';
  empty.textContent = 'No groups yet — name your first one below.';
  empty.hidden = true;

  /* New-group form: creating and assigning in one action, because at this
     moment the user already knows exactly which group they mean. */
  const form = document.createElement('form');
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'input';
  input.placeholder = 'New group…';
  input.maxLength = 60;
  const add = document.createElement('button');
  add.type = 'submit';
  add.className = 'btn';
  add.textContent = 'Add';
  form.append(input, add);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = input.value.trim();
    if (!name) return;
    input.value = '';
    void createGroup(name).then((group) =>
      setChannelInGroup(group.id, opts.channel.id, true),
    );
  });

  const manage = document.createElement('button');
  manage.className = 'link';
  manage.textContent = 'Manage all groups…';
  manage.addEventListener('click', () => {
    closePicker();
    opts.onOpenManager();
  });

  pop.append(head, list, empty, form, manage);

  const render = (store: StoreShape) => {
    const groups = [...store.groups].sort((a, b) => a.order - b.order);
    empty.hidden = groups.length > 0;
    list.replaceChildren();

    for (const group of groups) {
      const li = document.createElement('li');
      const row = document.createElement('label');
      row.className = 'row';

      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = group.channelIds.includes(opts.channel.id);
      box.addEventListener('change', () => {
        void setChannelInGroup(group.id, opts.channel.id, box.checked);
      });

      const name = document.createElement('span');
      name.textContent = group.name;

      row.append(box, name);
      li.append(row);
      list.append(li);
    }
  };

  const unsubscribe = onStoreChanged(render);
  void readStore().then(render);

  position(pop, opts.anchor);

  // Dismiss on anything that means "I'm done here". `capture` so YouTube's own
  // handlers can't swallow the event first.
  const onDocClick = (e: MouseEvent) => {
    if (!e.composedPath().includes(host)) closePicker();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') closePicker();
  };
  const onScroll = () => position(pop, opts.anchor);

  setTimeout(() => document.addEventListener('click', onDocClick, true), 0);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('scroll', onScroll, true);
  window.addEventListener('resize', onScroll);

  open = {
    host,
    dispose: () => {
      unsubscribe();
      document.removeEventListener('click', onDocClick, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
      host.remove();
    },
  };
}

/** Keep the popover under its anchor, and inside the viewport. */
function position(pop: HTMLElement, anchor: Element | null): void {
  const width = 300;
  const margin = 8;
  const rect = anchor?.getBoundingClientRect();

  if (!rect || rect.width === 0) {
    pop.style.top = `${margin * 2}px`;
    pop.style.left = `${window.innerWidth - width - margin * 2}px`;
    return;
  }

  const left = Math.min(
    Math.max(margin, rect.left + rect.width / 2 - width / 2),
    window.innerWidth - width - margin,
  );
  // Flip above the anchor when there is no room below it.
  const below = rect.bottom + margin;
  const flip = below + 380 > window.innerHeight && rect.top > 380;
  pop.style.left = `${left}px`;
  pop.style.top = flip ? '' : `${below}px`;
  pop.style.bottom = flip ? `${window.innerHeight - rect.top + margin}px` : '';
}
