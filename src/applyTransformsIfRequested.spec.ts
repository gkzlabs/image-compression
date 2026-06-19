/**
 * Tests for v0.10.9 Compress-then-Transform pipeline.
 *
 * The `applyTransformsIfRequested` helper is exposed as a static method on
 * `ImageCompression` (was `private` in v0.10.8) so it can be unit-tested
 * directly without going through the full `compress()` cascade. This avoids
 * the happy-dom canvas limitation (where `document.createElement('canvas')`
 * returns a stub with no 2d context).
 *
 * Coverage:
 * - No-op conditions (no transform options, passthrough, server-fallback, 0x0)
 * - Real transforms applied (rotate 90/180/270, mirror, exact width/height)
 * - Graceful degradation on decode failure
 * - Result shape integrity (dimensions, mimeType, filename)
 */
import { describe, it, expect } from 'vitest';
import { createCanvas, type Canvas } from '@napi-rs/canvas';
import { ImageCompression } from './service';
import type { CompressionResult, CompressionPath } from './types';

/**
 * Create a real JPEG blob from a colored canvas. Decodable by createImageBitmap
 * in our test environment.
 */
function makeJpegBlob(width: number, height: number): Blob {
  const canvas: Canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  // Add a non-white marker to make rotated images visually distinct
  ctx.fillStyle = '#ff0000';
  ctx.fillRect(0, 0, width / 4, height / 4);
  const buffer = canvas.toBuffer('image/jpeg', 0.9);
  return new Blob([new Uint8Array(buffer)], { type: 'image/jpeg' });
}

/**
 * Build a fake CompressionResult as if it came from the cascade.
 */
function makeResult(
  blob: Blob,
  width: number,
  height: number,
  path: CompressionPath = 'canvas-main',
): CompressionResult {
  return {
    blob,
    file: blob instanceof File ? blob : new File([blob], 'result.jpg', { type: blob.type }),
    name: 'result.jpg',
    originalSize: blob.size * 2,
    compressedSize: blob.size,
    width,
    height,
    mimeType: 'image/jpeg',
    path,
    durationMs: 100,
    tier: 'mid',
  };
}

