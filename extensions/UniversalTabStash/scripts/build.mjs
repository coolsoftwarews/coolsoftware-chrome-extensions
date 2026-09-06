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
const EXTENSION_NAME = IS_PROD ? 'Universal Tab Stash & Reading-List Export' : 'Tab Stash (Dev)';

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
  await fs.promises.copyFile(path.join(srcDir, 'welcome.html'), path.join(distDir, 'welcome.html'));
}

async function writeManifest(backgroundScript, panelScript) {
  const manifest = {
    manifest_version: 3,
    name: EXTENSION_NAME,
    version: EXTENSION_VERSION,
    description:
      'Stash a set of tabs, close them, and get them back whenever you’re ready. Export as a Markdown reading list or CSV. No account, no cloud.',
    icons: {
      16: 'icons/icon-16.png',
      32: 'icons/icon-32.png',
      48: 'icons/icon-48.png',
      128: 'icons/icon-128.png',
    },
    action: {
      default_title: 'Open tab stash panel',
    },
    // No host_permissions and no activeTab/scripting: this extension never
    // injects into a page. It only reads/opens/closes tabs via chrome.tabs,
    // which is core browser functionality, not a page-level "write action"
    // (PRD §5/§6). This is close to the floor for a tab-management tool.
    permissions: ['tabs', 'storage', 'downloads', 'sidePanel'],
    side_panel: {
      default_path: 'panel.html',
    },
    background: {
      service_worker: backgroundScript,
      type: 'module',
    },
    commands: {
      'open-tab-stash-panel': {
        suggested_key: { default: 'Alt+Shift+T' },
        description: 'Open the tab stash panel',
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
  const panelScript = outputNameFor(metas.panel, path.join(srcDir, 'panel.ts'));

  await copyStaticAssets();
  await copyIcons();
  await writePanelHtml(panelScript);
  await writeManifest(backgroundScript, panelScript);
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
  const [background, panel] = await Promise.all([build(opts.background), build(opts.panel)]);
  await finalize({ background: background.metafile, panel: panel.metafile });
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
              if (metas.background && metas.panel) {
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
