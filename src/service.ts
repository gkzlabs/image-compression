import * as Comlink from 'comlink';
import { detectCapabilities } from './capabilities';
import { CompressionError, CompressionErrorCode, extensionForMimeType } from './types';
import {
  applyExifOrientation,
  applyRotation,
  applyTransforms,
  resizeExact,
} from './worker-helpers';
import type {
  CompressionOptions,
  CompressionPath,
  CompressionProgress,
  CompressionResult,
  DeviceCapabilities,
  ImageWorkerApi,
} from './types';

/**
 * Build-time injected version (replaced by esbuild --define or rollup-plugin-replace).
 * Falls back to a date-based tag at runtime so each unbuilt source has a unique
 * cache buster and Cloudflare doesn't serve a stale worker.
 */
const VERSION_TAG =
  (typeof __BUILD_VERSION__ !== 'undefined' ? __BUILD_VERSION__ : Date.now().toString())
    .replace(/[^a-z0-9.]/gi, '')
    .slice(0, 32) || 'dev';

// ============================================================================
// HEIC pre-decode extracted to ./heic (re-exported here for backwards compat)
// ============================================================================
import { tryDecodeHEICLazy, isHEICFile } from './heic';
export { tryDecodeHEICLazy } from './heic';


/**
 * Resolve the Worker URL using the best available strategy.
 * Order of preference:
 * 1. User-provided `window.__IC_WORKER_URL` (escape hatch for bundlers that
 *    don't rewrite `new URL('./worker', import.meta.url)`)
 * 2. Standard `new URL('./worker', import.meta.url)` (works in vanilla JS,
 *    Vite, esbuild, and Angular CLI 17+ when the import resolves to a file
 *    the bundler can locate)
 * 3. Hard-coded fallback `/image-compression.worker.js?v=2` for consumers
 *    that bundle the worker to a stable URL via a postbuild script.
 *
 * The standard `new URL('./worker', import.meta.url)` pattern is the
 * recommended path. It enables the bundler (esbuild, Vite, Angular CLI 17+)
 * to emit a separate worker chunk with proper cache-busting hash.
 *
 * The legacy `__IC_WORKER_URL` escape hatch is kept for backwards
 * compatibility with consumers on older bundlers.
 *
 * Exported for unit testing (see `worker-resolution.spec.ts`).
 */
export function resolveWorker(): Worker | null {
  if (typeof window !== 'undefined') {
    const overrideUrl = (window as { __IC_WORKER_URL?: string }).__IC_WORKER_URL;
    if (overrideUrl) {
      return new Worker(overrideUrl, { type: 'module' });
    }
  }

  // Strategy 2: Standard `new URL('./worker', import.meta.url)` pattern.
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
    // The `?v=2` cache buster works around Cloudflare Tunnel caching the
    // SPA fallback (HTML) response for the worker URL.
    console.warn(
      '[ImageCompression] new URL("./worker", import.meta.url) failed, falling back to hard-coded URL:',
      err,
    );
    return new Worker(`/image-compression.worker.js?v=${VERSION_TAG}`, { type: 'module' });
  }
}

/**
 * Framework-agnostic image compression service with progressive enhancement.
 *
 * Cascade paths (best to worst):
 * 1. webcodecs-worker  — WebCodecs + OffscreenCanvas in Worker (best)
 * 2. offscreen-worker  — OffscreenCanvas + Canvas2D in Worker
 * 3. canvas-main       — Canvas2D on main thread
 * 4. server-fallback   — Returns the original file (caller uploads to server)
 *
 * Each path has try/catch fallback to the next. Never throws to the caller.
 *
 * Usage:
 * ```ts
 * import { ImageCompression } from '@GKz/image-compression';
 *
 * const svc = new ImageCompression();
 * const result = await svc.compress(file, { quality: 0.85 });
 * // result.blob, result.file, result.name, result.path, etc.
 *
 * // Cleanup when done
 * svc.dispose();
 * ```
 */
export class ImageCompression {
  /** Idle timeout for the Web Worker (ms). Worker is terminated after this
   * period of inactivity to free memory. Set to 0 to disable. Default: 30s. */
  private static readonly WORKER_IDLE_TIMEOUT_MS = 30_000;

  /**
   * Files smaller than this (in bytes) skip Worker paths entirely.
   *
   * Why: Worker spawn + structured-clone of the Blob is ~30-100ms of overhead.
   * For files under 100KB, the entire compression pipeline runs in <50ms on
   * the main thread, so the Worker overhead would be a net loss.
   *
   * Tuned empirically: 100KB is the sweet spot where:
   * - Smaller files: canvas-main is faster end-to-end
   * - Larger files: Worker wins because it doesn't block the UI thread
   *
   * Exposed for testing. Not part of the public API.
   */
  protected static readonly WORKER_SIZE_THRESHOLD_BYTES = 100_000;

