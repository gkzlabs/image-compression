import * as Comlink from 'comlink';
import type {
  CompressionOptions,
  CompressionPath,
  CompressionStage,
  ImageWorkerApi,
} from './types';
import {
  applyExifOrientation,
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
      onProgress,
    } = options;

    const emit = (stage: CompressionStage, percent: number) => {
      onProgress?.({
        stage,
        percent,
        path: 'webcodecs-worker' satisfies CompressionPath,
      });
    };

    let bitmap: ImageBitmap;
    let width: number;
    let height: number;

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
        width = heicBitmap.width;
        height = heicBitmap.height;
        emit('resizing', 50);
      } else {
        throw new Error(
          'HEIC not supported in this browser. Please convert to JPEG first.',
        );
      }
    } else {
      emit('decoding', 20);
      const decoded = await resizeOffscreen(file, maxWidthOrHeight);
      bitmap = decoded.bitmap;
      width = decoded.width;
      height = decoded.height;

      // EXIF auto-rotation: read orientation tag (no-op for non-JPEG or
      // orientation 1) and apply the rotation so the output is correctly
      // oriented even though Canvas re-encoding strips EXIF metadata.
      // This is critical for photos taken on phones in portrait mode
      // (orientation 6 = 90° CW is the most common case).
      const orientation = await readExifOrientation(file);
      if (orientation !== 1) {
        const rotated = applyExifOrientation(bitmap, orientation);
        bitmap.close();
        bitmap = rotated.bitmap;
        width = rotated.width;
        height = rotated.height;
        emit('resizing', 60); // bumped to show rotation step
      }
    }

    // Encode
    const blob = await encodeViaOffscreenCanvas(bitmap, format, quality);
    bitmap.close();
    emit('encoding', 95);

    return { blob, width, height, mimeType: format };
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
