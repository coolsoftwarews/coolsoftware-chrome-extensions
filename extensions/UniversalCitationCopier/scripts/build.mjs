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
const EXTENSION_NAME = IS_PROD ? 'Universal Citation & Link Copier' : 'Citation Copier (Dev)';

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

async function copyStaticAssets(popupScriptName, offscreenScriptName) {
  const bust = IS_PROD ? '' : `?v=${Date.now()}`;

  const popupTemplate = await fs.promises.readFile(path.join(srcDir, 'popup.html'), 'utf8');
  const popupHtml = popupTemplate
    .replace('src="popup.js"', `src="${popupScriptName}${bust}"`)
    .replace('href="popup.css"', `href="popup.css${bust}"`);
  await fs.promises.writeFile(path.join(distDir, 'popup.html'), popupHtml, 'utf8');
  await fs.promises.copyFile(path.join(srcDir, 'popup.css'), path.join(distDir, 'popup.css'));

  const offscreenTemplate = await fs.promises.readFile(path.join(srcDir, 'offscreen.html'), 'utf8');
  const offscreenHtml = offscreenTemplate.replace('src="offscreen.js"', `src="${offscreenScriptName}${bust}"`);
  await fs.promises.writeFile(path.join(distDir, 'offscreen.html'), offscreenHtml, 'utf8');
}

async function writeManifest(backgroundScript) {
  const manifest = {
    manifest_version: 3,
    name: EXTENSION_NAME,
    version: EXTENSION_VERSION,
    description:
      'Copy the current page as a Markdown link, plain URL, or an APA/MLA/Chicago citation. No account, no cloud, no network requests.',
    icons: {
      16: 'icons/icon-16.png',
      32: 'icons/icon-32.png',
      48: 'icons/icon-48.png',
      128: 'icons/icon-128.png',
    },
    action: {
      default_popup: 'popup.html',
      default_title: 'Copy citation for this page',
    },
    // <all_urls> is unavoidable for a universal citation tool (PRD §6) — it
    // works on whatever page the user is reading, not an allowlist. No
    // "downloads" permission: the only output is a clipboard write. No
    // "clipboardWrite" permission either — MV3 has no such manifest
    // permission; clipboard access is the standard Web Clipboard API, gated
    // by document focus/user-activation, not by anything declared here.
    permissions: ['activeTab', 'scripting', 'storage', 'offscreen'],
    host_permissions: ['<all_urls>'],
    background: {
      service_worker: backgroundScript,
      type: 'module',
    },
    commands: {
      'quick-copy': {
        suggested_key: { default: 'Ctrl+Shift+U', mac: 'Command+Shift+U' },
        description: 'Copy this page in your last-used citation format',
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
    offscreen: {
      ...shared,
      entryPoints: [path.join(srcDir, 'offscreen.ts')],
      format: 'esm',
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
  const offscreenScript = outputNameFor(metas.offscreen, path.join(srcDir, 'offscreen.ts'));
  const popupScript = outputNameFor(metas.popup, path.join(srcDir, 'popup.ts'));

  await copyStaticAssets(popupScript, offscreenScript);
  await copyIcons();
  await writeManifest(backgroundScript);
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
  // No runtime dependencies anywhere in this extension; the budget is a
  // tripwire for one sneaking in.
  console.log(`Bundle size: ${kb} KB (budget 300 KB)${kb > 300 ? '  *** OVER BUDGET ***' : ''}`);
}

async function buildOnce() {
  await cleanDist();
  const opts = buildOptions();
  const [background, offscreen, popup] = await Promise.all([
    build(opts.background),
    build(opts.offscreen),
    build(opts.popup),
  ]);
  await finalize({
    background: background.metafile,
    offscreen: offscreen.metafile,
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
              if (metas.background && metas.offscreen && metas.popup) {
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
    makeContext('offscreen', opts.offscreen),
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
