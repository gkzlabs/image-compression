/**
 * Angular 17 standalone bootstrap for @GKz/image-compression example.
 * Minimal — no NgModule, no router, no providers beyond what's required.
 *
 * ## Why the escape hatch?
 *
 * Angular CLI's dev server uses Vite internally, but its dep optimization
 * doesn't pre-bundle worker files referenced via `new URL('./worker.js',
 * import.meta.url)`. The worker's @fs URL returns 404 in dev mode.
 *
 * We copy the worker to `src/assets/image-compression.worker.js` (via
 * angular.json `assets` config) so Angular CLI's dev server serves it at
 * `/assets/image-compression.worker.js`. The escape hatch tells the library
 * to use that URL instead of the (broken) standard pattern.
 *
 * In **production** (`ng build`), the postbuild `build:worker` script bundles
 * the worker to `dist/.../image-compression.worker.js` and the library's
 * hardcoded fallback URL `/image-compression.worker.js?v=<version>` resolves
 * correctly. The escape hatch URL also works in production because Angular
 * CLI hashes assets but keeps the same logical path.
 *
 * No escape hatch is needed for Vite-based examples (react, vue, svelte,
 * vanilla) — their dev servers handle `new URL('./worker.js', ...)` correctly.
 */
(window as { __IC_WORKER_URL?: string }).__IC_WORKER_URL = '/assets/image-compression.worker.js';

import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';

bootstrapApplication(AppComponent).catch((err) => console.error(err));