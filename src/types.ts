/**
 * Framework-agnostic image compression — core types and utilities.
 * No framework dependencies (Angular, React, Vue, etc.).
 * Uses only web APIs: WebCodecs, OffscreenCanvas, Web Workers, and the
 * in-repo zero-dependency RPC layer (src/rpc.ts, replaced Comlink in v0.11.0).
 *
 * 4 compression paths (cascade from best to fallback):
 * 1. webcodecs-worker  — WebCodecs + OffscreenCanvas
 * 2. offscreen-worker  — OffscreenCanvas + Canvas2D
 * 3. canvas-main       — Canvas2D on main thread
 * 4. server-fallback   — Server processes the file
 */
export type CompressionPath =
  | 'webcodecs-worker'
  | 'offscreen-worker'
  | 'canvas-main'
  | 'server-fallback'
  /** File was already small and in target format — no processing done */
  | 'passthrough';

export type OutputFormat = 'image/jpeg' | 'image/webp' | 'image/png' | 'image/avif';

export type DeviceTier = 'high' | 'mid' | 'low';

/**
 * Compression pipeline stages. Reported via the onProgress callback.
 *
 * Flow on a HIGH tier device:
 *   detecting (5%) → loading-worker (10%) → decoding (25%) → resizing (65%) → encoding (95%) → done (100%)
 *
 * Flow on a LOW tier (no Worker):
 *   detecting (5%) → decoding (30%) → resizing (70%) → encoding (95%) → done (100%)
 *
 * Flow on server-fallback:
 *   detecting (5%) → fallback (100%)
 */
export type CompressionStage =
  | 'detecting'      // Detecting device capabilities
  | 'loading-worker' // Initializing Worker (high/mid tier)
  | 'decoding'       // Decoding source image (createImageBitmap / img)
  | 'resizing'       // Resizing to maxWidthOrHeight
  | 'encoding'       // Encoding to target format
  | 'fallback'       // Falling back to next path
  | 'done'           // Successfully completed
  | 'error';         // All paths failed (still returns result via server-fallback)

export interface CompressionProgress {
  /** Current stage in the pipeline */
  stage: CompressionStage;
  /** Estimated progress 0..100 */
  percent: number;
  /** Current path being attempted (may change during cascade) */
  path?: CompressionPath;
  /**
   * Cascade attempt number (1 = first try). Increments when a path fails
   * and the cascade moves to the next path. Stable within a single path.
   */
  attempt?: number;
  /**
   * Total number of paths in the cascade (typically 4 for normal cascade,
   * 1 for forcePath). Lets UIs display "[1/4]" for clarity.
   */
  totalPaths?: number;
  /** Optional human-readable message */
  message?: string;
}

