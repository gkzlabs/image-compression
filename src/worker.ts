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
};

Comlink.expose(api);
