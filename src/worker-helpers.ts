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

  // Convert canvas back to ImageBitmap for next steps
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

  const transformed = canvas.transferToImageBitmap();
  return { bitmap: transformed, width: w, height: h };
}

/**
 * Encode a bitmap to a Blob using OffscreenCanvas.convertToBlob.
 * Hardware-accelerated in modern browsers.
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
  const swapDims = rotate === 90 || rotate === 270;
  const w = swapDims ? bitmap.height : bitmap.width;
  const h = swapDims ? bitmap.width : bitmap.height;

  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('OffscreenCanvas 2D context unavailable for rotation');
  }

  // Move origin to center, apply transforms, draw bitmap
  ctx.translate(w / 2, h / 2);
  if (rotate !== 0) {
    ctx.rotate((rotate * Math.PI) / 180);
  }
  if (mirror === 'horizontal') {
    ctx.scale(-1, 1);
  } else if (mirror === 'vertical') {
    ctx.scale(1, -1);
  }
  ctx.translate(-bitmap.width / 2, -bitmap.height / 2);
  ctx.drawImage(bitmap, 0, 0);

  return {
    bitmap: canvas.transferToImageBitmap(),
    width: w,
    height: h,
  };
}

/**
 * Resize an image to exact target dimensions.
 *
 * Three behaviors depending on options:
 * - Only `width` set:  height auto-computed (preserves aspect ratio)
 * - Only `height` set: width auto-computed (preserves aspect ratio)
 * - Both set + `keepAspectRatio: true`: fit-within-box (letterbox if needed)
 * - Both set + `keepAspectRatio: false` (default): stretch to exact size
 *
 * @param bitmap  Source image
 * @param width   Target width in pixels
 * @param height  Target height in pixels (optional)
 * @param keepAspectRatio  If both width+height set, fit-within instead of stretching
 * @returns New bitmap with target dimensions
 */
export function resizeExact(
  bitmap: ImageBitmap,
  width?: number,
  height?: number,
  keepAspectRatio: boolean = false,
): { bitmap: ImageBitmap; width: number; height: number } {
  let targetW: number;
  let targetH: number;
  const srcW = bitmap.width;
  const srcH = bitmap.height;
  const ratio = srcW / srcH;

  // Case 1: both undefined → no resize
  if (width === undefined && height === undefined) {
    return { bitmap, width: srcW, height: srcH };
  }

  // Case 2: only width given → scale height proportionally
  if (width !== undefined && height === undefined) {
    targetW = width;
    targetH = Math.round(width / ratio);
  }
  // Case 3: only height given → scale width proportionally
  else if (width === undefined && height !== undefined) {
    targetH = height;
    targetW = Math.round(height * ratio);
  }
  // Case 4: both given — stretch or fit-within
  else if (width === srcW && height === srcH) {
    // No-op: same dimensions
    return { bitmap, width, height };
  } else if (keepAspectRatio) {
    // Both given + keepAspectRatio: fit-within-box
    if (width! / height! > ratio) {
      // Box is wider than image — fit by height
      targetH = height!;
      targetW = Math.round(height! * ratio);
    } else {
      // Box is taller than image — fit by width
      targetW = width!;
      targetH = Math.round(width! / ratio);
    }
  } else {
    // Both given, no aspect ratio: stretch to exact
    targetW = width!;
    targetH = height!;
  }

  const canvas = new OffscreenCanvas(targetW, targetH);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('OffscreenCanvas 2D context unavailable for resize');
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, targetW, targetH);

  return {
    bitmap: canvas.transferToImageBitmap(),
    width: targetW,
    height: targetH,
  };
}

// ---------------------------------------------------------------------------
// EXIF types and re-export for convenience
// ---------------------------------------------------------------------------

export type { ExifOrientation } from './exif';
export { readExifOrientation } from './exif';