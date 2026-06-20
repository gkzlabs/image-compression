/**
 * Worker URL resolution.
 *
 * The library bundles a separate Web Worker (`dist/worker.js`) for the
 * `webcodecs-worker` and `offscreen-worker` cascade paths. There are
 * several strategies for finding the worker at runtime:
 *
 * 1. **`window.__IC_WORKER_URL`** — explicit override (escape hatch for
 *    bundlers that can't rewrite `new URL('./worker', import.meta.url)`).
 *    Set before calling `new ImageCompression()`.
 *
 * 2. **Standard `new URL('./worker.js', import.meta.url)`** — recommended
 *    path. Works in vanilla JS, Vite, esbuild, Webpack 5, and Angular
 *    CLI 17+ (when they can resolve the file). The bundler emits a
 *    separate worker chunk with a cache-busting hash.
 *
 * 3. **Hard-coded fallback `/image-compression.worker.js?v=<version>`** —
 *    for consumers that bundle the worker to a stable URL via a
 *    postbuild script (e.g. Angular wrapper's `scripts/build-worker.js`).
 *
 * The legacy `__IC_WORKER_URL` escape hatch is kept for backwards
 * compatibility with consumers on older bundlers.
 *
 * Exported for unit testing (see `worker-resolution.spec.ts`).
 */

/**
 * Build-time injected version (replaced by esbuild --define or
 * rollup-plugin-replace). Falls back to a date-based tag at runtime so
 * each unbuilt source has a unique cache buster and Cloudflare doesn't
 * serve a stale worker.
 */
export const VERSION_TAG =
  (typeof __BUILD_VERSION__ !== 'undefined' ? __BUILD_VERSION__ : Date.now().toString())
    .replace(/[^a-z0-9.]/gi, '')
    .slice(0, 32) || 'dev';

/**
 * Resolve the Worker URL using the best available strategy.
 * Order of preference: `__IC_WORKER_URL` → `new URL('./worker.js', ...)` → hard-coded fallback.
 */
export function resolveWorker(): Worker | null {
  // Strategy 1: Explicit override via global
  if (typeof window !== 'undefined') {
    const overrideUrl = (window as { __IC_WORKER_URL?: string }).__IC_WORKER_URL;
    if (overrideUrl) {
      return new Worker(overrideUrl, { type: 'module' });
    }
  }

  // Strategy 2: Standard `new URL('./worker.js', import.meta.url)` pattern.
  // Works in:
  // - Vanilla JS (import.meta.url = dist/index.js location)
  // - Vite, esbuild, Webpack 5, Angular CLI 17+ (when they can resolve the file)
  try {
    return new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  } catch (err) {
    // Strategy 3: Hard-coded fallback for bundlers that don't rewrite
    // `new URL('./...', import.meta.url)`. Angular CLI 17's esbuild has
    // known issues with this pattern when the import is from node_modules —
    // the URL stays as the raw file name and the browser gets a 404.
    // The `?v=<VERSION_TAG>` cache buster works around Cloudflare Tunnel
    // caching the SPA fallback (HTML) response for the worker URL.
    console.warn(
      '[ImageCompression] new URL("./worker", import.meta.url) failed, falling back to hard-coded URL:',
      err,
    );
    return new Worker(`/image-compression.worker.js?v=${VERSION_TAG}`, { type: 'module' });
  }
}