/**
 * Pure helper functions used by the compression Web Worker.
 *
 * Extracted from image-compression.worker.ts so they can be unit-tested
 * without spinning up a Worker context. The Worker imports these and
 * wraps them in the Comlink-exposed api object.
 *
 * No side effects on import — safe to use in any context.
 */

import type { ExifOrientation } from './exif';

/**
 * Resize a File/Blob to fit within maxWidthOrHeight, preserving aspect ratio.
 * Uses OffscreenCanvas with high-quality smoothing.
 *
 * v0.10.2: Reverted from native `createImageBitmap(file, {resizeWidth})` to
 * OffscreenCanvas + `transferToImageBitmap()`. The async clone-based approach
 * (v0.10.0/v0.10.1) left the source bitmap alive past the GPU readback in
 * `convertToBlob`, triggering Chrome 149's "image source is detached" error.
 * `transferToImageBitmap()` is **synchronous** and **detaches the source
 * immediately**, eliminating the race condition.
 *
 * @param file Source image
 * @param maxWidthOrHeight Longest edge in pixels
 * @returns Resized bitmap + actual dimensions
 */
export async function resizeOffscreen(
  file: File | Blob,
  maxWidthOrHeight: number,
): Promise<{ bitmap: ImageBitmap; width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  const { width: srcW, height: srcH } = bitmap;

  // No resize needed if already small
  if (srcW <= maxWidthOrHeight && srcH <= maxWidthOrHeight) {
    return { bitmap, width: srcW, height: srcH };
  }

  const ratio = srcW / srcH;
  let targetW: number;
  let targetH: number;
  if (srcW >= srcH) {
    targetW = Math.min(maxWidthOrHeight, srcW);
    targetH = Math.round(targetW / ratio);
  } else {
    targetH = Math.min(maxWidthOrHeight, srcH);
    targetW = Math.round(targetH * ratio);
  }

  const canvas = new OffscreenCanvas(targetW, targetH);
  const ctx = canvas.getContext('2d', { willReadFrequently: false });
  if (!ctx) {
    throw new Error('OffscreenCanvas 2d context unavailable');
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, targetW, targetH);

  // Release the original bitmap (no longer needed)
  bitmap.close();

  // Convert canvas back to ImageBitmap for next steps.
  // transferToImageBitmap() is sync and detaches the canvas backing
  // — the new bitmap is independent of the canvas.
  const resized = canvas.transferToImageBitmap();
  return { bitmap: resized, width: targetW, height: targetH };
}

/**
 * Apply EXIF orientation transform to a bitmap. Creates a NEW bitmap with
 * the rotated/flipped pixels and the correct width/height.
 *
 * EXIF orientation values (per spec):
 *   1 = Horizontal (normal)              — no transform
 *   2 = Mirror horizontal                 — flip X
 *   3 = Rotate 180°                       — rotate 180
 *   4 = Mirror vertical                   — flip Y
 *   5 = Mirror horizontal + rotate 270° CW — transpose
 *   6 = Rotate 90° CW                     — rotate 90 CW (most common on phones)
 *   7 = Mirror horizontal + rotate 90° CW — transverse
 *   8 = Rotate 270° CW (90° CCW)          — rotate 90 CCW
 *
 * Returns the original bitmap unchanged for orientation 1 (common case).
 *
 * v0.10.2: Reverted to **synchronous** function with `transferToImageBitmap()`.
 * The async version (v0.10.0+) used `await createImageBitmap(canvas)` which
 * kept the source bitmap alive past Chrome 149's GPU readback, triggering
 * "image source is detached" errors in the subsequent `convertToBlob` step.
 *
 * Why we need this: when re-encoding via Canvas, the EXIF metadata is
 * stripped — including the orientation tag. The output image would appear
 * sideways without this transform. We rotate the actual pixels so the
 * output is correctly oriented without needing EXIF.
 */
