/**
 * Tests for v1.0.2: `maxWidthOrHeight <= 0` means "no resize".
 *
 * Regression: setting maxWidthOrHeight: 0 used to compute targetW=0 →
 * new OffscreenCanvas(0,0) → transferToImageBitmap() threw
 * "ImageBitmap construction failed" → every path failed → server-fallback.
 *
 * Coverage:
 * - resizeOffscreen(0) returns the ORIGINAL dimensions (no resize)
 * - resizeOffscreen(negative) same
 * - resizeOffscreen(2048) on a small image: no resize
 * - resizeOffscreen(2048) on a large image: resized
 * - canvas-main path via compress(): maxWidthOrHeight 0 keeps original dims
 */
import { describe, it, expect } from 'vitest';
import { createCanvas, type Canvas } from '@napi-rs/canvas';
import { resizeOffscreen } from './worker-helpers';
import { ImageCompression } from './service';

/** Create a real JPEG blob decodable by createImageBitmap (napi-rs loadImage). */
function makeJpegBlob(width: number, height: number): Blob {
  const canvas: Canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#3366ff';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#ff8800';
  ctx.fillRect(0, 0, width / 4, height / 4);
  const buffer = canvas.toBuffer('image/jpeg', 0.9);
  return new Blob([new Uint8Array(buffer)], { type: 'image/jpeg' });
}

describe('v1.0.2 resizeOffscreen maxWidthOrHeight <= 0 (no-resize semantics)', () => {
  it('returns original dimensions when maxWidthOrHeight is 0', async () => {
    const blob = makeJpegBlob(800, 600);
    const out = await resizeOffscreen(blob, 0);
    expect(out.width).toBe(800);
    expect(out.height).toBe(600);
    out.bitmap.close();
  });

  it('returns original dimensions when maxWidthOrHeight is negative', async () => {
    const blob = makeJpegBlob(800, 600);
    const out = await resizeOffscreen(blob, -100);
    expect(out.width).toBe(800);
    expect(out.height).toBe(600);
    out.bitmap.close();
  });

  it('does not resize a small image even with a large max (no-op)', async () => {
    const blob = makeJpegBlob(100, 50);
    const out = await resizeOffscreen(blob, 2048);
    expect(out.width).toBe(100);
    expect(out.height).toBe(50);
    out.bitmap.close();
  });

  it('resizes a large image normally when max is positive', async () => {
    const blob = makeJpegBlob(4000, 3000);
    const out = await resizeOffscreen(blob, 2048);
    expect(out.width).toBe(2048);
    expect(out.height).toBe(1536);
    out.bitmap.close();
  });
});

describe('v1.0.2 compress() with maxWidthOrHeight = 0 (canvas-main)', () => {
  it('keeps original dimensions instead of failing the cascade', async () => {
    const svc = new ImageCompression();
    try {
      const blob = makeJpegBlob(640, 480);
      const file = new File([blob], 'test.jpg', { type: 'image/jpeg' });
      // Force canvas-main so the service-side resize logic is exercised
      // without needing a Worker (happy-dom has no Worker).
      const result = await svc.compress(file, {
        maxWidthOrHeight: 0,
        forcePath: 'canvas-main',
      });
      // The v1.0.2 guard means 0 → no resize → original 640x480 output
      expect(result.width).toBe(640);
      expect(result.height).toBe(480);
      expect(result.path).toBe('canvas-main');
      expect(result.compressedSize).toBeGreaterThan(0);
    } finally {
      svc.dispose();
    }
  });

  it('does not throw "ImageBitmap construction failed" for maxWidthOrHeight 0', async () => {
    const svc = new ImageCompression();
    try {
      const blob = makeJpegBlob(640, 480);
      const file = new File([blob], 'test.jpg', { type: 'image/jpeg' });
      const result = await svc.compress(file, {
        maxWidthOrHeight: 0,
        forcePath: 'canvas-main',
      });
      expect(result.width).toBeGreaterThan(0);
      expect(result.height).toBeGreaterThan(0);
    } finally {
      svc.dispose();
    }
  });
});
