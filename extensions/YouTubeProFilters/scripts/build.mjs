#!/usr/bin/env node
/**
 * Bundles the three entry points with esbuild and copies public/ over the top.
 * No framework, no CSS pipeline — the extension is small enough that the build
 * staying inspectable is worth more than any of that.
 */
import { build, context } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outdir = resolve(root, 'dist');

const args = new Set(process.argv.slice(2));
const watch = args.has('--watch');
const production = process.argv.includes('production');

const options = {
  entryPoints: {
    content: resolve(root, 'src/content/index.ts'),
    background: resolve(root, 'src/background/index.ts'),
    popup: resolve(root, 'src/popup/index.ts'),
  },
  outdir,
  bundle: true,
  // IIFE, not ESM: content scripts and the classic <script> in popup.html
  // cannot be modules, and the service worker has no need to be one.
  format: 'iife',
  target: 'chrome110',
  sourcemap: production ? false : 'inline',
  minify: production,
  logLevel: 'info',
};

async function copyStatic() {
  await cp(resolve(root, 'public'), outdir, { recursive: true });
}

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

if (watch) {
  const ctx = await context({
    ...options,
    plugins: [
      {
        name: 'copy-static',
        setup(build) {
          build.onEnd(copyStatic);
        },
      },
    ],
  });
  await ctx.watch();
  console.log('watching…');
} else {
  await build(options);
  await copyStatic();
  console.log(`built → ${outdir}${production ? ' (production)' : ''}`);
}