export function applyExifOrientation(
  bitmap: ImageBitmap,
  orientation: ExifOrientation,
): { bitmap: ImageBitmap; width: number; height: number } {
  // Fast path: no rotation needed
  if (orientation === 1 || orientation < 1 || orientation > 8) {
    return { bitmap, width: bitmap.width, height: bitmap.height };
  }

  // For orientations 5-8, width and height are swapped
  const swap = orientation >= 5;
  const w = swap ? bitmap.height : bitmap.width;
  const h = swap ? bitmap.width : bitmap.height;

  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('OffscreenCanvas 2d context unavailable for orientation');
  }

  // Fill background black (handles areas not covered by rotated bitmap)
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);

  // Move origin to center of the new canvas for easier rotation math.
  // This makes the draw at the end simply offset by -half dimensions.
  ctx.translate(w / 2, h / 2);

  // Apply rotation/flip per EXIF spec.
  // Canvas Y axis points down, so positive angle is clockwise visually.
  switch (orientation) {
    case 2: // Mirror horizontal (flip X)
      ctx.scale(-1, 1);
      break;
    case 3: // Rotate 180°
      ctx.rotate(Math.PI);
      break;
    case 4: // Mirror vertical (flip Y)
      ctx.scale(1, -1);
      break;
    case 5: // Transpose: rotate 270° CW + flip H
      ctx.rotate(-Math.PI / 2);
      ctx.scale(1, -1);
      break;
    case 6: // Rotate 90° CW
      ctx.rotate(Math.PI / 2);
      break;
    case 7: // Transverse: rotate 90° CW + flip H
      ctx.rotate(Math.PI / 2);
      ctx.scale(-1, 1);
      break;
    case 8: // Rotate 270° CW (= 90° CCW)
      ctx.rotate(-Math.PI / 2);
      break;
  }

  // Draw the bitmap centered on the transformed origin
  ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);

  // transferToImageBitmap() is sync and detaches the canvas backing.
  // The new bitmap is independent of the source, eliminating the
  // Chrome 149 "image source is detached" race.
  const transformed = canvas.transferToImageBitmap();
  return { bitmap: transformed, width: w, height: h };
}

/**
 * Encode a bitmap to a Blob using OffscreenCanvas.convertToBlob.
 * Hardware-accelerated in modern browsers.
 *
 * v0.10.3: Re-added `try/finally` as a **safety net** for guaranteed bitmap
 * cleanup. The race-condition root cause was fixed in v0.10.2 by reverting
 * the upstream helpers to sync + `transferToImageBitmap()` (which detaches
 * the source bitmap synchronously, so it's already gone by the next await).
 * The `try/finally` here is **defensive, not a race-condition workaround**:
 *   - Closes the source bitmap even if `convertToBlob` throws (GPU OOM,
 *     context loss, etc.) — prevents resource leak in the Worker.
 *   - Safe to call even on an already-closed bitmap (no-op in spec).
 *   - Sync code in a Worker is fine — it doesn't block the main thread.
 *
 * This is the only viable encoding path for JPEG/WebP/PNG/AVIF (browser-dependent):
 * - WebCodecs VideoEncoder is for *video* codecs (VP8/VP9/AV1), not still images.
 * - For HEIC encode, browsers don't support it natively — would need WASM (heic2any).
 * - Canvas convertToBlob uses the browser's built-in encoder (libjpeg/libwebp/HW),
 *   which is hardware-accelerated and the most efficient option for stills.
 *
 * @param bitmap Source bitmap
 * @param format MIME type ('image/jpeg', 'image/webp', 'image/png')
 * @param quality 0..1 (used for JPEG/WebP)
 */
