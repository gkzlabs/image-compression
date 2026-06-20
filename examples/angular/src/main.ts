/**
 * Angular 18 standalone bootstrap for @GKz/image-compression example.
 *
 * ## Why Vite instead of Angular CLI?
 *
 * Vite handles `new URL('./worker.js', import.meta.url)` natively via the
 * `@analogjs/vite-plugin-angular` plugin. The library's standard worker-
 * loading pattern works out of the box — no escape hatch, no `assets`
 * config, no `setup-worker.mjs` postbuild script needed.
 *
 * ## Migration from Angular CLI:
 * - Removed `__IC_WORKER_URL` escape hatch (Vite handles worker natively)
 * - Removed `angular.json` `assets` config
 * - Removed `scripts/setup-worker.mjs` (no copy needed)
 * - Removed `public/image-compression.worker.js` (Vite bundles it)
 * - Removed `polyfills` from angular.json (Vite imports them via main.ts)
 */
import 'zone.js';

import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';

bootstrapApplication(AppComponent).catch((err) => console.error(err));