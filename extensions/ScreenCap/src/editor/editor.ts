/**
 * Screen Capture — results tab and editor.
 *
 * Four annotation tools plus crop, on purpose. Every addition here has to
 * earn its place against "open it cold and annotate a bug in 15 seconds".
 */

import { Msg, type CapturePayload, type ExportFormat, type Rect } from '../shared/messages';
import { DEFAULT_JPEG_QUALITY } from '../shared/constants';
import { track } from '../shared/analytics';
import { jpegToPdf } from '../shared/pdf';

type Tool = 'select' | 'crop' | 'rect' | 'arrow' | 'blur' | 'text';

type Shape =
  | { kind: 'rect'; rect: Rect; color: string; width: number }
  | { kind: 'arrow'; from: { x: number; y: number }; to: { x: number; y: number }; color: string; width: number }
  | { kind: 'blur'; rect: Rect }
  | { kind: 'text'; x: number; y: number; text: string; color: string; size: number };

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const statusLine = document.getElementById('status') as HTMLParagraphElement;
const textInput = document.getElementById('text-input') as HTMLInputElement;
const sizeOptions = document.getElementById('size-options') as HTMLDivElement;
const cropApplyButton = document.getElementById('crop-apply') as HTMLButtonElement;

/** Pixels of the capture itself, after any applied crop. Never annotated. */
let base = document.createElement('canvas');
let meta: CapturePayload['meta'] | null = null;

let shapes: Shape[] = [];
let history: { base: HTMLCanvasElement; shapes: Shape[] }[] = [];

let tool: Tool = 'select';
let color = '#ef4444';
let fontSize = 28;

let drag: { from: { x: number; y: number }; to: { x: number; y: number } } | null = null;
let cropRect: Rect | null = null;

// ── Load ──────────────────────────────────────────────────────

void load();

async function load(): Promise<void> {
  const id = new URLSearchParams(location.search).get('id');
  const payload = id
    ? ((await chrome.runtime.sendMessage({ action: Msg.GET_CAPTURE, id })) as CapturePayload | null)
    : null;

  if (!payload) {
    showStatus('This capture is no longer available. Take a new one from the toolbar icon.', true);
    return;
  }

  meta = payload.meta;
  const image = await loadImage(payload.imageDataUrl);
  base.width = image.naturalWidth;
  base.height = image.naturalHeight;
  base.getContext('2d')!.drawImage(image, 0, 0);

  document.title = `${meta.sourceTitle || 'Capture'} — Screen Capture`;
  if (meta.truncated) {
    showStatus('This page is taller than the maximum image size, so the capture stops partway down.');
  }
  render();
}

// ── Rendering ─────────────────────────────────────────────────

function render(): void {
  canvas.width = base.width;
  canvas.height = base.height;
  paint(ctx, base, shapes);

  if (drag) {
    if (tool === 'rect' || tool === 'crop') paintRect(ctx, rectOf(drag), tool === 'crop' ? '#ffffff' : color, strokeWidth());
    if (tool === 'arrow') paintArrow(ctx, drag.from, drag.to, color, strokeWidth());
    if (tool === 'blur') paintRect(ctx, rectOf(drag), '#ffffff', 1);
  }
  if (cropRect && !drag) paintCropMask(ctx, cropRect);
}

/** Draws a base image plus its annotations. Used for both preview and export. */
function paint(target: CanvasRenderingContext2D, source: HTMLCanvasElement, list: Shape[]): void {
  target.clearRect(0, 0, source.width, source.height);
  target.drawImage(source, 0, 0);

  for (const shape of list) {
    switch (shape.kind) {
      case 'rect':
        paintRect(target, shape.rect, shape.color, shape.width);
        break;
      case 'arrow':
        paintArrow(target, shape.from, shape.to, shape.color, shape.width);
        break;
      case 'blur':
        paintBlur(target, source, shape.rect);
        break;
      case 'text':
        paintText(target, shape);
        break;
    }
  }
}

