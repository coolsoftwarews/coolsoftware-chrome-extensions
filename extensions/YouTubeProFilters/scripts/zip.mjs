#!/usr/bin/env node
/**
 * Packs dist/ into a Web Store upload zip. Stored (uncompressed) entries keep
 * the writer to a few dozen lines with no dependency; the store recompresses
 * the payload on its side anyway.
 */
import { crc32 } from 'node:zlib';
import { readdir, readFile, mkdir, writeFile, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');
const releases = resolve(root, 'release');

const manifest = JSON.parse(await readFile(resolve(dist, 'manifest.json'), 'utf8'));
const target = resolve(releases, `youtube-pro-filters-${manifest.version}.zip`);

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full)));
    else files.push(full);
  }
  return files;
}

const files = await walk(dist);
const locals = [];
const centrals = [];
let offset = 0;

for (const file of files) {
  // Zip entries always use forward slashes, whatever the host platform.
  const name = relative(dist, file).split(sep).join('/');
  const data = await readFile(file);
  const nameBuf = Buffer.from(name, 'utf8');
  const crc = crc32(data);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4); // version needed
  local.writeUInt16LE(0, 8); // method: stored
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  locals.push(local, nameBuf, data);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4); // version made by
  central.writeUInt16LE(20, 6); // version needed
  central.writeUInt16LE(0, 10); // method: stored
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt32LE(offset, 42);
  centrals.push(central, nameBuf);

  offset += local.length + nameBuf.length + data.length;
}

const centralBuf = Buffer.concat(centrals);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(centralBuf.length, 12);
end.writeUInt32LE(offset, 16);

await mkdir(releases, { recursive: true });
await writeFile(target, Buffer.concat([...locals, centralBuf, end]));
const { size } = await stat(target);
console.log(`packed ${files.length} files (${(size / 1024).toFixed(0)} KB) → ${target}`);
