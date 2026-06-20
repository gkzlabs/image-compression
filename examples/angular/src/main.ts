/**
 * Angular 17 standalone bootstrap for @GKz/image-compression example.
 * Minimal — no NgModule, no router, no providers beyond what's required.
 *
 * ## Worker URL strategy
 *
 * The library's `resolveWorker()` has 3 strategies:
 *   1. `window.__IC_WORKER_URL` (escape hatch)
 *   2. `new URL('./worker.js', import.meta.url)` (standard pattern — works in Vite dev)
 *   3. Hardcoded fallback `/image-compression.worker.js?v=<version>` (works in prod)
 *
 * Angular CLI's Vite-based dev server doesn't pre-bundle workers from libraries,
 * so strategy 2 fails (404). We use strategy 1 with a **relative path** so the
 * URL is computed dynamically from the current page location:
 *
 *   - dev:  http://127.0.0.1:4200/ → http://127.0.0.1:4200/image-compression.worker.js
 *   - prod: https://example.com/  → https://example.com/image-compression.worker.js
 *
 * The worker.js is copied to Angular's `public/` folder (auto-served at root)
 * by the `prebuild` script — see package.json `start`/`build` scripts and
 * `scripts/setup-worker.mjs`.
 */
const workerUrl = new URL('image-compression.worker.js', document.baseURI).href;
(window as unknown as { __IC_WORKER_URL: string }).__IC_WORKER_URL = workerUrl;

import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';

bootstrapApplication(AppComponent).catch((err) => console.error(err));