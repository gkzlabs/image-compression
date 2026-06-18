/**
 * Framework-agnostic image compression — core types and utilities.
 * No framework dependencies (Angular, React, Vue, etc.).
 * Uses only web APIs: WebCodecs, OffscreenCanvas, Web Workers, Comlink.
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

export type OutputFormat = 'image/jpeg' | 'image/webp' | 'image/png';

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
  /** Cascade attempt number (1 = first try) */
  attempt?: number;
  /** Optional human-readable message */
  message?: string;
}

export interface CompressionOptions {
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
   * Strip EXIF metadata from the output. Default: true.
   * When true (default), all EXIF data is removed during re-encoding.
   * When false, EXIF orientation is auto-applied but other metadata
   * (camera, GPS, timestamps) is also removed by re-encoding.
   *
   * Note: re-encoding always strips most EXIF data. To preserve full EXIF,
   * use `passThroughUnderBytes` (which returns the original file unchanged).
   */
  stripExif?: boolean;
  /** JPEG/WebP quality 0..1 (default 0.85) */
  quality?: number;
  /** Output format (default 'image/jpeg') */
  format?: OutputFormat;
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
   * @deprecated Use `result.file` instead. `File` extends `Blob`, so all
   * Blob methods work on `result.file`. This property is kept for backward
   * compatibility with v0.5.x and will be removed in v1.0.
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
}

export interface DeviceCapabilities {
  /** WebCodecs API (VideoEncoder + ImageDecoder) */
  hasWebCodecs: boolean;
  /** ImageDecoder API specifically (for HEIC/JPEG/PNG decode) */
  hasImageDecoder: boolean;
  /** VideoEncoder API (for encode) */
  hasVideoEncoder: boolean;
  /** OffscreenCanvas available */
  hasOffscreenCanvas: boolean;
  /** Web Worker available */
  hasWorker: boolean;
  /** createImageBitmap available */
  hasCreateImageBitmap: boolean;
  /** Canvas2D context available */
  hasCanvas2D: boolean;
  /** HEIC decode supported natively (ImageDecoder) */
  supportsHEIC: boolean;
  /** CPU cores (1..32, default 2) */
  hardwareConcurrency: number;
  /** Device RAM in GB (0 if unknown) */
  deviceMemory: number;
  /** User has data saver enabled */
  saveData: boolean;
  /** Network effective type (4g, 3g, 2g, slow-2g) */
  effectiveType: string;
  /** Safari browser (has WebCodecs quirks) */
  isSafari: boolean;
  /** iOS device */
  isIOS: boolean;
  /** Derived device tier */
  tier: DeviceTier;
}

/**
 * Worker API exposed via Comlink.
 * Runs in Web Worker context — must be self-contained (no DOM).
 */
export interface ImageWorkerApi {
  /**
   * Compress an image File/Blob.
   * @param file Source image
   * @param options Compression options
   * @returns Compressed Blob + dimensions
   */
  compress(
    file: File | Blob,
    options: CompressionOptions,
  ): Promise<{ blob: Blob; width: number; height: number; mimeType: string }>;

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
  /** File is too large for the current device/browser */
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
  evt: { fileIndex: number; progress: CompressionProgress } | CompressionResult[],
): evt is CompressionResult[] {
  return Array.isArray(evt);
}
