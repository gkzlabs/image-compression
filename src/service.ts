import * as Comlink from 'comlink';
import { detectCapabilities } from './capabilities';
import { CompressionError, extensionForMimeType } from './types';
import type {
  CompressionOptions,
  CompressionPath,
  CompressionProgress,
  CompressionResult,
  DeviceCapabilities,
  ImageWorkerApi,
} from './types';

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
    this.capabilitiesPromise = detectCapabilities().then((caps) => {
      this.capabilities = caps;
      // Fire-and-forget worker probe — updates caps in the background
      this.probeWorkerCapabilities().then((workerCaps) => {
        if (workerCaps && this.capabilities) {
          this.capabilities.hasOffscreenCanvasInWorker = workerCaps.hasOffscreenCanvas;
          this.capabilities.hasWebCodecsInWorker = workerCaps.hasWebCodecs;
          this.capabilities.hasCreateImageBitmapInWorker = workerCaps.hasCreateImageBitmap;
        }
      }).catch((err) => {
        console.warn('[ImageCompression] background worker probe failed:', err);
      });
      return caps;
    });
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
      // Angular 17 application builder pattern
      const worker = new Worker(
        new URL('./image-compression.worker', import.meta.url),
        { type: 'module' },
      );
      // Keep raw reference so terminate() can actually kill the worker
      this.rawWorker = worker;
      return Comlink.wrap<ImageWorkerApi>(worker);
    } catch (err) {
      console.warn('[ImageCompression] failed to spawn worker:', err);
      return null;
    }
  }

  /**
   * Query the Web Worker for its own runtime capabilities.
   * Returns null if the worker can't be created or probed.
   */
  private async probeWorkerCapabilities(): Promise<{
    hasOffscreenCanvas: boolean;
    hasWebCodecs: boolean;
    hasCreateImageBitmap: boolean;
  } | null> {
    try {
      // Race the probe against a 1s timeout. If the worker probe hangs
      // (Comlink mis-config, broken worker URL, etc.) we just return null
      // and the caller stays on main-thread caps. Since this is fire-and-forget
      // background, a longer timeout would just block the next call.
      const probePromise = (async () => {
        const worker = await this.getWorker();
        if (!worker) return null;
        return await worker.getWorkerCapabilities();
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
      return this.buildResult(
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
      const decoded = await this.tryDecodeHEICLazy(file);
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
    const paths = this.selectPaths(caps, options);
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
          emit({ stage: 'done', percent: 100, path, attempt, message: 'Compression complete' });
          return this.buildResult(
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
        }
      } catch (err) {
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
            message: `${path} failed → trying ${nextPath} (${attempt + 1}/${paths.length})`,
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
      let nextIndex = 0;
      let activeCount = 0;
      let completedCount = 0;
      let errored: Error | null = null;

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
              if (errored) return;
              results[fileIndex] = result;
            })
            .catch((err) => {
              if (errored) return;
              errored = err instanceof Error ? err : new Error(String(err));
            })
            .finally(() => {
              activeCount--;
              completedCount++;
              if (errored) {
                reject(errored);
              } else if (completedCount === files.length) {
                resolve(results as CompressionResult[]);
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
   */
  private selectPaths(
    caps: DeviceCapabilities,
    options: CompressionOptions,
  ): CompressionPath[] {
    const paths: CompressionPath[] = [];

    // Use the Worker's own capability detection for Worker paths.
    // Main-thread detection can give false positives (OffscreenCanvas exists
    // in main thread but not in Worker context — common in Safari iOS).
    const workerOC = caps.hasOffscreenCanvasInWorker ?? caps.hasOffscreenCanvas;
    const workerWC = caps.hasWebCodecsInWorker ?? caps.hasWebCodecs;
    const workerCIB = caps.hasCreateImageBitmapInWorker ?? caps.hasCreateImageBitmap;

    // 'webcodecs-worker' = use ImageDecoder (for HEIC) inside Worker context.
    // Requires WebCodecs + OffscreenCanvas + createImageBitmap IN the worker.
    if (workerWC && workerOC && workerCIB && caps.hasWorker) {
      paths.push('webcodecs-worker');
    }
    // 'offscreen-worker' = Canvas2D + createImageBitmap in Worker context.
    // Requires OffscreenCanvas + createImageBitmap IN the worker.
    if (workerOC && workerCIB && caps.hasWorker) {
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
    const onProgress = options.onProgress;
    // Stage 2: Load worker (if not already cached)
    if (!this.worker) {
      onProgress?.({ stage: 'loading-worker', percent: 10, path, message: `Loading worker (${path})...` });
    }
    const worker = await this.getWorker();
    if (!worker) return null;
    // Comlink/structured-clone cannot transfer raw function values via postMessage.
    // Wrap with Comlink.proxy() so the worker can call this callback across
    // the thread boundary (Comlink handles the serialization via its proxy).
    //
    // If the user's onProgress isn't provided, omit it from worker options
    // (the worker's `emit` calls become no-ops).
    const workerOptions: CompressionOptions = { ...options };
    if (options.onProgress) {
      workerOptions.onProgress = Comlink.proxy(options.onProgress);
    }
    const { blob, width, height, mimeType } = await worker.compress(file, workerOptions);
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
      try {
        const img = await this.loadImage(url);
        bitmap = await createImageBitmap(img);
      } finally {
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
        const rotated = applyExifOrientation(bitmap, orientation);
        bitmap.close();
        bitmap = rotated.bitmap as unknown as ImageBitmap;
        outWidth = rotated.width;
        outHeight = rotated.height;
        onProgress?.({ stage: 'resizing', percent: 55, path: 'canvas-main', message: 'Auto-rotated via EXIF' });
      }
    }

    // Manual rotation / mirror
    if (rotate !== undefined || mirror !== undefined) {
      const { applyRotation } = await import('./worker-helpers');
      const rotated = applyRotation(bitmap, rotate ?? 0, mirror);
      bitmap.close();
      bitmap = rotated.bitmap as unknown as ImageBitmap;
      outWidth = rotated.width;
      outHeight = rotated.height;
      onProgress?.({ stage: 'resizing', percent: 65, path: 'canvas-main', message: 'Rotating...' });
    }

    // Resize (maxWidthOrHeight or exact width/height)
    onProgress?.({ stage: 'resizing', percent: 70, path: 'canvas-main', message: 'Resizing...' });
    let targetW = outWidth;
    let targetH = outHeight;
    if (width !== undefined || height !== undefined) {
      // Exact resize: use helper
      const { resizeExact } = await import('./worker-helpers');
      const resized = resizeExact(bitmap, width ?? outWidth, height, keepAspectRatio ?? false);
      bitmap.close();
      bitmap = resized.bitmap as unknown as ImageBitmap;
      targetW = resized.width;
      targetH = resized.height;
    } else {
      // Fit-within-box resize
      if (outWidth > maxWidthOrHeight || outHeight > maxWidthOrHeight) {
        const ratio = outWidth / outHeight;
        if (outWidth >= outHeight) {
          targetW = Math.min(maxWidthOrHeight, outWidth);
          targetH = Math.round(targetW / ratio);
        } else {
          targetH = Math.min(maxWidthOrHeight, outHeight);
          targetW = Math.round(targetH * ratio);
        }
        // Apply via OffscreenCanvas helper for consistency
        const { resizeExact } = await import('./worker-helpers');
        const resized = resizeExact(bitmap, targetW, targetH, false);
        bitmap.close();
        bitmap = resized.bitmap as unknown as ImageBitmap;
        targetW = resized.width;
        targetH = resized.height;
      }
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
    ctx.drawImage(bitmap as unknown as CanvasImageSource, 0, 0);
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
        emit({
          stage: 'done',
          percent: 100,
          path: forcedPath,
          attempt: 1,
          message: 'Compression complete (forced path)',
        });
        return this.buildResult(
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
   * Try to decode HEIC/HEIF to a standard format (JPEG by default).
   *
   * Strategy:
   * 1. **Native ImageDecoder** (iOS Safari 16.4+): zero cost, fastest path
   * 2. **heic2any** (Chrome/Edge/Firefox/etc): dynamic import of WASM-based decoder
   *
   * The heic2any library is ~150 KB and is loaded only when HEIC is encountered.
   * This keeps the initial bundle small for the common case (no HEIC files).
   *
   * @returns Decoded JPEG Blob, or null if both paths fail
   */
  private async tryDecodeHEICLazy(file: File | Blob): Promise<Blob | null> {
    // Path 1: Native ImageDecoder (iOS Safari, Chrome 94+ for some formats)
    if (typeof ImageDecoder !== 'undefined') {
      try {
        const supported = await ImageDecoder.isTypeSupported('image/heic');
        if (supported) {
          const buffer = await file.arrayBuffer();
          const decoder = new ImageDecoder({ data: buffer, type: 'image/heic' });
          const { image } = await decoder.decode();
          decoder.close();
          // VideoFrame -> ImageBitmap -> JPEG Blob
          const bitmap = await createImageBitmap(image);
          const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(bitmap, 0, 0);
            const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.95 });
            bitmap.close();
            return blob;
          }
        }
      } catch {
        // Native decode failed, fall through to heic2any
      }
    }

    // Path 2: heic2any (WASM) — dynamic import, only on HEIC paths
    try {
      // heic2any is an optional, lazy-loaded peer — only present if user installs it.
      // We type the module dynamically via 'any' to avoid hard dependency in our package.json.
      // @ts-expect-error — heic2any is an optional dependency; only required at runtime when HEIC files are encountered.
      const heic2anyModule = await import(/* @vite-ignore */ 'heic2any');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const heic2any = (heic2anyModule as any).default as (opts: { blob: Blob; toType: string }) => Promise<Blob | Blob[]>;
      const result = await heic2any({ blob: file, toType: 'image/jpeg' });
      // heic2any may return a single Blob or array; take first
      return Array.isArray(result) ? result[0] : result;
    } catch {
      // Both paths failed
      return null;
    }
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
  private buildResult(
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
    return this.buildResult(
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
