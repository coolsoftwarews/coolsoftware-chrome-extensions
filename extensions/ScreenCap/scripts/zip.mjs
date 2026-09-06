/** Packages dist/ into screencap-<version>.zip for the Chrome Web Store. */

import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const target = resolve(root, `screencap-${version}.zip`);

rmSync(target, { force: true });
execFileSync(
  'powershell',
  ['-NoProfile', '-Command', `Compress-Archive -Path '${resolve(root, 'dist')}/*' -DestinationPath '${target}'`],
  { stdio: 'inherit' },
);
console.log(`Packaged ${target}`);
