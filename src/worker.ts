import * as Comlink from 'comlink';
import type {
  CompressionOptions,
  CompressionPath,
  CompressionStage,
  ImageWorkerApi,
} from './types';
import {
  applyExifOrientation,
  applyTransforms,
  encodeViaOffscreenCanvas,
  readExifOrientation,
  resizeOffscreen,
  tryDecodeHEIC,
} from './worker-helpers';

/**
 * Image compression Web Worker.
 *
 * Runs in Worker context (no DOM). Exposed via Comlink so the main thread
 * can call methods like normal async functions.
 *
 * Pure helper logic lives in `image-compression.worker-helpers.ts` so it
 * can be unit-tested without Worker context.
 *
 * Implements the worker-side logic for 2 paths:
 * - WebCodecs path (high tier)
 * - OffscreenCanvas + Canvas2D path (mid tier)
 *
 * Main-thread paths (canvas-main, server-fallback) are handled in the service.
 */

const api: ImageWorkerApi = {
  async compress(file, options) {
    const {
      maxWidthOrHeight = 2048,
      quality = 0.85,
      format = 'image/jpeg',
      width,
      height,
      keepAspectRatio,
      rotate,
      mirror,
      onProgress,
    } = options;

    const emit = (stage: CompressionStage, percent: number) => {
      onProgress?.({
        stage,
        percent,
        // Use the path passed via the workerOptions (via Comlink) if available,
        // otherwise default to 'webcodecs-worker' for backward compatibility.
        // The service sets this to the actual path being tried (e.g. 'offscreen-worker').
        path: ((options as { __path?: CompressionPath }).__path ?? 'webcodecs-worker') satisfies CompressionPath,
      });
    };

    let bitmap: ImageBitmap;

    // For HEIC, try native decode first
    const isHEIC =
      (file instanceof File && /\.(heic|heif)$/i.test(file.name)) ||
      file.type === 'image/heic' ||
      file.type === 'image/heif';

    if (isHEIC) {
      emit('decoding', 20);
      const heicBitmap = await tryDecodeHEIC(file);
      if (heicBitmap) {
        bitmap = heicBitmap;
        emit('resizing', 50);
      } else {
        throw new Error(
          'HEIC not supported in this browser. Please convert to JPEG first.',
        );
      }
    } else {
      emit('decoding', 20);
      // Step 1: decode + max-width resize (1 OffscreenCanvas draw)
      const decoded = await resizeOffscreen(file, maxWidthOrHeight);
      bitmap = decoded.bitmap;

      // Step 2: EXIF auto-rotation (1 draw, only if no manual rotate override)
      // If `rotate` is explicitly set (including 0), it overrides EXIF auto-rotation.
      if (rotate === undefined) {
        const orientation = await readExifOrientation(file);
        if (orientation !== 1) {
          // v0.10.2: applyExifOrientation is sync again (uses transferToImageBitmap)
          const rotated = applyExifOrientation(bitmap, orientation);
          bitmap.close();
          bitmap = rotated.bitmap;
          emit('resizing', 55);
        }
      } else {
        emit('resizing', 55);
      }
    }

    // Step 3: combined manual rotate + mirror + exact resize in a SINGLE draw
    // (v0.3.0 optimization: replaces 3 separate bitmap operations with 1)
    // v0.10.2: applyTransforms is sync again (uses transferToImageBitmap)
    const transformed = applyTransforms(bitmap, {
      rotate,
      mirror,
      width,
      height,
      keepAspectRatio,
    });
    bitmap.close();
    const outWidth = transformed.width;
    const outHeight = transformed.height;
    bitmap = transformed.bitmap;

    // Step 4: encode (1 final operation)
    // v0.10.2: encodeViaOffscreenCanvas reverted to v0.5.7 pattern (sync
    // drawImage + await convertToBlob). The v0.10.1 try/finally is no longer
    // needed because transferToImageBitmap() in the helpers above already
    // detaches the source bitmap synchronously, eliminating the race.
    const blob = await encodeViaOffscreenCanvas(bitmap, format, quality);
    bitmap.close();
    emit('encoding', 95);

    return { blob, width: outWidth, height: outHeight, mimeType: format };
  },

  async supportsHEIC() {
    if (typeof ImageDecoder === 'undefined') return false;
    try {
      return await ImageDecoder.isTypeSupported('image/heic');
    } catch {
      return false;
    }
  },

  async getWorkerCapabilities() {
    let hasOffscreenCanvas = false;
    try {
      const c = new OffscreenCanvas(1, 1);
      hasOffscreenCanvas = c.getContext('2d') !== null;
    } catch {
      hasOffscreenCanvas = false;
    }

    const hasWebCodecs =
      typeof VideoEncoder !== 'undefined' &&
      typeof ImageDecoder !== 'undefined';

    let hasCreateImageBitmap = false;
    try {
      hasCreateImageBitmap = typeof createImageBitmap === 'function';
    } catch {
      hasCreateImageBitmap = false;
    }

    return { hasOffscreenCanvas, hasWebCodecs, hasCreateImageBitmap };
  },

  /**
   * End-to-end roundtrip probe: decode a well-formed 1x1 PNG, draw it to an
   * OffscreenCanvas, then encode the result. Catches environment-specific
   * bugs that simple feature detection misses — most notably Chrome's
   * "InvalidStateError: image source is detached" bug with Worker-context
   * bitmaps in module workers, and Firefox's broken transferToImageBitmap.
   *
   * The 1x1 PNG bytes are identical to the test blob in `capabilities.ts`,
   * so the probe is well-formed and self-contained (no network).
   *
   * @returns true if the full decode → drawImage → convertToBlob roundtrip
   * succeeds; false if any step throws (caller treats false as
   * "Worker paths broken in this environment" and skips them in the cascade).
   */
  async probeWorkerPath(): Promise<boolean> {
    // Same 1x1 transparent PNG used in capabilities.ts.
    const tinyPng = new Blob(
      [
        new Uint8Array([
          0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00,
          0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00,
          0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89,
          0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63,
          0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4,
          0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60,
          0x82,
        ]),
      ],
      { type: 'image/png' },
    );
    let bitmap: ImageBitmap | null = null;
    try {
      // Step 1: decode
      bitmap = await createImageBitmap(tinyPng);
      // Step 2: draw to OffscreenCanvas
      const canvas = new OffscreenCanvas(1, 1);
      const ctx = canvas.getContext('2d');
      if (!ctx) return false;
      ctx.drawImage(bitmap, 0, 0);
      // Step 3: encode
      const blob = await canvas.convertToBlob({ type: 'image/png' });
      return blob.size > 0;
    } catch {
      return false;
    } finally {
      bitmap?.close();
    }
  },
};

Comlink.expose(api);
