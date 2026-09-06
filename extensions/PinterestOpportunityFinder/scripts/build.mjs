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
const EXTENSION_NAME = IS_PROD ? 'Pinterest Opportunity Finder' : 'Pinterest Opportunity Finder (Dev)';

/**
 * Every Pinterest ccTLD the extension runs on (PRD-16 §7: "the manifest must
 * cover them"). Chrome's match-pattern grammar allows only one wildcard, as a
 * leading `*.` label, so the PRD table's shorthand of a wildcard TLD is not
 * valid manifest syntax — this is the expanded, explicit list.
 *
 * IMPORTANT: kept in sync by hand with src/domains.ts's PINTEREST_DOMAINS —
 * this plain .mjs script cannot import a .ts module without a compile step,
 * and duplicating a 30-line const is cheaper than adding one.
 */
const PINTEREST_DOMAINS = [
  'pinterest.com',
  'pinterest.ca',
  'pinterest.co.uk',
  'pinterest.fr',
  'pinterest.de',
  'pinterest.es',
  'pinterest.com.au',
  'pinterest.ph',
  'pinterest.ch',
  'pinterest.com.mx',
  'pinterest.dk',
  'pinterest.pt',
  'pinterest.ru',
  'pinterest.it',
  'pinterest.at',
  'pinterest.jp',
  'pinterest.cl',
  'pinterest.ie',
  'pinterest.co.kr',
  'pinterest.nz',
  'pinterest.vn',
  'pinterest.co',
  'pinterest.com.uy',
  'pinterest.com.pe',
  'pinterest.nl',
  'pinterest.co.id',
  'pinterest.hu',
  'pinterest.co.in',
  'pinterest.se',
];
const HOST_PERMISSIONS = PINTEREST_DOMAINS.map(domain => `*://*.${domain}/*`);

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
  const bust = IS_PROD ? '' : `?v=${Date.now()}`;
  const html = template
    .replace(/__PANEL_JS__/g, panelScriptName + bust)
    .replace(/href="panel\.css"/g, `href="panel.css${bust}"`);
  await fs.promises.writeFile(path.join(distDir, 'panel.html'), html, 'utf8');
}

async function copyStaticAssets() {
  await fs.promises.copyFile(path.join(srcDir, 'panel.css'), path.join(distDir, 'panel.css'));
}

async function writeManifest(contentScript) {
  const manifest = {
    manifest_version: 3,
    name: EXTENSION_NAME,
    version: EXTENSION_VERSION,
    description:
      'Badges outlier pins on a Pinterest search against the median of the loaded results, and surfaces the keywords, domains and formats those outliers share. No account, no cloud.',
    icons: {
      16: 'icons/icon-16.png',
      32: 'icons/icon-32.png',
      48: 'icons/icon-48.png',
      128: 'icons/icon-128.png',
    },
    action: {
      default_title: 'Pinterest Opportunity Finder',
      default_popup: 'panel.html',
    },
    // Exactly PRD-16 §6's NFR row: activeTab, storage, downloads + the
    // Pinterest host list. No sidePanel, no scripting, no tabs — this is a
    // plain toolbar popup and a manifest-declared content script, neither of
    // which needs them.
    permissions: ['activeTab', 'storage', 'downloads'],
    host_permissions: HOST_PERMISSIONS,
    content_scripts: [
      {
        matches: HOST_PERMISSIONS,
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
  const contentScript = outputNameFor(metas.content, path.join(srcDir, 'content.ts'));
  const panelScript = outputNameFor(metas.panel, path.join(srcDir, 'panel.ts'));

  await copyStaticAssets();
  await copyIcons();
  await writePanelHtml(panelScript);
  await writeManifest(contentScript);
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
  const [content, panel] = await Promise.all([build(opts.content), build(opts.panel)]);
  await finalize({ content: content.metafile, panel: panel.metafile });
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
              if (metas.content && metas.panel) {
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

  const contexts = await Promise.all([makeContext('content', opts.content), makeContext('panel', opts.panel)]);

  await Promise.all(contexts.map(c => c.watch()));
  console.log('Watching for changes...');
}

const run = isWatch ? buildAndWatch : buildOnce;
run().catch(err => {
  console.error(err);
  process.exit(1);
});
