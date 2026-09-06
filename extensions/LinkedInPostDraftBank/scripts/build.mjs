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
const EXTENSION_NAME = IS_PROD ? 'LinkedIn Post Draft Bank' : 'LinkedIn Post Draft Bank (Dev)';

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

async function writePanelHtml(panelScriptName) {
  const template = await fs.promises.readFile(path.join(srcDir, 'panel.html'), 'utf8');
  // Cache-bust in dev so a reload of the panel actually picks up new code.
  const bust = IS_PROD ? '' : `?v=${Date.now()}`;
  const html = template
    .replace(/__PANEL_JS__/g, panelScriptName + bust)
    .replace(/href="panel\.css"/g, `href="panel.css${bust}"`);
  await fs.promises.writeFile(path.join(distDir, 'panel.html'), html, 'utf8');
}

async function copyStaticAssets() {
  await fs.promises.copyFile(path.join(srcDir, 'panel.css'), path.join(distDir, 'panel.css'));
}

async function writeManifest(backgroundScript, contentScript) {
  const manifest = {
    manifest_version: 3,
    name: EXTENSION_NAME,
    version: EXTENSION_VERSION,
    description:
      'A live "see more" cutoff marker while you write, plus a local library of your own LinkedIn drafts, templates and published posts. No account, no cloud, no AI.',
    icons: {
      16: 'icons/icon-16.png',
      32: 'icons/icon-32.png',
      48: 'icons/icon-48.png',
      128: 'icons/icon-128.png',
    },
    action: {
      default_title: 'Open the draft bank panel',
    },
    // Scoped to LinkedIn only (PRD-35 §6) — this extension has no business on
    // any other site, and never issues a network request of its own anywhere.
    permissions: ['activeTab', 'storage', 'downloads', 'sidePanel'],
    host_permissions: ['*://*.linkedin.com/*'],
    side_panel: {
      default_path: 'panel.html',
    },
    background: {
      service_worker: backgroundScript,
      type: 'module',
    },
    content_scripts: [
      {
        matches: ['*://*.linkedin.com/*'],
        js: [contentScript],
        run_at: 'document_idle',
        all_frames: false,
      },
    ],
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'self'; base-uri 'self'",
    },
  };

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
    panel: {
      ...shared,
      entryPoints: [path.join(srcDir, 'panel.ts')],
      format: 'esm',
      entryNames: '[name]',
    },
  };
}

async function finalize(metas) {
  const backgroundScript = outputNameFor(metas.background, path.join(srcDir, 'background.ts'));
  const contentScript = outputNameFor(metas.content, path.join(srcDir, 'content.ts'));
  const panelScript = outputNameFor(metas.panel, path.join(srcDir, 'panel.ts'));

  await copyStaticAssets();
  await copyIcons();
  await writePanelHtml(panelScript);
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
  // No dependencies anywhere in this extension; the budget is a tripwire for
  // one sneaking in.
  console.log(`Bundle size: ${kb} KB (budget 500 KB)${kb > 500 ? '  *** OVER BUDGET ***' : ''}`);
}

async function buildOnce() {
  await cleanDist();
  const opts = buildOptions();
  const [background, content, panel] = await Promise.all([
    build(opts.background),
    build(opts.content),
    build(opts.panel),
  ]);
  await finalize({
    background: background.metafile,
    content: content.metafile,
    panel: panel.metafile,
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
              if (metas.background && metas.content && metas.panel) {
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
    makeContext('panel', opts.panel),
  ]);

  await Promise.all(contexts.map(c => c.watch()));
  console.log('Watching for changes...');
}

const run = isWatch ? buildAndWatch : buildOnce;
run().catch(err => {
  console.error(err);
  process.exit(1);
});