export interface CompressionOptions {
  /** Internal: true once transforms were applied inside the Worker.
   *  Set by `executeWorkerPath()` so the main-thread
   *  `applyTransformsIfRequested()` becomes a no-op (worker already did it).
   *  Prevents double-applying rotate/mirror/exact-size. @internal */
  __transformsApplied?: boolean;
  /** Internal: true once the Worker reached the `maxSizeMB` target in-worker
   *  (via OffscreenCanvas). Set by `executeWorkerPath()` so the main-thread
   *  `reachTargetSize()` becomes a no-op (prevents double re-encode).
   *  On devices WITHOUT a Worker this is never set → the main-thread ladder
   *  still runs as the fallback. @internal */
  __targetSizeApplied?: boolean;
  /** Internal: tagged by the service to indicate which path is executing.
   *  Used by the worker to include the correct path in its progress events.
   *  @internal Not intended for public use. */
  __path?: CompressionPath;
  /** Internal: the `window.__IC_HEIC2ANY_URL` value, forwarded to the Worker by
   *  `executeWorkerPath()` because a Worker has its own global scope and cannot
   *  read the page's. Lets the Worker decode HEIC (native ImageDecoder →
   *  decoder module → bare specifier) without touching the main thread.
   *  @internal Not intended for public use. */
  __heic2anyUrl?: string;
  /** Internal: original file size in bytes. Tagged by the service so
   *  `selectPaths()` can apply the `WORKER_SIZE_THRESHOLD_BYTES` gate
   *  (skip Worker for small files). @internal Not intended for public use. */
  originalSize?: number;
  /**
   * If true, batch compression continues even if individual files fail.
   * Failed files are reported via console.warn instead of rejecting the
   * whole batch. The returned results array still contains the successful
   * files in their original order. Failed files appear as `null` in the
   * result array (with the error logged).
   * Default: false (reject on first error, like Promise.all).
   * Only applies to `compressAll()`. Has no effect on `compress()`.
   *
   * Inspired by `Promise.allSettled()` — use when you want to upload all
   * files even if some fail (e.g., a gallery with mixed valid/corrupt files).
   */
  continueOnError?: boolean;
  /** Max width or height in pixels (default 2048) — fit-within-box resize */
  maxWidthOrHeight?: number;
  /**
   * Exact target width in pixels. Overrides `maxWidthOrHeight` when set.
   * - If only `width` is set: height is auto-computed to preserve aspect ratio
   * - If both `width` and `height` are set: image is stretched to exact size
   *   (may distort — use `keepAspectRatio: true` to fit-within instead)
   */
  width?: number;
  /**
   * Exact target height in pixels. Overrides `maxWidthOrHeight` when set.
   * - If only `height` is set: width is auto-computed to preserve aspect ratio
   * - If both `width` and `height` are set: image is stretched to exact size
   */
  height?: number;
  /**
   * When `width` and `height` are both set, preserve aspect ratio by fitting
   * the image within the box (letterboxing if needed). Default: false.
   * Only applies when both `width` and `height` are provided.
   */
  keepAspectRatio?: boolean;
  /**
   * Manual rotation in degrees clockwise. Default: undefined (use EXIF auto-rotation).
   * Set to 0 to disable EXIF auto-rotation (keeps image as-is, no rotation).
   * Common values: 90, 180, 270.
   */
  rotate?: 0 | 90 | 180 | 270;
  /** Mirror/flip the image after rotation. Default: undefined (no flip). */
  mirror?: 'horizontal' | 'vertical';
  /**
   * @deprecated No-op since v0.11.0 — kept only so existing call sites keep
   * type-checking. The option is never read by the pipeline: re-encoding
   * (canvas / OffscreenCanvas `convertToBlob` / `toBlob`) always discards
   * EXIF, XMP and GPS metadata, and `stripExif` cannot switch that back on.
   * To keep the original file (and its metadata) untouched for files that are
   * already small enough, use `passThroughUnderBytes` instead.
   */
  stripExif?: boolean;
  /** JPEG/WebP/AVIF quality 0..1 (default 0.85) */
  quality?: number;
  /**
   * Target maximum output size in megabytes. When set, the library re-encodes
   * iteratively until the output fits under this limit:
   *   1. Binary-search quality (floor 0.2 by default) at the current
   *      dimensions — the highest quality that still fits is returned.
   *   2. Dimension ladder — only when no quality at that size fits: 100% → 90%
   *      → … → 50% of the current dimensions, re-running the quality search at
   *      each step.
   * The first step that fits wins (largest dimensions + highest quality). If the
   * target is unreachable, the smallest achievable output is returned — read
   * `result.targetMet` rather than parsing console warnings, and set
   * `targetSizeStrict` to keep shrinking past these floors.
   *
   * No-op for `passthrough` / `server-fallback` results (no decode happened).
   * Default: undefined (no size target).
   */
  maxSizeMB?: number;
  /**
   * v1.5.0: refuse inputs whose declared pixel count (`width × height`) exceeds
   * this budget, before anything is decoded.
   *
   * Why: a 4 KB PNG can declare 100 000 × 100 000 pixels — decoding it allocates
   * tens of GB and takes the tab down ("decompression bomb"). The dimensions come
   * from the file header (PNG/JPEG/GIF/WebP), so the rejection costs one 64 KB
   * read and no decode at all.
   *
   * When the budget is exceeded, `compress()` **throws**
   * `CompressionError('FILE_TOO_LARGE')` instead of falling back — silently
   * forwarding a bomb to the server would defeat the point. Containers whose
   * header we cannot read (AVIF/HEIC, BMP, TIFF, …) are not checked pre-decode.
   *
   * Default: undefined (no limit — unchanged behaviour).
   */
  maxPixels?: number;
  /**
   * v1.4.0: keep shrinking past the default floors until the budget is really
   * met — prioritises the size limit over image quality.
   *
   * The ladder then may probe quality down to `minQuality` (default 0.05 in
   * this mode) and dimensions down to `minDimension` px on the longest edge
   * (default 64), preferring to lower quality at the current dimensions before
   * dropping resolution further. Encode work stays bounded (≤64 ladder probes).
   *
   * Default: false (unchanged v1.3.x behaviour: quality floor 0.2, dimensions
   * floor 50%).
   */
  targetSizeStrict?: boolean;
  /**
   * v1.4.0: lowest quality the `maxSizeMB` ladder may probe. Default: 0.2, or
   * 0.05 when `targetSizeStrict` is set. Never raised above `quality`.
   */
  minQuality?: number;
  /**
   * v1.4.0: dimension floor (px, longest edge) for the strict `maxSizeMB`
   * ladder. Default: 64. Ignored unless `targetSizeStrict` is set.
   */
  minDimension?: number;
  /** Output format (default 'image/jpeg') */
  format?: OutputFormat;
  /** v1.3.3: maximum number of files compressed in parallel by
   *  `compressAll()` / `compressAll$()` (default 2, tuned for mobile).
   *  `0` or a negative number means unlimited. Supersedes the deprecated third
   *  positional argument (`compressAll(files, options, maxConcurrent)`), which
   *  still works for backward compatibility. */
  maxConcurrency?: number;
  /**
   * Post-encode sharpening strength, 0..1 (default 0 = off).
   *
   * Downscaling softens edges (even with multi-step + high smoothing).
   * A light unsharp mask restores perceived sharpness. Values:
   *   0    — off (default, fastest — no extra pass)
   *   0.2  — subtle (recommended starting point)
   *   0.5  — noticeable
   *   1    — strong (over-sharpens most photos; use sparingly)
   *
   * Runs on the main thread after the resize step, before encoding. Adds a
   * small CPU cost proportional to output pixels (~1ms per 1000×1000 on
   * typical hardware). Ignored for lossless PNG (no point sharpening
   * lossless pixels).
   */
  sharpen?: number;
  /**
   * Boost quality when the output format is WebP. WebP beats JPEG by ~30%
   * at the same quality, so you can raise quality for free (same output
   * size, visibly sharper result). When true, `quality` is mapped up:
   *   q 0.85 (JPEG) → q 0.95 (WebP) — same size, better clarity
   * Default: false (use the caller's `quality` verbatim).
   * NOTE: the size-parity assumption holds for photos; on low-detail
   * content the boosted output can be 1.5-2× larger than plain WebP.
   */
  qualityBoost?: boolean;
  /** If true, prefer server-side (skip client processing) */
  forceServer?: boolean;
  /**
   * Force a specific compression path. Skips cascade and tries ONLY this path.
   * Use for testing/debug. Throws `CompressionError` with `code: 'INVALID_OPTIONS'`
   * if the path is not a known value. Throws with `code: 'ALL_PATHS_FAILED'` if
   * the path fails (does not silently cascade to other paths).
   */
  forcePath?: CompressionPath;
  /**
   * AbortSignal to cancel an in-flight compression. Throws `CompressionError`
   * with `code: 'ABORTED'` when the signal fires. Checked after each major
   * await point (capability detection, each path attempt).
   */
  signal?: AbortSignal;
  /** Progress callback — fired at each stage transition */
  onProgress?: (progress: CompressionProgress) => void;
  /**
   * Skip compression if the input file is already small enough AND already
   * in the target format. The original file is returned as-is (no decode,
   * no re-encode, no worker spawn) — preserves EXIF and saves CPU/RAM.
   *
   * Useful for batch uploads where most files are already compressed JPEGs.
   * Example: `passThroughUnderBytes: 300 * 1024` skips processing for JPEGs
   * under 300KB.
   *
   * Default: undefined (never pass-through).
   */
  passThroughUnderBytes?: number;
}