describe('v0.10.9 Compress-then-Transform (static helper)', () => {
  describe('no-op conditions', () => {
    it('returns input unchanged when no transform options set', async () => {
      const blob = makeJpegBlob(100, 50);
      const result = makeResult(blob, 100, 50);
      const out = await ImageCompression.applyTransformsIfRequested(result, {});
      expect(out).toBe(result); // exact same reference — no-op
    });

    it('returns passthrough path unchanged even with transform options', async () => {
      const blob = makeJpegBlob(100, 50);
      const result = makeResult(blob, 100, 50, 'passthrough');
      const out = await ImageCompression.applyTransformsIfRequested(result, { rotate: 90 });
      expect(out).toBe(result);
    });

    it('returns server-fallback unchanged even with transform options', async () => {
      const blob = makeJpegBlob(100, 50);
      const result = makeResult(blob, 100, 50, 'server-fallback');
      const out = await ImageCompression.applyTransformsIfRequested(result, { rotate: 90 });
      expect(out).toBe(result);
    });

    it('returns 0x0 placeholder result unchanged', async () => {
      const blob = makeJpegBlob(100, 50);
      const result = makeResult(blob, 0, 0);
      const out = await ImageCompression.applyTransformsIfRequested(result, { rotate: 90 });
      expect(out).toBe(result);
    });

    it('returns input unchanged when only quality/format set (not transforms)', async () => {
      const blob = makeJpegBlob(100, 50);
      const result = makeResult(blob, 100, 50);
      const out = await ImageCompression.applyTransformsIfRequested(result, {
        quality: 0.5,
        format: 'image/webp',
      });
      expect(out).toBe(result);
    });
  });

  describe('rotations applied correctly', () => {
    it('rotate=90 swaps width/height (200x100 → 100x200)', async () => {
      const blob = makeJpegBlob(200, 100);
      const result = makeResult(blob, 200, 100);
      const out = await ImageCompression.applyTransformsIfRequested(result, { rotate: 90 });
      console.log('rotate=90 result:', { width: out.width, height: out.height, size: out.blob.size });
      expect(out.width).toBe(100);
      expect(out.height).toBe(200);
      expect(out.blob.size).toBeGreaterThan(0);
      expect(out.mimeType).toBe('image/jpeg');
    });

    it('rotate=180 keeps dimensions but flips pixels', async () => {
      const blob = makeJpegBlob(150, 80);
      const result = makeResult(blob, 150, 80);
      const out = await ImageCompression.applyTransformsIfRequested(result, { rotate: 180 });
      expect(out.width).toBe(150);
      expect(out.height).toBe(80);
    });

    it('rotate=270 swaps width/height (200x100 → 100x200)', async () => {
      const blob = makeJpegBlob(200, 100);
      const result = makeResult(blob, 200, 100);
      const out = await ImageCompression.applyTransformsIfRequested(result, { rotate: 270 });
      expect(out.width).toBe(100);
      expect(out.height).toBe(200);
    });
  });

  describe('mirror and combined transforms', () => {
    it('mirror=horizontal does not change dimensions', async () => {
      const blob = makeJpegBlob(120, 80);
      const result = makeResult(blob, 120, 80);
      const out = await ImageCompression.applyTransformsIfRequested(result, { mirror: 'horizontal' });
      expect(out.width).toBe(120);
      expect(out.height).toBe(80);
    });

    it('mirror=vertical does not change dimensions', async () => {
      const blob = makeJpegBlob(120, 80);
      const result = makeResult(blob, 120, 80);
      const out = await ImageCompression.applyTransformsIfRequested(result, { mirror: 'vertical' });
      expect(out.width).toBe(120);
      expect(out.height).toBe(80);
    });

    it('rotate=90 + mirror=horizontal composes correctly (200x100 → 100x200)', async () => {
      const blob = makeJpegBlob(200, 100);
      const result = makeResult(blob, 200, 100);
      const out = await ImageCompression.applyTransformsIfRequested(result, {
        rotate: 90,
        mirror: 'horizontal',
      });
      // Dimensions swap (rotate 90), mirror doesn't change dims
      expect(out.width).toBe(100);
      expect(out.height).toBe(200);
    });
  });

  describe('exact resize', () => {
    it('exact width + height + keepAspectRatio=false resizes correctly', async () => {
      const blob = makeJpegBlob(200, 100);
      const result = makeResult(blob, 200, 100);
      const out = await ImageCompression.applyTransformsIfRequested(result, {
        width: 80,
        height: 40,
        keepAspectRatio: false,
      });
      expect(out.width).toBe(80);
      expect(out.height).toBe(40);
    });

    it('rotate=90 + exact width=100 + height=200 produces exact output dims', async () => {
      const blob = makeJpegBlob(200, 100);
      const result = makeResult(blob, 200, 100);
      // Source is 200x100. Rotate 90° → 100x200. Then exact width=100, height=200.
      const out = await ImageCompression.applyTransformsIfRequested(result, {
        rotate: 90,
        width: 100,
        height: 200,
        keepAspectRatio: false,
      });
      expect(out.width).toBe(100);
      expect(out.height).toBe(200);
    });
  });

  describe('result shape integrity', () => {
    it('preserves mimeType from input result', async () => {
      const blob = makeJpegBlob(100, 50);
      const result = makeResult(blob, 100, 50);
      const out = await ImageCompression.applyTransformsIfRequested(result, { rotate: 90 });
      expect(out.mimeType).toBe('image/jpeg');
    });

    it('preserves path from input result (worker path stays labeled worker)', async () => {
      const blob = makeJpegBlob(100, 50);
      const result = makeResult(blob, 100, 50, 'webcodecs-worker');
      const out = await ImageCompression.applyTransformsIfRequested(result, { rotate: 90 });
      expect(out.path).toBe('webcodecs-worker');
    });

    it('preserves tier and durationMs from input result', async () => {
      const blob = makeJpegBlob(100, 50);
      const result = makeResult(blob, 100, 50);
      result.tier = 'low';
      result.durationMs = 42;
      const out = await ImageCompression.applyTransformsIfRequested(result, { rotate: 90 });
      expect(out.tier).toBe('low');
      expect(out.durationMs).toBe(42);
    });

    it('produces a different blob when transforms applied', async () => {
      const blob = makeJpegBlob(120, 80);
      const result = makeResult(blob, 120, 80);
      const out = await ImageCompression.applyTransformsIfRequested(result, { rotate: 180 });
      // Pixels flipped, even if dims unchanged → blob should differ
      expect(out.blob).not.toBe(blob);
    });
  });

  describe('graceful degradation', () => {
    it('returns original result when input blob cannot be decoded', async () => {
      // Garbage bytes — not a real image
      const garbage = new Blob([new Uint8Array([0x00, 0x01, 0x02, 0x03])], { type: 'image/jpeg' });
      const result = makeResult(garbage, 100, 50);
      const out = await ImageCompression.applyTransformsIfRequested(result, { rotate: 90 });
      // Should fall back to the original result (not throw)
      expect(out).toBe(result);
    });
  });
});
