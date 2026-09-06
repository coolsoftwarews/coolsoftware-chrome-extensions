import { defineConfig } from 'vite';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome110',
    rollupOptions: {
      input: {
        'background/service-worker': resolve(__dirname, 'src/background/service-worker.ts'),
        'content/page-agent': resolve(__dirname, 'src/content/page-agent.ts'),
        'popup/popup': resolve(__dirname, 'src/popup/popup.html'),
        'editor/editor': resolve(__dirname, 'src/editor/editor.html'),
        'offscreen/offscreen': resolve(__dirname, 'src/offscreen/offscreen.html'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
        // The content script is injected as a classic script by chrome.scripting,
        // so it must never be split into an ESM chunk with imports.
        manualChunks: undefined,
        inlineDynamicImports: false,
      },
    },
  },
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
    },
  },
});