/**
 * MIME type → file extension map. Used when constructing a `File` from a
 * compressed `Blob` (preserves original filename with new extension).
 */
const MIME_EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/webp': '.webp',
  'image/png': '.png',
  'image/avif': '.avif',
  'image/heic': '.heic',
  'image/heif': '.heif',
};

/**
 * Get the canonical file extension for a MIME type.
 * Falls back to `.bin` for unknown types.
 */
export function extensionForMimeType(mimeType: string): string {
  return MIME_EXTENSIONS[mimeType.toLowerCase()] ?? '.bin';
}

export interface CompressionResult {
  /**
   * Compressed image as a `File` (preserves original name with new extension).
   * Use directly with `FormData.append('file', result.file, result.file.name)`.
   */
  file: File;
  /**
   * @deprecated Kept for backward compatibility with v0.5.x consumers. `File`
   * extends `Blob`, so `result.file` works anywhere `result.blob` does.
   * Scheduled for removal in v2.0 — note that `isCompressionResult()` keys off
   * this field, so the guard will be updated in the same release.
   */
  blob: Blob;
  /**
   * Filename of the compressed image. Same as `result.file.name`.
   * Useful for displaying in UI: "Compressed: result.name (256 KB)".
   */
  name: string;
  /** Original file size in bytes */
  originalSize: number;
  /** Compressed file size in bytes */
  compressedSize: number;
  /** Output dimensions */
  width: number;
  height: number;
  /** Which path was used */
  path: CompressionPath;
  /** Time taken in milliseconds */
  durationMs: number;
  /** Detected device tier */
  tier: DeviceTier;
  /** Output MIME type */
  mimeType: string;
  /**
   * v1.4.0: whether the output meets the `maxSizeMB` budget
   * (`compressedSize <= maxSizeMB * 1024 * 1024`).
   * - `undefined` when no `maxSizeMB` was requested.
   * - `false` when the budget could not be met (the ladder ran out of floors,
   *   or the file was passed through / left to the server).
   */
  targetMet?: boolean;
  /**
   * v1.4.0: quality the `maxSizeMB` ladder actually used for this output.
   * `undefined` when the ladder did not run (no `maxSizeMB`, pass-through,
   * server-fallback) and for lossless PNG output.
   */
  outputQuality?: number;
  /**
   * v1.4.0: dimension scale the `maxSizeMB` ladder actually used
   * (1 = original dimensions, 0.5 = half). `undefined` when the ladder did not
   * run (e.g. the first encode already fit the budget).
   */
  outputScale?: number;
}