export async function encodeViaOffscreenCanvas(
  bitmap: ImageBitmap,
  format: string,
  quality: number,
): Promise<Blob> {
  const { width, height } = bitmap;
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('OffscreenCanvas 2d context unavailable for encode');
  }
  // Sync drawImage is safe — source bitmap is still alive at this point.
  // v0.10.2 already detached it via transferToImageBitmap() in upstream
  // helpers (resizeOffscreen/applyExifOrientation/applyTransforms). The
  // returned bitmap from those is a fresh, detached bitmap — convertToBlob
  // reads pixels immediately and the bitmap is safe to release AFTER the
  // await resolves, not during it.
  //
  // v0.10.5: REMOVED the try/finally that called bitmap.close() — that
  // "safety net" was THE BUG. finally blocks run when the try block is left,
  // INCLUDING during await suspension. Closing the bitmap before
  // convertToBlob completes its GPU readback is exactly what triggers
  // Chrome 149's "image source is detached" error. The caller in worker.ts
  // closes the bitmap after the encode returns (see worker.ts compress()).
  ctx.drawImage(bitmap, 0, 0);
  return await canvas.convertToBlob({ type: format, quality });
}

/**
 * Try to decode HEIC via ImageDecoder.
 * Returns null if browser doesn't support it.
 *
 * iOS Safari has native ImageDecoder support for HEIC. Other browsers
 * (Chrome/Edge/Firefox) return null — caller should fall back to
 * server-side decoding or use a WASM-based decoder (heic2any).
 */
/**
 * Try to decode a HEIC file using the native ImageDecoder (WebCodecs API).
 *
 * **Defense-in-depth** — the service also has `tryDecodeHEICLazy()` which
 * runs FIRST in the cascade and tries heic2any (WASM) as a fallback. This
 * worker-side decoder runs only when:
 *   1. The file is HEIC
 *   2. The service's main-thread decode failed (returned null)
 *   3. The user did NOT set `forcePath` (so the cascade proceeds)
 *   4. A worker path is being attempted
 *
 * In modern Chrome (149+), both paths succeed. In Safari, the main-thread
 * path succeeds. In older browsers, the cascade falls through to server-fallback.
 *
 * If you reach here, the main-thread decode already failed — this is the last
 * chance to decode HEIC client-side before the cascade gives up.
 */
export async function tryDecodeHEIC(file: File | Blob): Promise<ImageBitmap | null> {
  if (typeof ImageDecoder === 'undefined') return null;
  try {
    const supported = await ImageDecoder.isTypeSupported('image/heic');
    if (!supported) return null;
    const buffer = await file.arrayBuffer();
    const decoder = new ImageDecoder({ data: buffer, type: 'image/heic' });
    const { image } = await decoder.decode();
    decoder.close();
    const bitmap = await createImageBitmap(image);
    return bitmap;
  } catch {
    return null;
  }
}

/**
 * Apply manual rotation and/or mirroring to an image bitmap.
 *
 * Used when the caller wants to override EXIF auto-rotation or apply
 * additional transforms (e.g., rotate a vertical photo 90° for landscape).
 *
 * NOTE (v0.10.8): Restored from v0.10.6 — safe because v0.10.7's worker.ts
 * no longer calls applyTransforms (detach root cause was worker URL loading
 * context, fixed via `new URL(path, document.baseURI).href` in main.ts).
 * These functions are now used by service.ts **main-thread path only**,
 * which never hits the Chrome module-worker bitmap detach race.
 *
 * @param bitmap  Source image
 * @param rotate  Rotation in degrees clockwise (0 | 90 | 180 | 270)
 * @param mirror  Optional mirror ('horizontal' or 'vertical') applied AFTER rotation
 * @returns New bitmap with transforms applied
 */
export function applyRotation(
  bitmap: ImageBitmap,
  rotate: 0 | 90 | 180 | 270 = 0,
  mirror?: 'horizontal' | 'vertical',
): { bitmap: ImageBitmap; width: number; height: number } {
  // Fast path: no rotation, no mirror → return as-is
  if (rotate === 0 && !mirror) {
    return { bitmap, width: bitmap.width, height: bitmap.height };
  }

  // 90° and 270° rotations swap dimensions
  const swap = rotate === 90 || rotate === 270;
  const dstW = swap ? bitmap.height : bitmap.width;
  const dstH = swap ? bitmap.width : bitmap.height;

  const canvas = new OffscreenCanvas(dstW, dstH);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('OffscreenCanvas 2D context unavailable for rotation');

  ctx.translate(dstW / 2, dstH / 2);
  if (rotate !== 0) ctx.rotate((rotate * Math.PI) / 180);
  if (mirror === 'horizontal') ctx.scale(-1, 1);
  else if (mirror === 'vertical') ctx.scale(1, -1);
  ctx.translate(-bitmap.width / 2, -bitmap.height / 2);
  ctx.drawImage(bitmap, 0, 0);

  return {
    bitmap: canvas.transferToImageBitmap(),
    width: dstW,
    height: dstH,
  };
}

