/**
 * Packs dist/ into a Web Store upload zip. Uses the platform zip tool so the
 * project keeps zero runtime dependencies.
 */

import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const outFile = path.join(rootDir, 'tiktok-creator-outlier-finder.zip');

if (!fs.existsSync(path.join(distDir, 'manifest.json'))) {
  console.error('dist/manifest.json not found — run the production build first.');
  process.exit(1);
}

fs.rmSync(outFile, { force: true });

if (process.platform === 'win32') {
  execFileSync(
    'powershell',
    ['-NoProfile', '-Command', `Compress-Archive -Path '${distDir}\\*' -DestinationPath '${outFile}'`],
    { stdio: 'inherit' }
  );
} else {
  execFileSync('zip', ['-r', outFile, '.'], { cwd: distDir, stdio: 'inherit' });
}

console.log(`Packed ${path.relative(process.cwd(), outFile)}`);
