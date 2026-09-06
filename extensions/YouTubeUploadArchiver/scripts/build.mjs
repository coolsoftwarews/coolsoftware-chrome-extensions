import { build, context } from 'esbuild';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const srcDir = path.join(rootDir, 'src');
const distDir = path.join(rootDir, 'dist');

const isWatch = process.argv.includes('--watch');
const envIndex = process.argv.indexOf('--env');
const ENV_NAME = (envIndex !== -1 ? process.argv[envIndex + 1] : 'development').toLowerCase();
const IS_PROD = ENV_NAME === 'production';

const EXTENSION_VERSION = '1.0.0';
const EXTENSION_NAME = IS_PROD ? 'YouTube Upload Archiver' : 'YouTube Upload Archiver (Dev)';

// PRD-47 §6's non-functional requirements table names the permission set
// exactly: activeTab, downloads, storage + host access to *://*.youtube.com/*
// only. No <all_urls>, no "tabs", no "scripting". studio.youtube.com is a
// subdomain of youtube.com, so this one host pattern already covers both
// pages this extension acts on (a channel's own "Videos" tab, and Studio's
// own Content dashboard) — no second host entry is needed.
const HOST_PATTERNS = ['*://*.youtube.com/*'];

async function cleanDist() {
  await fs.promises.rm(distDir, { recursive: true, force: true });
  await fs.promises.mkdir(distDir, { recursive: true });
}

function outputNameFor(meta, entryFile) {
  const target = path.resolve(entryFile);
  const match = Object.entries(meta.outputs).find(
    ([, output]) => output.entryPoint && path.resolve(output.entryPoint) === target
  );
  if (!match) throw new Error(`Unable to locate build output for ${entryFile}`);
  return path.basename(match[0]);
}

async function copyIcons() {
  const source = path.join(srcDir, 'icons');
  const dest = path.join(distDir, 'icons');
  await fs.promises.mkdir(dest, { recursive: true });

  const missing = [];
  for (const size of [16, 32, 48, 128]) {
    const file = `icon-${size}.png`;
    try {
      await fs.promises.copyFile(path.join(source, file), path.join(dest, file));
    } catch {
      missing.push(file);
    }
  }
  if (missing.length) {
    console.warn(`Missing icons: ${missing.join(', ')} — run "npm run icons".`);
  }
}

async function writePopupHtml(popupScriptName) {
  const template = await fs.promises.readFile(path.join(srcDir, 'popup.html'), 'utf8');
  const bust = IS_PROD ? '' : `?v=${Date.now()}`;
  const html = template
    .replace(/src="popup\.js"/, `src="${popupScriptName}${bust}"`)
    .replace(/href="popup\.css"/, `href="popup.css${bust}"`);
  await fs.promises.writeFile(path.join(distDir, 'popup.html'), html, 'utf8');
}

async function copyStaticAssets() {
  await fs.promises.copyFile(path.join(srcDir, 'popup.css'), path.join(distDir, 'popup.css'));
}

async function writeManifest(backgroundScript, contentScript) {
  const manifest = {
    manifest_version: 3,
    name: EXTENSION_NAME,
    short_name: 'YT Archiver',
    version: EXTENSION_VERSION,
    description:
      "Not a video downloader. Archives your uploads' thumbnail + metadata to a local log, then links to Studio's Download page.",
    icons: {
      16: 'icons/icon-16.png',
      32: 'icons/icon-32.png',
      48: 'icons/icon-48.png',
      128: 'icons/icon-128.png',
    },
    action: {
      default_popup: 'popup.html',
      default_title: 'YouTube Upload Archiver',
    },
    // Exactly PRD-47 §6's list: activeTab, downloads, storage. No sidePanel,
    // no tabs, no scripting.
    permissions: ['activeTab', 'downloads', 'storage'],
    host_permissions: HOST_PATTERNS,
    background: {
      service_worker: backgroundScript,
      type: 'module',
    },
    content_scripts: [
      {
        matches: HOST_PATTERNS,
        js: [contentScript],
        run_at: 'document_idle',
        all_frames: false,
      },
    ],
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'self'; base-uri 'self'",
    },
  };

  if (manifest.description.length > 132) {
    throw new Error(`manifest description is ${manifest.description.length} chars, over the 132 char Web Store limit`);
  }
  if (manifest.short_name.length > 12) {
    throw new Error(`short_name is ${manifest.short_name.length} chars, over the 12 char limit`);
  }

  await fs.promises.writeFile(
    path.join(distDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
    'utf8'
  );
}

function buildOptions() {
  const shared = {
    bundle: true,
    target: ['chrome116'],
    outdir: distDir,
    sourcemap: !IS_PROD,
    minify: IS_PROD,
    metafile: true,
    legalComments: 'none',
  };

  return {
    background: {
      ...shared,
      entryPoints: [path.join(srcDir, 'background.ts')],
      format: 'esm',
      entryNames: '[name]',
    },
    content: {
      ...shared,
      entryPoints: [path.join(srcDir, 'content.ts')],
      format: 'iife', // content scripts cannot be modules
      entryNames: '[name]',
    },
    popup: {
      ...shared,
      entryPoints: [path.join(srcDir, 'popup.ts')],
      format: 'esm',
      entryNames: '[name]',
    },
  };
}

async function finalize(metas) {
  const backgroundScript = outputNameFor(metas.background, path.join(srcDir, 'background.ts'));
  const contentScript = outputNameFor(metas.content, path.join(srcDir, 'content.ts'));
  const popupScript = outputNameFor(metas.popup, path.join(srcDir, 'popup.ts'));

  await copyStaticAssets();
  await copyIcons();
  await writePopupHtml(popupScript);
  await writeManifest(backgroundScript, contentScript);
}

async function reportSize() {
  let total = 0;
  const walk = async dir => {
    for (const entry of await fs.promises.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else total += (await fs.promises.stat(full)).size;
    }
  };
  await walk(distDir);
  const kb = Math.round(total / 1024);
  console.log(`Bundle size: ${kb} KB (budget 500 KB)${kb > 500 ? '  *** OVER BUDGET ***' : ''}`);
}

async function buildOnce() {
  await cleanDist();
  const opts = buildOptions();
  const [background, content, popup] = await Promise.all([
    build(opts.background),
    build(opts.content),
    build(opts.popup),
  ]);
  await finalize({
    background: background.metafile,
    content: content.metafile,
    popup: popup.metafile,
  });
  console.log(`Build complete (${ENV_NAME}).`);
  await reportSize();
}

async function buildAndWatch() {
  await cleanDist();
  const opts = buildOptions();
  const metas = {};

  const makeContext = (name, config) =>
    context({
      ...config,
      plugins: [
        {
          name: `finalize-${name}`,
          setup(b) {
            b.onEnd(async result => {
              if (result.errors?.length || !result.metafile) return;
              metas[name] = result.metafile;
              if (metas.background && metas.content && metas.popup) {
                try {
                  await finalize(metas);
                  console.log('Rebuilt.');
                } catch (err) {
                  console.error('Finalize error:', err);
                }
              }
            });
          },
        },
      ],
    });

  const contexts = await Promise.all([
    makeContext('background', opts.background),
    makeContext('content', opts.content),
    makeContext('popup', opts.popup),
  ]);

  await Promise.all(contexts.map(c => c.watch()));
  console.log('Watching for changes...');
}

const run = isWatch ? buildAndWatch : buildOnce;
run().catch(err => {
  console.error(err);
  process.exit(1);
});