export interface DeviceCapabilities {
  /** WebCodecs API available (ImageDecoder + VideoEncoder) — main thread */
  hasWebCodecs: boolean;
  /** ImageDecoder API available — main thread (subset of WebCodecs) */
  hasImageDecoder: boolean;
  /** VideoEncoder API available — main thread (subset of WebCodecs) */
  hasVideoEncoder: boolean;
  /** OffscreenCanvas API available — main thread */
  hasOffscreenCanvas: boolean;
  /** Worker API available */
  hasWorker: boolean;
  /** createImageBitmap() available — main thread */
  hasCreateImageBitmap: boolean;
  /** HTMLCanvasElement + Canvas2D context available (any of OffscreenCanvas or HTMLCanvasElement) */
  hasCanvas2D: boolean;
  /** Native HEIC decode supported via ImageDecoder */
  supportsHEIC: boolean;
  /** Number of logical CPU cores (navigator.hardwareConcurrency) */
  hardwareConcurrency: number;
  /** Approximate device memory in GB (navigator.deviceMemory, 0 if unavailable) */
  deviceMemory: number;
  /** User has save-data enabled */
  saveData: boolean;
  /** Network effective type (2g/3g/4g/slow-2g) */
  effectiveType: '2g' | '3g' | '4g' | 'slow-2g';
  /** Device tier classification (low/mid/high) */
  tier: DeviceTier;

