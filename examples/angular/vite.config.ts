import { defineConfig } from 'vite';
import angular from '@analogjs/vite-plugin-angular';

/**
 * Vite config for the Angular example using @analogjs/vite-plugin-angular.
 *
 * Why Vite instead of Angular CLI:
 *
 * - Vite handles `new Worker(new URL('./worker.js', import.meta.url))` natively —
 *   the library's standard worker-loading pattern works out of the box.
 * - No need for `__IC_WORKER_URL` escape hatch or `assets` config.
 * - Worker.js is auto-bundled via Vite's `?worker` import machinery.
 * - Faster dev startup + HMR than Angular CLI.
 *
 * Compared to full Analog framework:
 * - We use only the Vite Angular plugin (`@analogjs/vite-plugin-angular`)
 * - Not the full Analog platform (file-based routing, etc.)
 * - Standalone bootstrap with `bootstrapApplication` — same as Angular CLI
 */
export default defineConfig({
  plugins: [angular()],
  server: { port: 4200, host: '127.0.0.1', open: false },
  preview: { port: 4200, host: '127.0.0.1' },
  optimizeDeps: {
    include: ['@angular/common', '@angular/forms', '@GKz/image-compression'],
  },
});