function paintRect(target: CanvasRenderingContext2D, rect: Rect, stroke: string, width: number): void {
  target.save();
  target.strokeStyle = stroke;
  target.lineWidth = width;
  target.strokeRect(rect.x, rect.y, rect.width, rect.height);
  target.restore();
}

function paintArrow(
  target: CanvasRenderingContext2D,
  from: { x: number; y: number },
  to: { x: number; y: number },
  stroke: string,
  width: number,
): void {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const head = Math.max(12, width * 4);

  target.save();
  target.strokeStyle = stroke;
  target.fillStyle = stroke;
  target.lineWidth = width;
  target.lineCap = 'round';

  target.beginPath();
  target.moveTo(from.x, from.y);
  target.lineTo(to.x, to.y);
  target.stroke();

  target.beginPath();
  target.moveTo(to.x, to.y);
  target.lineTo(to.x - head * Math.cos(angle - Math.PI / 7), to.y - head * Math.sin(angle - Math.PI / 7));
  target.lineTo(to.x - head * Math.cos(angle + Math.PI / 7), to.y - head * Math.sin(angle + Math.PI / 7));
  target.closePath();
  target.fill();
  target.restore();
}

/**
 * Blurs by redrawing the source region through a blur filter, clipped to the
 * box. Pixels outside the box are untouched, so stacked blurs stay crisp.
 */
function paintBlur(target: CanvasRenderingContext2D, source: HTMLCanvasElement, rect: Rect): void {
  const radius = Math.max(8, Math.round(Math.min(rect.width, rect.height) / 6));
  target.save();
  target.beginPath();
  target.rect(rect.x, rect.y, rect.width, rect.height);
  target.clip();
  target.filter = `blur(${radius}px)`;
  // Draw the whole source, not just the box, so the blur samples real pixels
  // from outside the clip instead of fading into transparency at the edges.
  target.drawImage(source, 0, 0);
  target.restore();
}

