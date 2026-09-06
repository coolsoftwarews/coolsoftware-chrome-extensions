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

const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const EXTENSION_VERSION = pkg.version;

const BASE_NAME = 'TikTok Media Archiver';
const EXTENSION_NAME = IS_PROD ? BASE_NAME : `${BASE_NAME} (Dev)`;
const SHORT_NAME = 'TT Archiver';
const DESCRIPTION =
  "Save your own posted TikToks in original quality — no export watermark. Restricted to posts you authored; no toggle can change that.";

if (SHORT_NAME.length > 12) throw new Error(`short_name exceeds 12 chars: "${SHORT_NAME}" (${SHORT_NAME.length})`);
if (DESCRIPTION.length > 132) throw new Error(`description exceeds 132 chars: ${DESCRIPTION.length}`);

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

/**
 * Deliberately narrow, matching PRD-45 §6's permissions table exactly:
 * `activeTab`, `downloads`, `storage` + the TikTok host permission only.
 * There is no `tabs` and no `<all_urls>` — the log viewer and CSV/JSON
 * export live inside the page's own shadow root (see content.ts), never a
 * separate extension page, which is what keeps this list from growing to
 * fit the UI rather than the other way round.
 */
async function writeManifest(backgroundScript, contentScript) {
  const manifest = {
    manifest_version: 3,
    name: EXTENSION_NAME,
    short_name: SHORT_NAME,
    version: EXTENSION_VERSION,
    description: DESCRIPTION,
    icons: {
      16: 'icons/icon-16.png',
      32: 'icons/icon-32.png',
      48: 'icons/icon-48.png',
      128: 'icons/icon-128.png',
    },
    action: {
      default_title: 'TikTok Media Archiver — saved videos log',
      default_icon: {
        16: 'icons/icon-16.png',
        32: 'icons/icon-32.png',
        48: 'icons/icon-48.png',
        128: 'icons/icon-128.png',
      },
    },
    permissions: ['activeTab', 'downloads', 'storage'],
    host_permissions: ['*://*.tiktok.com/*'],
    background: {
      service_worker: backgroundScript,
      type: 'module',
    },
    content_scripts: [
      {
        matches: ['*://*.tiktok.com/*'],
        js: [contentScript],
        run_at: 'document_idle',
      },
    ],
    commands: {
      'toggle-saved-log': {
        suggested_key: { default: 'Alt+Shift+S' },
        description: 'Toggle the saved-videos log',
      },
    },
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
  };
}

async function finalize(metas) {
  const backgroundScript = outputNameFor(metas.background, path.join(srcDir, 'background.ts'));
  const contentScript = outputNameFor(metas.content, path.join(srcDir, 'content.ts'));

  await copyIcons();
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
  const [background, content] = await Promise.all([build(opts.background), build(opts.content)]);
  await finalize({ background: background.metafile, content: content.metafile });
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
              if (metas.background && metas.content) {
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

  const contexts = await Promise.all([makeContext('background', opts.background), makeContext('content', opts.content)]);

  await Promise.all(contexts.map(c => c.watch()));
  console.log('Watching for changes...');
}

const run = isWatch ? buildAndWatch : buildOnce;
run().catch(err => {
  console.error(err);
  process.exit(1);
});
