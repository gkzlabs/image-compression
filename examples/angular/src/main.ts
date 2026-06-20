/**
 * Angular 18 standalone bootstrap for @gkzlabs/image-compression example.
 *
 * ## Vite handles worker bundling automatically
 *
 * The library's source has `new Worker(new URL('./worker.js', import.meta.url))`.
 * Vite detects this pattern and:
 * - **Dev**: serves the worker via a `@fs/` URL (e.g., `/@fs/.../worker.js?worker_file&type=module`)
 * - **Production (npm run build)**: bundles the worker as a separate chunk
 *   (e.g., `dist/assets/worker-<hash>.js`) and the main bundle references it
 *
 * Combined with `optimizeDeps.exclude` in vite.config.ts (the dep optimizer
 * fails on worker.js — it's not a normal module), the library's standard
 * worker URL pattern works out of the box with **zero setup**.
 *
 * ## HEIC support
 *
 * For browsers without native ImageDecoder('image/heic') support, the lib's
 * `tryDecodeHEICLazy()` falls back to importing `heic2any`. In Vite, this
 * deep import may fail because heic2any isn't a normal ES module. To enable
 * HEIC in production, install `heic2any` and copy its UMD bundle to a path
 * the lib can load (e.g., `public/heic2any.js` + set `__IC_HEIC2ANY_URL`).
 * For this minimal demo, HEIC is opt-in.
 */
import 'zone.js';

import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';

bootstrapApplication(AppComponent).catch((err) => console.error(err));