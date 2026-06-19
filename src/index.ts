/**
 * @GKz/image-compression
 *
 * Framework-agnostic image compression for the browser. Pure web APIs only.
 * Works with any framework (Angular, React, Vue, Svelte) or vanilla JS.
 *
 * @example
 * ```ts
 * import { ImageCompression } from '@GKz/image-compression';
 *
 * const svc = new ImageCompression();
 * const result = await svc.compress(file, { quality: 0.85 });
 * // result.file, result.path, result.tier, etc.
 *
 * // Or streaming
 * for await (const evt of compress$(file, options, svc)) {
 *   // progress events + final result
 * }
 * ```
 */

// ============================================================================
// Public API
// ============================================================================

// Main service class (Promise-based)
export { ImageCompression } from './service';
export { tryDecodeHEICLazy, resolveWorker } from './service';

// Streaming functions (AsyncIterable-based)
export { compress$, compressAll$ } from './stream';
export type { CompressStreamEvent, CompressAllStreamEvent, BatchProgress } from './stream';

// Types
export type {
  CompressionPath,
  OutputFormat,
  DeviceTier,
  CompressionStage,
  CompressionProgress,
  CompressionOptions,
  CompressionResult,
  DeviceCapabilities,
  ImageWorkerApi,
  CompressionErrorCode,
} from './types';

// Error class
export { CompressionError } from './types';

// Type guards
export { isCompressionResult, isBatchResult } from './types';

// Utility functions
export { detectCapabilities, calculateTier } from './capabilities';
export { readExifOrientation } from './exif';
export { extensionForMimeType } from './types';
export {
  applyExifOrientation,
  applyRotation,
  resizeExact,
  applyTransforms,
} from './worker-helpers';
