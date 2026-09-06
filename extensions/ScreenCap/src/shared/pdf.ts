/**
 * Screen Capture — minimal single-image PDF writer.
 *
 * A screenshot PDF needs exactly one page holding one JPEG, so we emit the
 * PDF by hand (embedding the JPEG with /DCTDecode, no re-encoding) rather
 * than shipping a PDF library for a job this small.
 */

/** Wraps a JPEG blob in a one-page PDF sized to the image at 96 DPI. */
export async function jpegToPdf(jpeg: Blob, widthPx: number, heightPx: number): Promise<Blob> {
  const bytes = new Uint8Array(await jpeg.arrayBuffer());

  // PDF units are points (1/72"). Screens are 96 DPI, so scale accordingly.
  const widthPt = round(widthPx * 0.75);
  const heightPt = round(heightPx * 0.75);

  const objects: (string | Uint8Array)[][] = [
    ['<< /Type /Catalog /Pages 2 0 R >>'],
    ['<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],
    [
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${widthPt} ${heightPt}] ` +
        `/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`,
    ],
    [
      `<< /Type /XObject /Subtype /Image /Width ${widthPx} /Height ${heightPx} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${bytes.length} >>\nstream\n`,
      bytes,
      '\nendstream',
    ],
    [contentStream(widthPt, heightPt)],
  ];

  const chunks: (string | Uint8Array)[] = ['%PDF-1.4\n%\xFF\xFF\xFF\xFF\n'];
  const offsets: number[] = [];
  let length = byteLength(chunks[0] as string);

  objects.forEach((body, index) => {
    offsets.push(length);
    const parts: (string | Uint8Array)[] = [`${index + 1} 0 obj\n`, ...body, '\nendobj\n'];
    for (const part of parts) {
      chunks.push(part);
      length += typeof part === 'string' ? byteLength(part) : part.length;
    }
  });

  const xrefStart = length;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) xref += `${String(offset).padStart(10, '0')} 00000 n \n`;
  xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  chunks.push(xref);

  return new Blob(chunks.map(toBinary), { type: 'application/pdf' });
}

function contentStream(widthPt: number, heightPt: number): string {
  const draw = `q\n${widthPt} 0 0 ${heightPt} 0 0 cm\n/Im0 Do\nQ\n`;
  return `<< /Length ${byteLength(draw)} >>\nstream\n${draw}endstream`;
}

/** Latin-1 string → bytes, so string offsets match the written byte offsets. */
function toBinary(part: string | Uint8Array): BlobPart {
  if (typeof part !== 'string') return part.slice().buffer as ArrayBuffer;
  const out = new Uint8Array(new ArrayBuffer(part.length));
  for (let i = 0; i < part.length; i++) out[i] = part.charCodeAt(i) & 0xff;
  return out;
}

function byteLength(value: string): number {
  return value.length; // every string we emit is Latin-1, one byte per char
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