  private capabilities: DeviceCapabilities | null = null;
  private capabilitiesPromise: Promise<DeviceCapabilities> | null = null;
  private worker: Comlink.Remote<ImageWorkerApi> | null = null;
  private workerPromise: Promise<Comlink.Remote<ImageWorkerApi> | null> | null = null;
  /** Raw Worker reference (for .terminate() cleanup). Comlink wraps the worker but doesn't expose terminate. */
  private rawWorker: Worker | null = null;
  /** Timer for idle-worker cleanup. */
  private workerIdleTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Lazy-init: detect capabilities on first call, cache forever.
   *
   * Returns main-thread capabilities IMMEDIATELY (no worker probe).
   * The worker probe runs in the background and updates caps when ready.
   * This way getCapabilities() never blocks the UI.
   *
   * Note: until the worker probe completes, the cascade may include
   * Worker paths that would fail. The cascade's automatic fallback to
   * canvas-main handles this — compression always succeeds, just may
   * be slower for the first call after page load.
   */
  getCapabilities(): Promise<DeviceCapabilities> {
    if (this.capabilities) return Promise.resolve(this.capabilities);
    if (this.capabilitiesPromise) return this.capabilitiesPromise;
    this.capabilitiesPromise = detectCapabilities()
      .then((caps) => {
        this.capabilities = caps;
        // Fire-and-forget worker probe — updates caps in the background.
        // We create a NEW object (not mutate) so subscribers using object
        // identity (like Angular signals) see the change.
        // After probe completes (success or timeout/error), we update the
        // worker caps to their final values (true if available, false if not).
        // This way the UI can distinguish "still probing" from "probed, not available".
        this.probeWorkerCapabilities()
          .then((workerCaps) => {
            if (this.capabilities) {
              this.capabilities = {
                ...this.capabilities,
                hasOffscreenCanvasInWorker: workerCaps?.hasOffscreenCanvas ?? false,
                hasWebCodecsInWorker: workerCaps?.hasWebCodecs ?? false,
                hasCreateImageBitmapInWorker: workerCaps?.hasCreateImageBitmap ?? false,
                // `roundtripOk` is the result of the actual decode→draw→encode
                // test in the worker. If false, the cascade skips Worker paths
                // (Chrome bitmap detach bug, broken transferToImageBitmap, etc.).
                // workerCaps is null on probe timeout — treat as "reliable" (default)
                // so a slow probe doesn't break the cascade.
                workerPathsReliable: workerCaps ? workerCaps.roundtripOk : true,
              };
            }
          })
          .catch((err) => {
            console.warn('[ImageCompression] background worker probe failed:', err);
            if (this.capabilities) {
              this.capabilities = {
                ...this.capabilities,
                hasOffscreenCanvasInWorker: false,
                hasWebCodecsInWorker: false,
                hasCreateImageBitmapInWorker: false,
                // Probe threw — assume paths are reliable (default) and let
                // the cascade's try/catch fallback handle any actual runtime
                // failure. Being too aggressive here would disable Worker
                // paths on transient errors.
                workerPathsReliable: true,
              };
            }
          });
        return caps;
      })
      .catch((err) => {
        console.warn('[ImageCompression] capability detection failed:', err);
        // Return minimal low-tier capabilities
        const fallback: DeviceCapabilities = {
          hasWebCodecs: false,
          hasImageDecoder: false,
          hasVideoEncoder: false,
          hasOffscreenCanvas: false,
          hasWorker: false,
          hasCreateImageBitmap: false,
          hasCanvas2D: typeof HTMLCanvasElement !== 'undefined',
          supportsHEIC: false,
          hardwareConcurrency: 2,
          deviceMemory: 0,
          saveData: false,
          effectiveType: '4g',
          tier: 'low',
        };
        this.capabilities = fallback;
        return fallback;
      });
    return this.capabilitiesPromise;
  }

  /**
   * Lazy-init: create Worker on first call, reuse for all subsequent calls.
   * Returns null if Worker cannot be created.
   */
  private async getWorker(): Promise<Comlink.Remote<ImageWorkerApi> | null> {
    if (this.worker) {
      this.resetWorkerIdleTimer();
      return Promise.resolve(this.worker);
    }
    if (this.workerPromise) return this.workerPromise;
    this.workerPromise = this.createWorker()
      .then((w) => {
        this.worker = w;
        if (w) this.resetWorkerIdleTimer();
        return w;
      })
      .catch((err) => {
        console.warn('[ImageCompression] worker creation failed:', err);
        return null;
      });
    return this.workerPromise;
  }

  /**
   * Schedule worker termination after WORKER_IDLE_TIMEOUT_MS of inactivity.
   * Prevents zombie workers in long-lived SPAs that call compress() once
   * and never again. Reset on every compress() call.
   */
  private resetWorkerIdleTimer(): void {
    if (this.workerIdleTimer) clearTimeout(this.workerIdleTimer);
    if (ImageCompression.WORKER_IDLE_TIMEOUT_MS <= 0) return;
    this.workerIdleTimer = setTimeout(() => {
      // Silent idle shutdown — user is done, free memory
      this.terminate();
    }, ImageCompression.WORKER_IDLE_TIMEOUT_MS);
  }

  private async createWorker(): Promise<Comlink.Remote<ImageWorkerApi> | null> {
    // Verify worker context will have what we need
    if (typeof Worker === 'undefined') return null;
    try {
      const worker = await resolveWorker();
      if (!worker) return null;
      // Keep raw reference so terminate() can actually kill the worker
      this.rawWorker = worker;
      return Comlink.wrap<ImageWorkerApi>(worker);
    } catch (err) {
      console.warn('[ImageCompression] failed to spawn worker:', err);
      return null;
    }
  }

