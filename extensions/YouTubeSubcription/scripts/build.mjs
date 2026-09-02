#!/usr/bin/env node
/**
 * Build the unpacked extension into ./dist.
 *
 * esbuild only — no bundler config, no framework. Content script and service
 * worker are emitted as IIFEs (MV3 does not load ES modules in either
 * context); popup and options are real modules loaded from their HTML.
 */

import { build, context } from 'esbuild';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = resolve(root, 'src');
const dist = resolve(root, 'dist');

const args = process.argv.slice(2);
const watch = args.includes('--watch');
const prod = args[args.indexOf('--env') + 1] === 'production';

const ENTRIES = [
  { in: resolve(src, 'content/index.ts'), out: 'content/index', format: 'iife' },
  { in: resolve(src, 'background.ts'), out: 'background', format: 'iife' },
  { in: resolve(src, 'options/options.ts'), out: 'options/options', format: 'esm' },
  { in: resolve(src, 'sidepanel/sidepanel.ts'), out: 'sidepanel/sidepanel', format: 'esm' },
];

const STATIC = [
  ['manifest.json', 'manifest.json'],
  ['content/content.css', 'content/content.css'],
  ['options/options.html', 'options/options.html'],
  ['options/options.css', 'options/options.css'],
  ['sidepanel/sidepanel.html', 'sidepanel/sidepanel.html'],
  ['sidepanel/sidepanel.css', 'sidepanel/sidepanel.css'],
];

async function copyStatic() {
  for (const [from, to] of STATIC) {
    const target = resolve(dist, to);
    await mkdir(dirname(target), { recursive: true });
    await cp(resolve(src, from), target);
  }
  await cp(resolve(root, 'icons'), resolve(dist, 'icons'), { recursive: true });
  // Screenshots for the guide. Copied as a tree so adding one is a file drop.
  await cp(resolve(src, 'options/img'), resolve(dist, 'options/img'), { recursive: true });
}

async function syncVersion() {
  const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  const manifestPath = resolve(dist, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.version = pkg.version;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

function optionsFor(entry) {
  return {
    entryPoints: [entry.in],
    outfile: resolve(dist, `${entry.out}.js`),
    bundle: true,
    format: entry.format,
    target: 'chrome110',
    platform: 'browser',
    // Stylesheets are imported as strings so the same component can inject
    // them into a document head or into a shadow root — which is how the
    // manager and the insights overlay render inside the YouTube page without
    // touching, or being touched by, YouTube's own CSS.
    loader: { '.css': 'text' },
    minify: prod,
    sourcemap: prod ? false : 'inline',
    legalComments: 'none',
  };
}

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await copyStatic();
await syncVersion();

if (watch) {
  const contexts = await Promise.all(ENTRIES.map((e) => context(optionsFor(e))));
  await Promise.all(contexts.map((c) => c.watch()));
  console.log('watching… (dist/ is loadable as an unpacked extension)');
} else {
  await Promise.all(ENTRIES.map((e) => build(optionsFor(e))));
  console.log(`built ${prod ? 'production' : 'development'} → dist/`);
}
