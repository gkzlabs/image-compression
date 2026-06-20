import { defineConfig } from 'vite';
import angular from '@analogjs/vite-plugin-angular';

/**
 * Vite config for the Angular example using @analogjs/vite-plugin-angular.
 *
 * Why Vite instead of Angular CLI:
 *
 * - Vite handles `new Worker(new URL('./worker.js', import.meta.url))` natively —
 *   the library's standard worker-loading pattern works out of the box.
 * - No need for `__IC_WORKER_URL` escape hatch, `assets` config, or `public/`
 *   folder for the worker.
 * - Worker.js is auto-bundled via Vite's `?worker_file` chunk system.
 * - Faster dev startup + HMR than Angular CLI.
 *
 * Two Vite config tweaks are needed:
 *
 * 1. `optimizeDeps.exclude` — Vite's dep optimizer fails on the library's
 *    `new URL('./worker.js', import.meta.url)` pattern with:
 *      "The file does not exist at .../.vite/deps/worker.js?..."
 *    Excluding lets the lib resolve at runtime via Vite's `/@fs/` scheme.
 *
 * 2. `server.fs.allow: ['..', '../..']` — Vite blocks `/@fs/` URLs that point
 *    outside the project root (HTTP 403). The library lives at the
 *    parent's parent (`../../dist/worker.js`). Adding these allows Vite to
 *    serve the worker from there in dev mode.
 *
 * Compared to full Analog framework: we use only the Vite Angular plugin,
 * not the full platform (file-based routing, etc.).
 */
export default defineConfig({
  plugins: [angular()],
  server: {
    port: 4200,
    host: '127.0.0.1',
    open: false,
    fs: {
      allow: ['..', '../..'],
    },
  },
  // Use a different port for preview to avoid conflict with dev server.
  preview: { port: 4300, host: '127.0.0.1' },
  optimizeDeps: {
    exclude: ['@gkzlabs/image-compression'],
  },
});