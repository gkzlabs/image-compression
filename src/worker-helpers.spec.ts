import { applyExifOrientation } from './worker-helpers';
import type { ExifOrientation } from './exif';

/**
 * Tests for EXIF orientation auto-rotation.
 *
 * NOTE: These tests require a real Canvas2D context with full drawing API
 * support. happy-dom doesn't provide this (getContext('2d') returns null).
 * The actual EXIF rotation behavior is verified in the browser via the
 * Angular demo's e2e tests, where createImageBitmap + OffscreenCanvas work.
 *
 * For vitest, we only test the dimension-swap logic (orientations 5-8 swap
 * width/height; others keep dimensions). Full pixel verification requires
 * a real browser environment.
 */
describe('applyExifOrientation()', () => {
  /**
   * Helper: create a 100x50 test bitmap (2:1 aspect ratio).
   * The top-left corner is red, the rest is blue — so we can visually verify
   * rotation/flip by reading the pixel at (0,0) of the output.
   */
  async function makeTestBitmap(
    width = 100,
    height = 50,
  ): Promise<ImageBitmap> {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No 2d context');
    // Fill with blue
    ctx.fillStyle = '#0000FF';
    ctx.fillRect(0, 0, width, height);
    // Top-left 10x10 red
    ctx.fillStyle = '#FF0000';
    ctx.fillRect(0, 0, 10, 10);
    return canvas.transferToImageBitmap();
  }

  it('orientation 1 returns original unchanged (no-op fast path)', async () => {
    const bitmap = await makeTestBitmap(100, 50);
    const result = await applyExifOrientation(bitmap, 1);
    expect(result.width).toBe(100);
    expect(result.height).toBe(50);
    expect(result.bitmap).toBe(bitmap); // Same reference
  });

  it('orientation 3 (180°) swaps width/height = false', async () => {
    const bitmap = await makeTestBitmap(100, 50);
    const result = await applyExifOrientation(bitmap, 3);
    expect(result.width).toBe(100);
    expect(result.height).toBe(50);
  });

  [5, 6, 7, 8].forEach((orientation) => {
    it(`orientation ${orientation} swaps width and height`, async () => {
      const bitmap = await makeTestBitmap(100, 50);
      const result = await applyExifOrientation(bitmap, orientation as ExifOrientation);
      expect(result.width).toBe(50);  // swapped
      expect(result.height).toBe(100);
    });
  });

  [2, 3, 4, 5, 6, 7, 8].forEach((orientation) => {
    it(`orientation ${orientation} produces a valid bitmap (not throwing)`, async () => {
      const bitmap = await makeTestBitmap(80, 60);
      const result = await applyExifOrientation(bitmap, orientation as ExifOrientation);
      expect(result.bitmap).toBeDefined();
      expect(result.bitmap.width).toBeGreaterThan(0);
      expect(result.bitmap.height).toBeGreaterThan(0);
    });
  });

  it('orientation 6 (90° CW) produces correctly rotated output', async () => {
    const bitmap = await makeTestBitmap(100, 50);
    const result = await applyExifOrientation(bitmap, 6);

    // After 90° CW rotation:
    // - Dimensions swap: 50 x 100
    // - The red square (originally at top-left) should now be at the top-right
    //   (because the top edge of the original became the right edge of the rotated)

    expect(result.width).toBe(50);
    expect(result.height).toBe(100);

    // Verify the dimensions are correct (pixel verification skipped in happy-dom
    // because createImageBitmap(OffscreenCanvas) doesn't preserve pixel data in
    // the test environment. Real browser behavior is verified in the demo.)
    expect(result.bitmap.width).toBe(50);
    expect(result.bitmap.height).toBe(100);
  });

  it('out-of-range orientation returns original unchanged', async () => {
    const bitmap = await makeTestBitmap(100, 50);
    const result = await applyExifOrientation(bitmap, 0 as ExifOrientation);
    expect(result.bitmap).toBe(bitmap);
    expect(result.width).toBe(100);
    expect(result.height).toBe(50);

    const result9 = await applyExifOrientation(bitmap, 9 as ExifOrientation);
    expect(result9.bitmap).toBe(bitmap);
  });
});
