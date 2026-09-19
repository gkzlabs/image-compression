/**
 * Worker URL resolution — the single source of truth for `resolveWorker()`.
 *
 * The library bundles a separate Web Worker (`dist/worker.js`) for the
 * `webcodecs-worker` and `offscreen-worker` cascade paths. Three strategies,
 * in order of preference:
 *
 * 1. **`window.__IC_WORKER_URL`** — explicit override (escape hatch for
 *    bundlers that can't rewrite `new URL('./worker.js', import.meta.url)`).
 *    Set before calling `new ImageCompression()`.
 *
 * 2. **`new URL('./worker.js', import.meta.url)`** — recommended path. Works
 *    in vanilla JS, Vite, esbuild, Webpack 5, and Angular CLI 17+ when the
 *    bundler rewrites the pattern. The bundler emits a separate worker chunk
 *    with a cache-busting hash.
 *
 * 3. **`image-compression.worker.js?v=<version>` resolved against
 *    `document.baseURI`** — for consumers that copy `dist/worker.js` to a
 *    stable URL in a postbuild step (e.g. the Angular wrapper). Resolving
 *    against `document.baseURI` instead of a root-absolute `/...` path keeps
 *    the URL correct when the app is deployed under a sub-path.
 *
 * What strategy 3 does NOT do: recover from a 404. `new Worker(url)` with a
 * URL that 404s does not throw synchronously — the failure arrives later as
 * the worker's `error` event. That case is handled at runtime instead:
 * `rpc.ts` rejects every pending RPC when the worker errors, so the cascade
 * falls through to `canvas-main` instead of hanging forever
 * (see `wrap()` in ./rpc.ts).
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
 * Page-relative fallback URL for the standalone worker, with a cache buster.
 *
 * Deliberately built with string concatenation, NOT `new URL(...)`: this is
 * only reached when `new URL()` itself failed (mocking bundlers, invalid
 * `import.meta.url`), so it must not depend on that constructor.
 */
export function workerFallbackUrl(): string {
  const base =
    typeof document !== 'undefined' && typeof document.baseURI === 'string'
      ? document.baseURI
      : '/';
  // baseURI is either a directory ('https://x/app/') or a document
  // ('https://x/app/index.html') — normalise both to the directory.
  const dir = base.endsWith('/') ? base : base.replace(/[^/]*$/, '');
  return `${dir}image-compression.worker.js?v=${VERSION_TAG}`;
}

/**
 * Resolve the Worker URL using the best available strategy.
 * Order of preference: `__IC_WORKER_URL` → `new URL('./worker.js', ...)` →
 * page-relative fallback.
 *
 * Never returns null: if every strategy fails, the last `new Worker(...)`
 * throws, and callers (`ImageCompression.createWorker`) treat that as "no
 * worker available" and let the cascade continue on the main thread.
 */
export function resolveWorker(): Worker {
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
    // Reached when URL construction fails (bundler left `import.meta.url` as
    // a bare specifier, or `new URL` is unavailable/broken). A 404 on a
    // successfully constructed URL does NOT land here — see the header note.
    console.warn(
      '[ImageCompression] new URL("./worker.js", import.meta.url) failed, falling back to a page-relative worker URL:',
      err,
    );
    return new Worker(workerFallbackUrl(), { type: 'module' });
  }
}