  /**
   * Query the Web Worker for its own runtime capabilities AND a roundtrip
   * probe. Returns null if the worker can't be created or probed.
   *
   * Two probes run together (each in parallel, bounded by a 1s timeout):
   * 1. `getWorkerCapabilities()` — fast static checks (OffscreenCanvas,
   *    WebCodecs, createImageBitmap). Used to detect false positives where
   *    main-thread has the API but Worker context doesn't (Safari iOS).
   * 2. `probeWorkerPath()` — actual decode→draw→encode roundtrip. Catches
   *    environment-specific bugs that simple feature detection misses
   *    (Chrome "image source is detached", Firefox broken transferToImageBitmap,
   *    etc.). Used to auto-skip Worker paths in broken environments.
   */
  private async probeWorkerCapabilities(): Promise<{
    hasOffscreenCanvas: boolean;
    hasWebCodecs: boolean;
    hasCreateImageBitmap: boolean;
    roundtripOk: boolean;
  } | null> {
    try {
      // Race the probe against a 1s timeout. If the worker probe hangs
      // (Comlink mis-config, broken worker URL, etc.) we just return null
      // and the caller stays on main-thread caps. Since this is fire-and-forget
      // background, a longer timeout would just block the next call.
      const probePromise = (async () => {
        const worker = await this.getWorker();
        if (!worker) return null;
        // Run both probes in parallel — they're independent.
        const [caps, roundtripOk] = await Promise.all([
          worker.getWorkerCapabilities(),
          worker.probeWorkerPath().catch(() => false),
        ]);
        return { ...caps, roundtripOk };
      })();
      const timeoutPromise = new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), 1000),
      );
      return (await Promise.race([probePromise, timeoutPromise])) ?? null;
    } catch (err) {
      console.warn('[ImageCompression] worker capability probe failed:', err);
      return null;
    }
  }

  /**
   * Main entry: compress an image with progressive enhancement.
   * Returns a CompressionResult regardless of which path was used.
   * Never throws — falls back to server-fallback (returns original).
   *
   * Pass `options.onProgress` to receive stage-based progress updates:
   *   - 'detecting' (5%) — checking device capabilities
   *   - 'loading-worker' (10%) — initializing Worker
   *   - 'decoding' (20-30%) — decoding source image
   *   - 'resizing' (50-70%) — resizing to maxWidthOrHeight
   *   - 'encoding' (95%) — encoding to target format
   *   - 'done' (100%) — completed
   *   - 'fallback' — cascading to next path
   */
  async compress(
    file: File | Blob,
    options: CompressionOptions = {},
  ): Promise<CompressionResult> {
    const start = performance.now();
    const onProgress = options.onProgress;

    /**
     * Emit a progress event. Wraps the user's onProgress callback.
     * We pre-compute `totalPaths` once the cascade plan is known and
     * inject it into every event so UIs can display "[N/M]" prefixes.
     */
    let totalPaths: number | undefined;
    const emit = (p: CompressionProgress) => {
      if (totalPaths !== undefined && p.totalPaths === undefined) {
        p.totalPaths = totalPaths;
      }
      onProgress?.(p);
    };

    // Stage 1: Detect capabilities
    emit({ stage: 'detecting', percent: 5, message: 'Checking device capabilities...' });
    const caps = await this.getCapabilities();
    this.checkAborted(options.signal);

    const originalSize = file.size;
    const name = file instanceof File ? file.name : 'image';

    // Smart pass-through: skip compression if file is already small + correct format.
    // Saves CPU/RAM and preserves EXIF (no decode/re-encode).
    const targetFormat = options.format ?? 'image/jpeg';
    if (
      options.passThroughUnderBytes !== undefined &&
      originalSize <= options.passThroughUnderBytes &&
      // Match target format. Note: 'image/jpg' alias is treated as 'image/jpeg'.
      (file.type === targetFormat ||
        (targetFormat === 'image/jpeg' && file.type === 'image/jpg'))
    ) {
      emit({
        stage: 'fallback',
        percent: 100,
        path: 'passthrough',
        message: `File already ${targetFormat} and ${(originalSize / 1024).toFixed(0)}KB (≤ ${(options.passThroughUnderBytes / 1024).toFixed(0)}KB) — skipping compression`,
      });
      return ImageCompression.buildResult(
        file as Blob,
        originalSize,
        'passthrough',
        caps.tier,
        performance.now() - start,
        0,
        0,
        targetFormat,
        file,
      );
    }

    // Skip if server is forced — bypass all client processing including HEIC decode.
    // Caller wants the file sent to the server as-is.
    if (options.forceServer) {
      emit({ stage: 'fallback', percent: 100, path: 'server-fallback', message: 'Server-side processing' });
      return this.makeServerResult(file, caps.tier, start, originalSize);
    }

    // HEIC pre-decode: try native ImageDecoder, fall back to heic2any (lazy import)
    // On success, the decoded JPEG replaces the HEIC file for the cascade.
    //
    // Why pre-decode in the service (not in the worker)?
    // - heic2any is a CommonJS WASM module that doesn't bundle cleanly into a
    //   Web Worker context. Pre-decoding in the main thread avoids that.
    // - The worker also has its own tryDecodeHEIC (native ImageDecoder only)
    //   as defense-in-depth: if main-thread decode fails AND the user did NOT
    //   set forcePath, the HEIC file falls through to the cascade. The worker's
    //   tryDecodeHEIC may succeed in browsers where the main thread's path failed.
    if (this.isHEICFile(file)) {
      emit({ stage: 'decoding', percent: 10, message: 'Decoding HEIC (may load WASM decoder)...' });
      const decoded = await tryDecodeHEICLazy(file);
      this.checkAborted(options.signal);
      if (decoded) {
        file = decoded;
        emit({ stage: 'decoding', percent: 20, message: 'HEIC decoded, continuing cascade' });
      } else if (options.forcePath) {
        // Caller asked for a specific path; respect that and fail loudly
        throw new CompressionError(
          'HEIC_UNSUPPORTED',
          'HEIC decode failed (no native ImageDecoder, heic2any failed)',
          { tried: [options.forcePath] },
        );
      } else {
        // Cascade will fall through; emit note and let it try
        emit({ stage: 'fallback', percent: 10, message: 'HEIC decode failed, will use server fallback' });
      }
    }

    // forcePath: skip cascade, try only the specified path
    if (options.forcePath !== undefined) {
      return await this.executeForcedPath(
        options.forcePath,
        file,
        options,
        caps,
        start,
        originalSize,
        emit,
      );
    }

    // Try paths in cascade order
    const tried: CompressionPath[] = [];
    // Inject originalSize into options so selectPaths() can apply the
    // WORKER_SIZE_THRESHOLD_BYTES gate. Not part of the public API.
    const paths = this.selectPaths(caps, {
      ...options,
      originalSize,
    } as CompressionOptions);
    // Once the cascade plan is known, set totalPaths so every subsequent
    // emit() can include it. UIs display this as "[N/M]" prefix.
    totalPaths = paths.length;

    for (let i = 0; i < paths.length; i++) {
      const path = paths[i];
      tried.push(path);
      const attempt = i + 1;
      try {
        emit({ stage: 'decoding', percent: 20, path, attempt, message: `Trying ${path} (attempt ${attempt})` });
        const result = await this.executePath(path, file, options, caps);
        this.checkAborted(options.signal);
        if (result) {
          // Stage 1 done. v0.10.9: chain compress-then-transform for
          // manual rotate/mirror/width/height on the main thread.
          const baseResult = ImageCompression.buildResult(
            result.blob,
            originalSize,
            path,
            caps.tier,
            performance.now() - start,
            result.width,
            result.height,
            result.mimeType,
            file,
          );
          const finalResult = await ImageCompression.applyTransformsIfRequested(baseResult, options);
          this.checkAborted(options.signal);
          emit({ stage: 'done', percent: 100, path: finalResult.path, attempt, message: 'Compression complete' });
          return finalResult;
        }
      } catch (err) {
        const errMsg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
        console.warn(`[ImageCompression] path ${path} failed:`, err);
        if (i < paths.length - 1) {
          // Include both the failed path (path) and the next path being tried (attempt+1)
          const nextPath = paths[i + 1];
          emit({
            stage: 'fallback',
            percent: 0,
            path,
            attempt,
            totalPaths: paths.length,
            // Show the actual error message so users can debug without DevTools
            message: `${path} failed (${errMsg}) → trying ${nextPath} (${attempt + 1}/${paths.length})`,
          });
        }
        // Continue to next path
      }
    }

    // All paths failed — return original (server will process)
    emit({ stage: 'error', percent: 100, path: 'server-fallback', message: 'All paths failed, using original' });
    return this.makeServerResult(file, caps.tier, start, originalSize, tried);
  }

  /**
   * Batch compression: process multiple files with bounded concurrency.
   *
   * Results are returned in the same order as input. If any file fails, the
   * entire batch rejects with the first error (use `compress()` individually
   * for partial-success scenarios).
   *
   * @param files Array of files to compress
   * @param options Shared options (same as `compress()`)
   * @param maxConcurrent Max files processed in parallel (default 2 for mobile).
   *                     Set to 0 or negative to mean Infinity (unlimited).
   *                     Recommended: 2-3 for mobile, 4-8 for desktop.
   */
  async compressAll(
    files: (File | Blob)[],
    options: CompressionOptions = {},
    maxConcurrent = 2,
  ): Promise<CompressionResult[]> {
    if (files.length === 0) return [];

    return new Promise<CompressionResult[]>((resolve, reject) => {
      const results: (CompressionResult | null)[] = new Array(files.length).fill(null);
      const errors: (CompressionError | null)[] = new Array(files.length).fill(null);
      let nextIndex = 0;
      let activeCount = 0;
      let completedCount = 0;
      let errored: Error | null = null;
      const continueOnError = options.continueOnError === true;

      const launchNext = (): void => {
        if (errored) return;
        while (
          nextIndex < files.length &&
          (maxConcurrent <= 0 || activeCount < maxConcurrent)
        ) {
          const fileIndex = nextIndex++;
          activeCount++;
          const file = files[fileIndex];

          const wrappedOnProgress = options.onProgress
            ? (e: CompressionProgress) => {
                (options.onProgress as (e: CompressionProgress, idx: number) => void)(e, fileIndex);
              }
            : undefined;

          this.compress(file, { ...options, onProgress: wrappedOnProgress })
            .then((result) => {
              if (errored && !continueOnError) return;
              results[fileIndex] = result;
            })
            .catch((err) => {
              if (errored && !continueOnError) return;
              const wrapped =
                err instanceof CompressionError
                  ? err
                  : new CompressionError(
                      'UNKNOWN' satisfies CompressionErrorCode,
                      err instanceof Error ? err.message : String(err),
                    );
              errors[fileIndex] = wrapped;
              if (!continueOnError) {
                errored = wrapped;
              }
            })
            .finally(() => {
              activeCount--;
              completedCount++;
              if (errored && !continueOnError) {
                reject(errored);
              } else if (completedCount === files.length) {
                if (errored) {
                  // Reject with the first error
                  reject(errored);
                } else {
                  // Resolve with results (errors are null in this branch since
                  // continueOnError=false would have rejected)
                  resolve(results as CompressionResult[]);
                }
              } else {
                launchNext();
              }
            });
        }
      };

      launchNext();
    });
  }

  /**
   * Decide which paths to try and in what order.
   * Returns an ordered array of CompressionPath.
   *
   * **v0.10.0 change (Worker-first default)**: Paths are ordered with Worker
   * first, falling back to main thread. This matches the behavior of the
   * v0.5.7 Angular wrapper.
   *
   /**
    * Decide which paths to try and in what order.
    * Returns an ordered array of CompressionPath.
    *
    * v0.10.4: Reverted path-selection logic to match v0.5.7. The v0.10.0
    * gating on `*InWorker` flags was too strict — when the background
    * probe returned null (timeout) or reported `false` for any flag, the
    * cascade skipped Worker paths entirely, falling through to `canvas-main`
    * even when the Worker would have worked. This broke the v0.5.7
    * UX of "webcodecs-worker attempt #1" on Safari iOS, mobile Chrome, and
    * slow-probe environments.
    *
    * The fix: trust main-thread capabilities for path selection. The
    * cascade's try/catch fallback handles actual runtime failures
    * gracefully (e.g., if OffscreenCanvas doesn't work in Worker context
    * at runtime, we fall back to canvas-main without losing the user).
    *
    * The 100KB size threshold is kept as a perf optimization (Worker
    * spawn overhead > savings for tiny files). The background probe
    * is kept for `workerPathsReliable` flag (currently unused but available
    * for future tuning).
    */
   protected selectPaths(
     caps: DeviceCapabilities,
     options: CompressionOptions,
   ): CompressionPath[] {
     const paths: CompressionPath[] = [];

     // v0.10.10: if user requested any manual transform (rotate/mirror/
     // exact width or exact height), skip the Worker paths entirely.
     // Worker paths only do resize+encode, then Stage 2 re-decodes and
     // re-encodes on the main thread. The 2-stage pipeline is correct but
     // triggers Chrome 149's "image source is detached" bug on the
     // intermediate transferToImageBitmap in some sequences (rotate +
     // exact resize in particular). For correctness, prefer canvas-main
     // which handles all transforms in a single in-place pipeline.
     //
     // Trade-off: files > 100KB skip the Worker speedup. Acceptable
     // because the user is requesting extra processing anyway, and the
     // transform step is the bottleneck.
     const hasTransformRequest =
       options.rotate !== undefined ||
       options.mirror !== undefined ||
       options.width !== undefined ||
       options.height !== undefined;
     const skipWorker = hasTransformRequest;

     // Size threshold: skip Worker for small files (overhead > savings).
     // Use the originalSize from options if available (set by compress() before
     // calling selectPaths), otherwise assume non-small (don't gate on unknown).
     const fileSize = (options as { originalSize?: number }).originalSize ?? Infinity;
     const smallFile = fileSize < ImageCompression.WORKER_SIZE_THRESHOLD_BYTES;

     // 'webcodecs-worker' = use ImageDecoder (for HEIC) inside Worker context.
     // v0.10.4: Use MAIN-THREAD caps (v0.5.7 behavior). The cascade's try/catch
     // handles actual Worker runtime failures — no need to gate on probe results.
     if (!skipWorker && !smallFile && caps.hasWebCodecs && caps.hasOffscreenCanvas && caps.hasWorker) {
       paths.push('webcodecs-worker');
     }
     // 'offscreen-worker' = Canvas2D + createImageBitmap in Worker context.
     if (!skipWorker && !smallFile && caps.hasOffscreenCanvas && caps.hasWorker) {
       paths.push('offscreen-worker');
     }
     if (caps.hasCanvas2D) {
       paths.push('canvas-main');
     }

     return paths;
   }

  /**
   * Execute a specific compression path. Returns null on failure.
   */
  private async executePath(
    path: CompressionPath,
    file: File | Blob,
    options: CompressionOptions,
    caps: DeviceCapabilities,
  ): Promise<Omit<CompressionResult, 'originalSize' | 'path' | 'durationMs' | 'tier' | 'file' | 'name'> | null> {
    // Tag the options with the actual path so the worker can include it
    // in its progress events. Cleaner than passing a separate parameter.
    const optionsWithPath: CompressionOptions = { ...options, __path: path };
    switch (path) {
      case 'webcodecs-worker':
      case 'offscreen-worker':
        return this.executeWorkerPath(file, optionsWithPath, path);

      case 'canvas-main':
        return this.executeCanvasMainPath(file, options, caps);

      case 'server-fallback':
        return null; // handled by caller

      default:
        return null;
    }
  }

  /**
   * Path 1 & 2: Compress via Web Worker.
   */
  private async executeWorkerPath(
    file: File | Blob,
    options: CompressionOptions,
    path: CompressionPath,
  ): Promise<Omit<CompressionResult, 'originalSize' | 'path' | 'durationMs' | 'tier' | 'file' | 'name'> | null> {
    // Comlink/structured-clone cannot transfer raw function values via postMessage.
    // Comlink.proxy only detects the marker on TOP-LEVEL arguments, not nested
    // in options. So we pass onProgress as a SEPARATE top-level argument.
    const { onProgress, ...optionsOnly } = options;
    const workerOptions = optionsOnly as CompressionOptions;
    // Stage 2: Load worker (if not already cached)
    if (!this.worker) {
      onProgress?.({ stage: 'loading-worker', percent: 10, path, message: `Loading worker (${path})...` });
    }
    const worker = await this.getWorker();
    if (!worker) return null;
    const progressProxy = onProgress ? Comlink.proxy(onProgress) : undefined;
    const { blob, width, height, mimeType } = await worker.compress(
      file,
      workerOptions,
      progressProxy,
    );
    return { blob, compressedSize: blob.size, width, height, mimeType };
  }

  /**
   * Path 3: Compress on main thread using Canvas2D.
   * May block UI briefly. Last resort before server fallback.
   */
  private async executeCanvasMainPath(
    file: File | Blob,
    options: CompressionOptions,
    caps: DeviceCapabilities,
  ): Promise<Omit<CompressionResult, 'originalSize' | 'path' | 'durationMs' | 'tier' | 'file' | 'name'> | null> {
    const {
      maxWidthOrHeight = 2048,
      quality = 0.85,
      format = 'image/jpeg',
      width,
      height,
      keepAspectRatio,
      rotate,
      mirror,
    } = options;
    const onProgress = options.onProgress;

    // Try createImageBitmap first (HW decode)
    let bitmap: ImageBitmap | null = null;
    if (caps.hasCreateImageBitmap) {
      try {
        bitmap = await createImageBitmap(file);
      } catch {
        bitmap = null;
      }
    }

    // Fallback: img element → createImageBitmap
    if (!bitmap) {
      const url = URL.createObjectURL(file);
      let img: HTMLImageElement | null = null;
      try {
        img = await this.loadImage(url);
        bitmap = await createImageBitmap(img);
      } finally {
        // Release the img's data promptly so GC can collect it
        // (HTMLImageElement holds a reference to the URL's data even after
        // URL.revokeObjectURL is called, until src is cleared).
        if (img) img.src = '';
        URL.revokeObjectURL(url);
      }
    }

    if (!bitmap) {
      throw new Error('Failed to decode image for canvas-main path');
    }

    onProgress?.({ stage: 'decoding', percent: 30, path: 'canvas-main', message: 'Decoding image...' });

    let outWidth = bitmap.width;
    let outHeight = bitmap.height;

    // EXIF auto-rotation (if not overridden by manual rotate)
    if (rotate === undefined) {
      const { readExifOrientation, applyExifOrientation } = await import('./worker-helpers');
      const orientation = await readExifOrientation(file);
      if (orientation !== 1) {
        // v0.10.2: applyExifOrientation is sync again (uses transferToImageBitmap)
        const rotated = applyExifOrientation(bitmap, orientation);
        bitmap.close();
        bitmap = rotated.bitmap as unknown as ImageBitmap;
        outWidth = rotated.width;
        outHeight = rotated.height;
        onProgress?.({ stage: 'resizing', percent: 55, path: 'canvas-main', message: 'Auto-rotated via EXIF' });
      }
    }

    // Manual rotation / mirror (v0.10.8: restored applyRotation helper)
    if (rotate !== undefined || mirror !== undefined) {
      const rotated = applyRotation(
        bitmap as unknown as ImageBitmap,
        (rotate as 0 | 90 | 180 | 270 | undefined) ?? 0,
        mirror,
      );
      bitmap.close();
      bitmap = rotated.bitmap as unknown as ImageBitmap;
      outWidth = rotated.width;
      outHeight = rotated.height;
      onProgress?.({ stage: 'resizing', percent: 65, path: 'canvas-main', message: 'Rotating...' });
    }

    // Resize (maxWidthOrHeight or exact width/height) — v0.10.8: restored resizeExact helper
    onProgress?.({ stage: 'resizing', percent: 70, path: 'canvas-main', message: 'Resizing...' });
    let targetW = outWidth;
    let targetH = outHeight;
    let needsResize = false;
    if (width !== undefined || height !== undefined) {
      if (width !== undefined && height !== undefined && !keepAspectRatio) {
        targetW = width;
        targetH = height;
      } else if (width !== undefined && height === undefined) {
        targetW = width;
        targetH = Math.round((width * outHeight) / outWidth);
      } else if (height !== undefined && width === undefined) {
        targetH = height;
        targetW = Math.round((height * outWidth) / outHeight);
      } else if (keepAspectRatio) {
        const ratio = outWidth / outHeight;
        if (width! / height! > ratio) {
          targetH = height!;
          targetW = Math.round(height! * ratio);
        } else {
          targetW = width!;
          targetH = Math.round(width! / ratio);
        }
      }
      needsResize = targetW !== outWidth || targetH !== outHeight;
    } else if (outWidth > maxWidthOrHeight || outHeight > maxWidthOrHeight) {
      const ratio = outWidth / outHeight;
      if (outWidth >= outHeight) {
        targetW = Math.min(maxWidthOrHeight, outWidth);
        targetH = Math.round(targetW / ratio);
      } else {
        targetH = Math.min(maxWidthOrHeight, outHeight);
        targetW = Math.round(targetH * ratio);
      }
      needsResize = true;
    }
    if (needsResize) {
      // v0.10.10: draw directly onto the final encode canvas at the target
      // dimensions, skipping the intermediate `resizeExact()` (which uses
      // `transferToImageBitmap` and triggers Chrome 149's "image source is
      // detached" bug when chained after applyRotation's transfer).
      // We close the source bitmap AFTER the drawImage succeeds, so it stays
      // alive through the encode step.
      outWidth = targetW;
      outHeight = targetH;
      // Defer the actual draw to the encode step below — it already
      // does `ctx.drawImage(bitmap, 0, 0)` at line 948. We need to extend
      // that to draw at the target dimensions. Use a flag for the encode
      // step to know.
      needsResize = true; // re-set (was already true, but explicit)
      onProgress?.({ stage: 'resizing', percent: 80, path: 'canvas-main', message: 'Resized' });
    }

    // Encode
    onProgress?.({ stage: 'encoding', percent: 90, path: 'canvas-main', message: 'Encoding...' });
    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas2D context unavailable');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    // v0.10.10: when needsResize is true, draw at target dimensions
    // directly (skips the intermediate resizeExact+transferToImageBitmap
    // step that triggered Chrome 149's detach bug). Otherwise draw 1:1.
    if (needsResize) {
      ctx.drawImage(bitmap as unknown as CanvasImageSource, 0, 0, targetW, targetH);
    } else {
      ctx.drawImage(bitmap as unknown as CanvasImageSource, 0, 0);
    }
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), format, quality);
    });
    if (!blob) throw new Error('toBlob returned null');

    return {
      blob,
      compressedSize: blob.size,
      width: targetW,
      height: targetH,
      mimeType: format,
    };
  }

  private loadImage(src: string, timeoutMs = 15_000): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      // Guard against browser bugs where neither onload nor onerror fires
      // (e.g. CSP, network glitch, malformed response). Without this,
      // the cascade would hang forever on canvas-main path.
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Image load timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      const cleanup = () => {
        clearTimeout(timer);
        img.onload = null;
        img.onerror = null;
      };

      img.onload = () => {
        cleanup();
        resolve(img);
      };
      img.onerror = () => {
        cleanup();
        reject(new Error('Image load failed'));
      };
      img.src = src;
    });
  }

  /**
   * v0.10.9: Compress-then-Transform stage.
   *
   * If the caller requested manual transforms (`rotate`, `mirror`, exact
   * `width`/`height`), apply them to the compressed result ON THE MAIN THREAD.
   * The Worker path intentionally does NOT apply these (it would re-introduce
   * the v0.10.6 module-worker bitmap detach race). This helper fills the gap:
   *   1. Decode the compressed blob with `createImageBitmap` (HW-accelerated)
   *   2. Apply combined rotate+mirror+exact-resize in a single OffscreenCanvas draw
   *   3. Re-encode with `canvas.toBlob` (preserves the caller's quality/format)
   *
   * **No-op conditions** (returns input unchanged):
   *   - No transform options set
   *   - Source path is 'passthrough' (no decode happened)
   *   - Source path is 'server-fallback' (caller wants raw file)
   *   - Source blob has 0×0 dimensions (placeholder)
   *
   * **Performance**: Adds 1 extra decode + 1 extra encode round-trip.
   * Since the input is the *compressed* output (already resized by Worker),
   * this is fast even on large original files. The trade-off: we keep
   * Worker's resize+encode speed (Stage 1) AND get correct transforms
   * (Stage 2) — without the worker detach risk of v0.10.6.
   *
   * @param result  Compression result from the cascade or forced-path
   * @param options Caller's options (only `rotate`/`mirror`/`width`/`height` are used)
   * @returns New result with transforms applied, or input unchanged if no-op
   *
   * Exposed (named export) for direct unit testing — see
   * `applyTransformsIfRequested.spec.ts`.
   */
  static async applyTransformsIfRequested(
    result: CompressionResult,
    options: CompressionOptions,
  ): Promise<CompressionResult> {
    const { rotate, mirror, width, height, keepAspectRatio } = options;

    // No-op: caller didn't request any manual transforms
    const hasManualTransform =
      rotate !== undefined || mirror !== undefined || width !== undefined || height !== undefined;
    if (!hasManualTransform) return result;

    // No-op: passthrough/server-fallback never decoded the image
    if (result.path === 'passthrough' || result.path === 'server-fallback') return result;

    // v0.10.10: canvas-main already applies transforms in-place during
    // its pipeline (executeCanvasMainPath calls applyRotation/resizeExact
    // before encoding). Calling applyTransformsIfRequested again on a
    // canvas-main result would double-apply (rotate 90° twice = rotate 180°).
    // Skip Stage 2 entirely for canvas-main results.
    if (result.path === 'canvas-main') return result;

    // No-op: source has no dimensions (shouldn't happen post-cascade, but defensive)
    if (result.width === 0 || result.height === 0) return result;

    const format = result.mimeType || 'image/jpeg';
    const quality = options.quality ?? 0.85;

    // Stage 2a: decode the compressed output
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(result.blob);
    } catch (err) {
      // Decode failed — return original result with a warning.
      // We don't fail the whole compress() because the user did get
      // a valid compressed image; transforms are a "nice to have".
      console.warn('[ImageCompression] applyTransforms: failed to decode output blob', err);
      return result;
    }

    // Stage 2b: combined transforms
    // v0.10.10: draw the source bitmap directly onto the encode canvas with
    // transform math applied, instead of going through
    // `applyTransforms → transferToImageBitmap` (which triggered Chrome
    // 149's "image source is detached" bug on the resulting bitmap).
    // We compute targetW/targetH here, then draw once on the encode canvas.
    let exactW = width;
    let exactH = height;
    if (exactW !== undefined && exactH === undefined) {
      exactH = keepAspectRatio === false
        ? Math.round((exactW * bitmap.height) / bitmap.width)
        : bitmap.height; // keepAspectRatio: explicit width → no exact resize
    } else if (exactH !== undefined && exactW === undefined) {
      exactW = keepAspectRatio === false
        ? Math.round((exactH * bitmap.width) / bitmap.height)
        : bitmap.width;
    } else if (
      (width !== undefined || height !== undefined) &&
      keepAspectRatio !== false &&
      // BOTH set: skip this branch (we want exact resize)
      !(width !== undefined && height !== undefined)
    ) {
      // keepAspectRatio + only one dim: ignore the explicit dim (proportional)
      exactW = undefined;
      exactH = undefined;
    }
    const hasTransform =
      rotate !== undefined ||
      mirror !== undefined ||
      (exactW !== undefined && exactH !== undefined);

    // Compute final dimensions for the encode canvas
    const swap = rotate === 90 || rotate === 270;
    const afterRotateW = swap ? bitmap.height : bitmap.width;
    const afterRotateH = swap ? bitmap.width : bitmap.height;
    const hasExactResize = exactW !== undefined && exactH !== undefined;
    const finalW: number = hasExactResize ? (exactW as number) : afterRotateW;
    const finalH: number = hasExactResize ? (exactH as number) : afterRotateH;

    // Stage 2c: re-encode — draw directly with transform math (no transfer)
    const canvas = document.createElement('canvas');
    canvas.width = finalW;
    canvas.height = finalH;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bitmap.close();
      console.warn('[ImageCompression] applyTransforms: Canvas2D context unavailable');
      return result;
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    if (hasTransform) {
      // Apply rotate+mirror in a single draw, like applyTransforms does
      ctx.translate(finalW / 2, finalH / 2);
      if (rotate !== undefined && rotate !== 0) {
        ctx.rotate((rotate * Math.PI) / 180);
      }
      if (mirror === 'horizontal') ctx.scale(-1, 1);
      else if (mirror === 'vertical') ctx.scale(1, -1);
      ctx.translate(-bitmap.width / 2, -bitmap.height / 2);
      if (hasExactResize) {
        ctx.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height);
      } else {
        ctx.drawImage(bitmap, 0, 0);
      }
    } else {
      // No transform — just draw at target dims (handles maxWidthOrHeight case)
      ctx.drawImage(bitmap, 0, 0, finalW, finalH);
    }
    bitmap.close();

    const newBlob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), format, quality);
    });
    if (!newBlob) {
      console.warn('[ImageCompression] applyTransforms: toBlob returned null');
      return result;
    }

    // Return a new CompressionResult that wraps the transformed blob.
    // We re-use buildResult so filename extension stays consistent.
    const newResult = ImageCompression.buildResult(
      newBlob,
      result.originalSize,
      result.path,
      result.tier,
      result.durationMs,
      finalW,
      finalH,
      format,
      result.file,
    );
    return newResult;
  }

  /**
   * Execute a single forced path (no cascade). Used when `forcePath` is set.
   * Validates the path, then either returns the result or throws CompressionError.
   */
  private async executeForcedPath(
    forcedPath: CompressionPath,
    file: File | Blob,
    options: CompressionOptions,
    caps: DeviceCapabilities,
    start: number,
    originalSize: number,
    emit: (p: CompressionProgress) => void,
  ): Promise<CompressionResult> {
    const KNOWN_PATHS: readonly CompressionPath[] = [
      'webcodecs-worker',
      'offscreen-worker',
      'canvas-main',
      'server-fallback',
    ] as const;

    // Validate
    if (!KNOWN_PATHS.includes(forcedPath)) {
      throw new CompressionError(
        'INVALID_OPTIONS',
        `forcePath must be one of: ${KNOWN_PATHS.join(', ')}. Got: ${String(forcedPath)}`,
        { path: forcedPath, tried: [forcedPath] },
      );
    }

    // 'server-fallback' is essentially forceServer
    if (forcedPath === 'server-fallback') {
      emit({
        stage: 'fallback',
        percent: 100,
        path: 'server-fallback',
        message: 'Server-side processing (forced)',
      });
      return this.makeServerResult(file, caps.tier, start, originalSize, [forcedPath]);
    }

    // Try the single path
    emit({
      stage: 'decoding',
      percent: 20,
      path: forcedPath,
      attempt: 1,
      message: `Forced path: ${forcedPath}`,
    });
    try {
      const result = await this.executePath(forcedPath, file, options, caps);
      this.checkAborted(options.signal);
      if (result) {
        // v0.10.9: chain compress-then-transform (same as cascade path)
        const baseResult = ImageCompression.buildResult(
          result.blob,
          originalSize,
          forcedPath,
          caps.tier,
          performance.now() - start,
          result.width,
          result.height,
          result.mimeType,
          file,
        );
        const finalResult = await ImageCompression.applyTransformsIfRequested(baseResult, options);
        this.checkAborted(options.signal);
        emit({
          stage: 'done',
          percent: 100,
          path: finalResult.path,
          attempt: 1,
          message: 'Compression complete (forced path)',
        });
        return finalResult;
      }
      // executePath returned null (path not viable for this device)
      throw new CompressionError(
        'ALL_PATHS_FAILED',
        `Forced path '${forcedPath}' is not viable on this device`,
        { path: forcedPath, tried: [forcedPath] },
      );
    } catch (err) {
      // Re-throw CompressionError as-is
      if (err instanceof CompressionError) throw err;
      // Wrap other errors
      throw new CompressionError(
        'ALL_PATHS_FAILED',
        `Forced path '${forcedPath}' failed: ${err instanceof Error ? err.message : String(err)}`,
        { path: forcedPath, tried: [forcedPath], cause: err },
      );
    }
  }

  /**
   * Check if the AbortSignal has been triggered. Throws CompressionError(ABORTED)
   * if so. Call after each major await point to keep cancellation responsive.
   */
  private checkAborted(signal: AbortSignal | undefined): void {
    if (signal?.aborted) {
      throw new CompressionError(
        'ABORTED',
        'Compression aborted by caller',
        { cause: signal.reason },
      );
    }
  }

  /**
   * Detect HEIC/HEIF files by extension or MIME type.
   * Used to trigger the HEIC pre-decode path before the cascade.
   */
  private isHEICFile(file: File | Blob): boolean {
    if (file instanceof File && /\.(heic|heif)$/i.test(file.name)) return true;
    return file.type === 'image/heic' || file.type === 'image/heif';
  }

  /**
   * Wrap a Blob/File in a proper CompressionResult with:
   * - `file`: File with preserved name + corrected extension (based on mimeType)
   * - `name`: file.name (same as file.name, for convenience)
   * - `blob`: same reference as file (File extends Blob, so this is backward-compatible)
   *
   * If the input is already a File, the name is reused (with extension replaced
   * to match the new mimeType). If it's a Blob without a name, 'image.{ext}' is used.
   *
   * **Memory optimization:** if the input blob is already a File with a matching
   * type AND the extension is already correct (no rename needed), the original
   * File is returned as-is (no copy, no allocation). This preserves the original
   * reference for tests/debugging and saves a Blob allocation.
   *
   * @param preserveOriginalName If true, the original filename is kept unchanged
   *   (no extension replacement). Used by server-fallback paths where the
   *   server is expected to handle any extension based on mime type.
   */
  private static buildResult(
    blob: Blob,
    originalSize: number,
    path: CompressionPath,
    tier: CompressionResult['tier'],
    durationMs: number,
    width: number,
    height: number,
    mimeType: string,
    originalFile?: File | Blob,
    preserveOriginalName = false,
  ): CompressionResult {
    // Fast path: input is already a File with matching type + no rename needed.
    // Returns the original File reference (no copy, no allocation).
    if (blob instanceof File && blob.type === mimeType) {
      const needsRename = !preserveOriginalName && originalFile instanceof File &&
        originalFile.name.replace(/\.[^./\\]+$/, '') + extensionForMimeType(mimeType) !== blob.name;
      if (!needsRename) {
        return {
          blob,
          file: blob,
          name: blob.name,
          originalSize,
          compressedSize: blob.size,
          width,
          height,
          mimeType,
          path,
          durationMs,
          tier,
        };
      }
    }

    // Slow path: build a new File (renamed extension or different mimeType).
    let name: string;
    if (preserveOriginalName && originalFile instanceof File) {
      // Keep original name as-is (e.g. for server-fallback paths)
      name = originalFile.name;
    } else if (originalFile instanceof File) {
      const baseName = originalFile.name.replace(/\.[^./\\]+$/, '');
      name = baseName + extensionForMimeType(mimeType);
    } else {
      name = 'image' + extensionForMimeType(mimeType);
    }

    const file = new File(
      [blob],
      name,
      {
        type: mimeType,
        lastModified: originalFile instanceof File ? originalFile.lastModified : Date.now(),
      },
    );

    return {
      blob: file,
      file,
      name: file.name,
      originalSize,
      compressedSize: blob.size,
      width,
      height,
      mimeType,
      path,
      durationMs,
      tier,
    };
  }

  private makeServerResult(
    file: File | Blob,
    tier: CompressionResult['tier'],
    start: number,
    originalSize: number,
    _tried?: CompressionPath[],
  ): CompressionResult {
    return ImageCompression.buildResult(
      file as Blob,
      originalSize,
      'server-fallback',
      tier,
      performance.now() - start,
      0,
      0,
      file.type || 'application/octet-stream',
      file,
      true, // preserveOriginalName — server handles any extension
    );
  }

  /**
   * Terminate the Worker (cleanup). Call on service destroy if needed.
   * Actually kills the underlying OS worker — releases memory immediately.
   * Safe to call multiple times.
   */
  terminate(): void {
    if (this.workerIdleTimer) {
      clearTimeout(this.workerIdleTimer);
      this.workerIdleTimer = null;
    }
    if (this.rawWorker) {
      this.rawWorker.terminate(); // Kill the OS worker — frees memory
      this.rawWorker = null;
    }
    this.worker = null;
    this.workerPromise = null;
  }

  /**
   * Release resources. Call when the service is no longer needed.
   * Terminates the Web Worker and clears cached state.
   * Safe to call multiple times.
   */
  dispose(): void {
    this.terminate();
  }
}