  // ----- Worker-side capabilities (probed from Worker context) -----
  /** OffscreenCanvas API available in Worker context (may differ from main thread) */
  hasOffscreenCanvasInWorker?: boolean;
  /** WebCodecs API available in Worker context */
  hasWebCodecsInWorker?: boolean;
  /** createImageBitmap() available in Worker context */
  hasCreateImageBitmapInWorker?: boolean;
  /**
   * Whether the Worker paths (webcodecs-worker, offscreen-worker) actually work
   * end-to-end in this environment. Set by `probeWorkerCapabilities()`:
   * - true: probe succeeded (default — probe hasn't run yet, or was successful)
   * - false: probe failed at runtime (e.g. Chrome bitmap detach bug, broken
   *   transferToImageBitmap, etc.). The cascade will skip Worker paths.
   *
   * The runtime probe does an actual decode→draw→encode roundtrip in the Worker
   * to detect subtle environment-specific bugs that simple feature detection
   * misses. This way, the library auto-disables Worker paths on broken browsers
   * without hardcoding browser/UA lists, and auto-re-enables when the bug is fixed.
   */
  workerPathsReliable?: boolean;
}

/**
 * Worker API exposed via the in-repo RPC proxy (src/rpc.ts).
 * Runs in Web Worker context — must be self-contained (no DOM).
 */
export interface ImageWorkerApi {
  /**
   * Compress an image File/Blob.
   * @param file Source image
   * @param options Compression options (NO onProgress — passed as 3rd arg)
   * @param onProgress Progress callback (serialized to a CallbackRef by rpc.ts
   *   so it stays structured-clone safe, then routed back over the same channel)
   * @returns Compressed Blob + dimensions (+ v1.4.0 target-size metadata when
   *   the in-worker `maxSizeMB` ladder produced the output)
   */
  compress(
    file: File | Blob,
    options: CompressionOptions,
    onProgress?: (e: CompressionProgress) => void,
  ): Promise<{
    blob: Blob;
    width: number;
    height: number;
    mimeType: string;
    /** v1.4.0: set by the in-worker target-size ladder (see CompressionResult). */
    targetMet?: boolean;
    outputQuality?: number;
    outputScale?: number;
  }>;

  /**
   * Check if HEIC can be decoded natively (iOS Safari only).
   */
  supportsHEIC(): Promise<boolean>;

  /**
   * Get the actual capabilities inside the worker context.
   * Worker context may differ from main thread.
   */
  getWorkerCapabilities(): Promise<{
    hasOffscreenCanvas: boolean;
    hasWebCodecs: boolean;
    hasCreateImageBitmap: boolean;
  }>;
  /**
   * End-to-end roundtrip probe: decode → drawImage → encode.
   * Catches environment-specific bugs that simple feature detection misses
   * (e.g. Chrome "image source is detached" bug in module workers, broken
   * transferToImageBitmap in Firefox, etc.). The cascade uses this to
   * auto-skip Worker paths in broken environments.
   *
   * @returns true if a full decode+draw+encode roundtrip succeeds, false otherwise.
   */
  probeWorkerPath(): Promise<boolean>;
}

// =============================================================================
// Error types
// =============================================================================

/**
 * Stable, machine-readable error codes returned with `CompressionError`.
 * Use these for programmatic handling (e.g. show user a specific message,
 * trigger a retry, or fall back to a different upload strategy).
 */