function paintText(target: CanvasRenderingContext2D, shape: Extract<Shape, { kind: 'text' }>): void {
  target.save();
  target.font = `600 ${shape.size}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  target.textBaseline = 'top';
  target.lineWidth = Math.max(3, shape.size / 7);
  target.strokeStyle = 'rgba(255,255,255,0.9)'; // keeps text legible on any background
  target.strokeText(shape.text, shape.x, shape.y);
  target.fillStyle = shape.color;
  target.fillText(shape.text, shape.x, shape.y);
  target.restore();
}

function paintCropMask(target: CanvasRenderingContext2D, rect: Rect): void {
  target.save();
  target.fillStyle = 'rgba(15,23,42,0.45)';
  target.beginPath();
  target.rect(0, 0, target.canvas.width, target.canvas.height);
  target.rect(rect.x, rect.y, rect.width, rect.height);
  target.fill('evenodd');
  target.strokeStyle = '#ffffff';
  target.lineWidth = 2;
  target.strokeRect(rect.x, rect.y, rect.width, rect.height);
  target.restore();
}

// ── Tool selection ────────────────────────────────────────────

for (const button of document.querySelectorAll<HTMLButtonElement>('.tool')) {
  button.addEventListener('click', () => selectTool(button.dataset.tool as Tool));
}

for (const swatch of document.querySelectorAll<HTMLButtonElement>('.swatch')) {
  swatch.addEventListener('click', () => {
    color = swatch.dataset.color!;
    setActive('.swatch', swatch);
  });
}

for (const button of document.querySelectorAll<HTMLButtonElement>('.size')) {
  button.addEventListener('click', () => {
    fontSize = Number(button.dataset.size);
    setActive('.size', button);
  });
}

function selectTool(next: Tool): void {
  tool = next;
  canvas.dataset.tool = next;
  setActive('.tool', document.querySelector(`.tool[data-tool="${next}"]`)!);
  sizeOptions.hidden = next !== 'text';
  if (next !== 'crop') {
    cropRect = null;
    cropApplyButton.hidden = true;
  }
  commitText();
  render();
}

function setActive(selector: string, element: Element): void {
  for (const node of document.querySelectorAll(selector)) node.classList.remove('is-active');
  element.classList.add('is-active');
}

// ── Drawing ───────────────────────────────────────────────────

canvas.addEventListener('pointerdown', (event) => {
  if (tool === 'select') return;
  commitText();

  const point = toImageCoords(event);
  if (tool === 'text') {
    openTextInput(point, event);
    return;
  }

  canvas.setPointerCapture(event.pointerId);
  drag = { from: point, to: point };
});

canvas.addEventListener('pointermove', (event) => {
  if (!drag) return;
  drag.to = toImageCoords(event);
  render();
});

canvas.addEventListener('pointerup', () => {
  if (!drag) return;
  const rect = rectOf(drag);
  const { from, to } = drag;
  drag = null;

  if (tool === 'crop') {
    cropRect = rect.width > 8 && rect.height > 8 ? rect : null;
    cropApplyButton.hidden = !cropRect;
  } else if (tool === 'arrow') {
    if (Math.hypot(to.x - from.x, to.y - from.y) > 8) {
      addShape({ kind: 'arrow', from, to, color, width: strokeWidth() });
      void track('tool.arrow');
    }
  } else if (rect.width > 4 && rect.height > 4) {
    if (tool === 'rect') {
      addShape({ kind: 'rect', rect, color, width: strokeWidth() });
      void track('tool.rect');
    } else if (tool === 'blur') {
      addShape({ kind: 'blur', rect });
      void track('tool.blur');
    }
  }
  render();
});

function toImageCoords(event: PointerEvent | MouseEvent): { x: number; y: number } {
  const bounds = canvas.getBoundingClientRect();
  return {
    x: Math.round(((event.clientX - bounds.left) / bounds.width) * canvas.width),
    y: Math.round(((event.clientY - bounds.top) / bounds.height) * canvas.height),
  };
}

function rectOf(d: { from: { x: number; y: number }; to: { x: number; y: number } }): Rect {
  return {
    x: Math.min(d.from.x, d.to.x),
    y: Math.min(d.from.y, d.to.y),
    width: Math.abs(d.to.x - d.from.x),
    height: Math.abs(d.to.y - d.from.y),
  };
}

/** Stroke weight scales with the capture so a 3000px-wide page isn't hairlined. */
function strokeWidth(): number {
  return Math.max(3, Math.round(canvas.width / 400));
}

function addShape(shape: Shape): void {
  pushHistory();
  shapes.push(shape);
}

function pushHistory(): void {
  history.push({ base, shapes: [...shapes] });
  if (history.length > 30) history.shift();
}

// ── Text ──────────────────────────────────────────────────────

let textAnchor: { x: number; y: number } | null = null;

function openTextInput(point: { x: number; y: number }, event: PointerEvent): void {
  textAnchor = point;
  textInput.value = '';
  textInput.hidden = false;
  textInput.style.left = `${event.pageX}px`;
  textInput.style.top = `${event.pageY}px`;
  textInput.style.fontSize = `${Math.max(12, fontSize * (canvas.getBoundingClientRect().width / canvas.width))}px`;
  textInput.focus();
}

textInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') commitText();
  if (event.key === 'Escape') cancelText();
  event.stopPropagation();
});

textInput.addEventListener('blur', commitText);

function commitText(): void {
  if (!textAnchor) return;
  const text = textInput.value.trim();
  const anchor = textAnchor;
  cancelText();

  if (text) {
    addShape({ kind: 'text', x: anchor.x, y: anchor.y, text, color, size: fontSize });
    void track('tool.text');
    render();
  }
}

function cancelText(): void {
  textAnchor = null;
  textInput.hidden = true;
  textInput.value = '';
}

// ── Crop and undo ─────────────────────────────────────────────

cropApplyButton.addEventListener('click', applyCrop);

/** Bakes the current annotations and the crop box into a new base image. */
function applyCrop(): void {
  if (!cropRect) return;
  pushHistory();

  const flattened = document.createElement('canvas');
  flattened.width = base.width;
  flattened.height = base.height;
  paint(flattened.getContext('2d')!, base, shapes);

  const cropped = document.createElement('canvas');
  cropped.width = cropRect.width;
  cropped.height = cropRect.height;
  cropped
    .getContext('2d')!
    .drawImage(flattened, cropRect.x, cropRect.y, cropRect.width, cropRect.height, 0, 0, cropRect.width, cropRect.height);

  base = cropped;
  shapes = [];
  cropRect = null;
  cropApplyButton.hidden = true;
  void track('tool.crop');
  selectTool('select');
}

document.getElementById('undo')!.addEventListener('click', undo);

function undo(): void {
  const previous = history.pop();
  if (!previous) return;
  base = previous.base;
  shapes = previous.shapes;
  cropRect = null;
  cropApplyButton.hidden = true;
  render();
}

document.addEventListener('keydown', (event) => {
  if (event.target === textInput) return;

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    undo();
    return;
  }

  const shortcuts: Record<string, Tool> = { v: 'select', c: 'crop', r: 'rect', a: 'arrow', b: 'blur', t: 'text' };
  const next = shortcuts[event.key.toLowerCase()];
  if (next && !event.ctrlKey && !event.metaKey) selectTool(next);
});

// ── Export ────────────────────────────────────────────────────

document.getElementById('png')!.addEventListener('click', () => void save('png'));
document.getElementById('jpeg')!.addEventListener('click', () => void save('jpeg'));
document.getElementById('pdf')!.addEventListener('click', () => void save('pdf'));
document.getElementById('copy')!.addEventListener('click', () => void copyToClipboard());

/** Flattens base + annotations at full resolution, ignoring the preview scale. */
function flatten(): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = base.width;
  out.height = base.height;
  paint(out.getContext('2d')!, base, shapes);
  return out;
}

async function save(format: ExportFormat): Promise<void> {
  if (!meta) return;
  try {
    const flat = flatten();
    const blob =
      format === 'png'
        ? await toBlob(flat, 'image/png')
        : await toBlob(flat, 'image/jpeg', DEFAULT_JPEG_QUALITY);

    const file =
      format === 'pdf' ? await jpegToPdf(blob, flat.width, flat.height) : blob;

    const url = URL.createObjectURL(file);
    await chrome.downloads.download({ url, filename: filename(format), saveAs: false });
    setTimeout(() => URL.revokeObjectURL(url), 60_000);

    void track(`export.${format}`);
    showStatus(`Saved as ${format.toUpperCase()}.`);
  } catch (error) {
    showStatus(error instanceof Error ? error.message : 'Export failed.', true);
  }
}

async function copyToClipboard(): Promise<void> {
  try {
    const blob = await toBlob(flatten(), 'image/png');
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    void track('export.copy');
    showStatus('Copied to clipboard.');
  } catch {
    showStatus('Chrome blocked the clipboard. Click the page once, then try Copy again.', true);
  }
}

function toBlob(source: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    source.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the image.'))),
      type,
      quality,
    );
  });
}

function filename(format: ExportFormat): string {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const slug = (meta?.sourceTitle || 'capture')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'capture';
  return `${slug}-${stamp}.${format === 'jpeg' ? 'jpg' : format}`;
}

// ── Helpers ───────────────────────────────────────────────────

function showStatus(message: string, isError = false): void {
  statusLine.textContent = message;
  statusLine.classList.toggle('is-error', isError);
  statusLine.hidden = false;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not read the capture.'));
    image.src = src;
  });
}
