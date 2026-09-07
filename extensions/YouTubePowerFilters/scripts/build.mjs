#!/usr/bin/env node
/** Bundles YouTube Power Filters and copies its public assets. */
import { build, context } from 'esbuild';
import { cp, copyFile, mkdir, rm } from 'node:fs/promises';
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
  format: 'iife',
  target: 'chrome110',
  sourcemap: production ? false : 'inline',
  minify: production,
  logLevel: 'info',
};
async function copyStatic() {
  await cp(resolve(root, 'public'), outdir, { recursive: true });
  // Materialize the cloned styles in dist; Chrome extensions cannot load files
  // from outside their unpacked extension root.
  await copyFile(resolve(root, '../YouTubeProFilters/public/content.css'), resolve(outdir, 'content.css'));
}
await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });
if (watch) {
  const ctx = await context({ ...options, plugins: [{ name: 'copy-static', setup(build) { build.onEnd(copyStatic); } }] });
  await ctx.watch();
  console.log('YouTube Power Filters: watching…');
} else {
  await build(options);
  await copyStatic();
  console.log(`YouTube Power Filters built → ${outdir}${production ? ' (production)' : ''}`);
}