/**
 * Resize an image bitmap to exact target dimensions (no aspect-ratio lock).
 *
 * Used by applyTransforms when the caller explicitly requests a non-preserving
 * resize (i.e., width AND height both specified independently).
 *
 * @param bitmap  Source image
 * @param width   Target width in pixels
 * @param height  Target height in pixels
 * @returns New bitmap resized to exact dimensions
 */
export function resizeExact(
  bitmap: ImageBitmap,
  width: number,
  height: number,
): { bitmap: ImageBitmap; width: number; height: number } {
  if (width === bitmap.width && height === bitmap.height) {
    return { bitmap, width, height };
  }

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('OffscreenCanvas 2D context unavailable for resize');

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, width, height);

  return {
    bitmap: canvas.transferToImageBitmap(),
    width,
    height,
  };
}

/**
 * Apply arbitrary transform pipeline: rotation + mirror + resize.
 *
 * Composes `applyRotation` and `resizeExact` into one optimized step that
 * avoids intermediate OffscreenCanvas allocations when possible. Used by the
 * main-thread `service.ts` path to handle user-specified `fileType`,
 * `rotate`, `mirror`, and exact `width`/`height` options.
 *
 * NOTE (v0.10.8): Restored from v0.10.6. Worker path no longer calls this
 * function (worker.ts reverts to v0.5.7 structure). Only main-thread code
 * invokes applyTransforms.
 *
 * @param bitmap  Source image
 * @param opts    Transform options (rotate, mirror, exact width/height)
 * @returns New bitmap with all transforms applied in single draw
 */
export function applyTransforms(
  bitmap: ImageBitmap,
  opts: {
    rotate?: 0 | 90 | 180 | 270;
    mirror?: 'horizontal' | 'vertical';
    width?: number;
    height?: number;
  } = {},
): { bitmap: ImageBitmap; width: number; height: number } {
  const rotate = opts.rotate ?? 0;
  const mirror = opts.mirror;
  const exactW = opts.width;
  const exactH = opts.height;

  const hasRotation = rotate !== 0 || !!mirror;
  const hasExactResize = exactW !== undefined && exactH !== undefined;
  const needsTransform = hasRotation || hasExactResize;

  // Fast path: nothing to do
  if (!needsTransform) {
    return { bitmap, width: bitmap.width, height: bitmap.height };
  }

  // 1. Compute target dimensions
  //    Rotation swaps dims; then user may override with exact width/height.
  const swap = rotate === 90 || rotate === 270;
  const srcW = bitmap.width;
  const srcH = bitmap.height;
  const afterRotateW = swap ? srcH : srcW;
  const afterRotateH = swap ? srcW : srcH;

  const finalW = hasExactResize ? exactW! : afterRotateW;
  const finalH = hasExactResize ? exactH! : afterRotateH;

  // 2. Create canvas with final dimensions
  const canvas = new OffscreenCanvas(finalW, finalH);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('OffscreenCanvas 2D context unavailable for transforms');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // 3. Apply all transforms in single draw
  ctx.translate(finalW / 2, finalH / 2);
  if (rotate !== 0) ctx.rotate((rotate * Math.PI) / 180);
  if (mirror === 'horizontal') ctx.scale(-1, 1);
  else if (mirror === 'vertical') ctx.scale(1, -1);
  ctx.translate(-srcW / 2, -srcH / 2);
  ctx.drawImage(bitmap, 0, 0);

  return {
    bitmap: canvas.transferToImageBitmap(),
    width: finalW,
    height: finalH,
  };
}

export type { ExifOrientation } from './exif';
export { readExifOrientation } from './exif';