export type CompressionErrorCode =
  /** Browser cannot decode HEIC (no ImageDecoder, no heic2any fallback) */
  | 'HEIC_UNSUPPORTED'
  /** Worker initialization failed (CSP, browser policy, OOM) */
  | 'WORKER_INIT_FAILED'
  /** Cascade exhausted: every compression path threw; returning original */
  | 'ALL_PATHS_FAILED'
  /** Caller aborted via AbortSignal */
  | 'ABORTED'
  /** Input is not a valid image (decode failed for all paths) */
  | 'INVALID_FILE'
  /** Options are invalid (e.g. `forcePath` not in known paths) */
  | 'INVALID_OPTIONS'
  /** File is too large for the current device/browser, or over the caller's
   *  `maxPixels` budget (v1.5.0: declared width × height too large) */
  | 'FILE_TOO_LARGE'
  /** Catch-all for unexpected errors */
  | 'UNKNOWN';

/**
 * Thrown by `compress()` when a non-recoverable error occurs.
 * The cascade is designed to never throw for runtime decode/encode failures
 * (it falls back to `server-fallback` and returns the original file).
 * CompressionError is reserved for programmer errors and explicit user actions.
 *
 * @example
 * ```ts
 * try {
 *   await svc.compress(file, { signal: controller.signal });
 * } catch (err) {
 *   if (err instanceof CompressionError && err.code === 'ABORTED') {
 *     // user clicked cancel
 *   }
 * }
 * ```
 */
export class CompressionError extends Error {
  readonly code: CompressionErrorCode;
  /** Path that was being attempted when the error occurred */
  readonly path?: CompressionPath;
  /** Paths tried before giving up (cascade order) */
  readonly tried?: CompressionPath[];
  /** Original error (for `ABORTED`/`UNKNOWN` cases) */
  readonly cause?: unknown;

  constructor(
    code: CompressionErrorCode,
    message: string,
    options?: {
      path?: CompressionPath;
      tried?: CompressionPath[];
      cause?: unknown;
    },
  ) {
    super(message);
    this.name = 'CompressionError';
    this.code = code;
    this.path = options?.path;
    this.tried = options?.tried;
    this.cause = options?.cause;

    // Restore prototype chain after super() (TypeScript transpiles to ES5)
    Object.setPrototypeOf(this, CompressionError.prototype);

    // Maintain proper stack trace in V8 (captureStackTrace is non-standard).
    // Safe to call — guarded with feature detection.
    const ErrorCtor = Error as ErrorConstructor & {
      captureStackTrace?: (target: object, constructorOpt?: Function) => void;
    };
    if (typeof ErrorCtor.captureStackTrace === 'function') {
      ErrorCtor.captureStackTrace(this, CompressionError);
    }
  }
}

/**
 * Type guard for emissions from `compress$()` stream.
 * Returns true for `CompressionResult` (final), false for `CompressionProgress` (in-flight).
 *
 * @example
 * ```ts
 * for await (const evt of svc.compress$(file)) {
 *   if (isCompressionResult(evt)) {
 *     // evt is CompressionResult — has .blob, .file, .name, etc.
 *   } else {
 *     // evt is CompressionProgress — has .stage, .percent
 *   }
 * }
 * ```
 */
export function isCompressionResult(
  evt: CompressionProgress | CompressionResult,
): evt is CompressionResult {
  return 'blob' in evt && 'path' in evt && 'tier' in evt;
}

/**
 * Type guard for emissions from `compressAll$()` stream.
 * Returns true for the final `CompressionResult[]` emission, false for
 * per-file progress events (`{ fileIndex, progress }`).
 *
 * @example
 * ```ts
 * for await (const evt of svc.compressAll$(files)) {
 *   if (isBatchResult(evt)) {
 *     // evt is CompressionResult[] — final array
 *   } else {
 *     // evt is { fileIndex: number; progress: CompressionProgress }
 *   }
 * }
 * ```
 */
export function isBatchResult(
  evt: { fileIndex: number; progress: CompressionProgress } | (CompressionResult | null)[],
): evt is (CompressionResult | null)[] {
  return Array.isArray(evt);
}

/**
 * Build-time constant replaced by the bundler (e.g. esbuild --define or
 * rollup-plugin-replace) to embed the package version in the runtime
 * worker URL cache buster. Defaults to a numeric timestamp at runtime if
 * not defined, which still gives per-build uniqueness.
 */
declare global {
  const __BUILD_VERSION__: string | undefined;
}

export {};
