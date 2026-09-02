/**
 * Packs dist/ into a Web Store upload zip.
 *
 * Written by hand rather than shelled out to, because both Windows tools get
 * the entry names wrong: `Compress-Archive` on PowerShell 5.1 and .NET
 * Framework's `ZipFile.CreateFromDirectory` both write `icons\icon-16.png` with
 * a backslash. The ZIP format specifies `/`, so an archive built that way is,
 * to a conforming reader, one flat directory of oddly-named files. Chrome is a
 * conforming reader.
 *
 * Deflate rather than store: the guide's screenshots are already compressed,
 * but the HTML, CSS and JS are not, and halving the upload costs nothing.
 */

import { deflateRawSync } from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');

const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const outFile = path.join(rootDir, `${pkg.name}-${pkg.version}.zip`);

if (!fs.existsSync(path.join(distDir, 'manifest.json'))) {
  console.error('dist/manifest.json not found — run the production build first.');
  process.exit(1);
}

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

const files = walk(distDir).sort();
const local = [];
const central = [];
let offset = 0;

for (const file of files) {
  // The whole point of this script: forward slashes, always.
  const name = path.relative(distDir, file).split(path.sep).join('/');
  const nameBuf = Buffer.from(name, 'utf8');

  const data = fs.readFileSync(file);
  const crc = crc32(data);

  // Only keep the compressed copy when it is actually smaller — deflating an
  // already-compressed image usually makes it bigger.
  const deflated = deflateRawSync(data, { level: 9 });
  const stored = deflated.length >= data.length;
  const payload = stored ? data : deflated;
  const method = stored ? 0 : 8;

  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4); // version needed
  header.writeUInt16LE(0x0800, 6); // UTF-8 names
  header.writeUInt16LE(method, 8);
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(payload.length, 18);
  header.writeUInt32LE(data.length, 22);
  header.writeUInt16LE(nameBuf.length, 26);

  local.push(header, nameBuf, payload);

  const entry = Buffer.alloc(46);
  entry.writeUInt32LE(0x02014b50, 0);
  entry.writeUInt16LE(20, 4);
  entry.writeUInt16LE(20, 6);
  entry.writeUInt16LE(0x0800, 8); // UTF-8 names
  entry.writeUInt16LE(method, 10);
  entry.writeUInt32LE(crc, 16);
  entry.writeUInt32LE(payload.length, 20);
  entry.writeUInt32LE(data.length, 24);
  entry.writeUInt16LE(nameBuf.length, 28);
  entry.writeUInt32LE(offset, 42);
  central.push(entry, nameBuf);

  offset += 30 + nameBuf.length + payload.length;
}

const centralBuf = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(centralBuf.length, 12);
end.writeUInt32LE(offset, 16);

fs.rmSync(outFile, { force: true });
fs.writeFileSync(outFile, Buffer.concat([...local, centralBuf, end]));

const kb = n => Math.round(n / 1024);
console.log(
  `Packed ${files.length} files → ${path.relative(process.cwd(), outFile)} (${kb(fs.statSync(outFile).size)} KB)`
);
