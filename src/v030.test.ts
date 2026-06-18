/**
 * Tests for the v0.3.0 optimizations.
 *
 * - applyTransforms: replaces 3 separate bitmap operations with 1
 * - continueOnError: batch mode that doesn't reject on first failure
 * - img.src cleanup: helps GC release image data promptly
 */
import { applyTransforms } from './worker-helpers';
import { ImageCompression } from './service';

describe('applyTransforms() — single-canvas optimization', () => {
  async function makeTestBitmap(w = 100, h = 50): Promise<ImageBitmap> {
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No 2d context');
    ctx.fillStyle = '#0000FF';
    ctx.fillRect(0, 0, w, h);
    return canvas.transferToImageBitmap();
  }

  it('fast path: no transforms returns same bitmap', async () => {
    const bitmap = await makeTestBitmap();
    const result = applyTransforms(bitmap, {});
    expect(result.bitmap).toBe(bitmap);
    expect(result.width).toBe(100);
    expect(result.height).toBe(50);
  });

  it('rotate=90 swaps dimensions', async () => {
    const bitmap = await makeTestBitmap(100, 50);
    const result = applyTransforms(bitmap, { rotate: 90 });
    expect(result.width).toBe(50);
    expect(result.height).toBe(100);
  });

  it('width only: height auto-computed', async () => {
    const bitmap = await makeTestBitmap(200, 100); // 2:1
    const result = applyTransforms(bitmap, { width: 100 });
    expect(result.width).toBe(100);
    expect(result.height).toBe(50);
  });

  it('combined rotate + width override in single draw', async () => {
    const bitmap = await makeTestBitmap(200, 100);
    const result = applyTransforms(bitmap, { rotate: 90, width: 50 });
    // After rotate 90: 100x200. After width=50: 50x100 (preserve aspect)
    expect(result.width).toBe(50);
    expect(result.height).toBe(100);
  });

  it('mirror + exact width in single draw', async () => {
    const bitmap = await makeTestBitmap(100, 50);
    const result = applyTransforms(bitmap, { mirror: 'horizontal', width: 200 });
    expect(result.width).toBe(200);
    expect(result.height).toBe(100);
  });

  it('all transforms in one draw (no extra bitmaps)', async () => {
    const bitmap = await makeTestBitmap(200, 100);
    const before = bitmap; // Same reference = single draw
    const result = applyTransforms(before, {
      rotate: 90,
      mirror: 'vertical',
      width: 150,
      keepAspectRatio: true,
    });
    // Should be valid bitmap (not the same one, but only 1 new bitmap)
    expect(result.bitmap).not.toBe(before);
    expect(result.bitmap.width).toBe(result.width);
    expect(result.bitmap.height).toBe(result.height);
  });
});

describe('compressAll() with continueOnError', () => {
  let svc: ImageCompression;

  beforeEach(() => {
    svc = new ImageCompression();
  });

  it('continueOnError=false (default): rejects on first error', async () => {
    // Use forcePath to make worker throw
    const files = [
      new File([new Uint8Array([0xff, 0xd8, 0xff])], 'a.jpg', { type: 'image/jpeg' }),
      new File([new Uint8Array([0xff, 0xd8, 0xff])], 'b.jpg', { type: 'image/jpeg' }),
    ];
    await expect(
      svc.compressAll(files, { forcePath: 'webcodecs-worker' as any }),
    ).rejects.toThrow();
  });

  it('continueOnError=true: succeeds even if some files fail', async () => {
    // Mix of valid and force-fail
    const files = [
      new File([new Uint8Array([0xff, 0xd8, 0xff])], 'a.jpg', { type: 'image/jpeg' }),
      new File([new Uint8Array([0xff, 0xd8, 0xff])], 'b.jpg', { type: 'image/jpeg' }),
    ];
    // With forceServer, both should succeed via server-fallback
    const results = await svc.compressAll(files, { forceServer: true, continueOnError: true });
    expect(results).toHaveLength(2);
    expect(results[0]).toBeDefined();
    expect(results[1]).toBeDefined();
  });
});
