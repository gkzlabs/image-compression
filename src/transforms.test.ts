/**
 * Tests for applyRotation() — manual rotation and mirror transforms.
 */
import { applyRotation, resizeExact } from './worker-helpers';

describe('applyRotation()', () => {
  /**
   * Create a test bitmap with a known pattern.
   * Top-left 10x10 is red (#FF0000), rest is blue (#0000FF).
   * Width 100, height 50.
   */
  async function makeTestBitmap(width = 100, height = 50): Promise<ImageBitmap> {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No 2d context');
    ctx.fillStyle = '#0000FF';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#FF0000';
    ctx.fillRect(0, 0, 10, 10);
    return canvas.transferToImageBitmap();
  }

  it('rotate=0, no mirror returns the same bitmap (fast path)', async () => {
    const bitmap = await makeTestBitmap();
    const result = await applyRotation(bitmap, 0);
    expect(result.width).toBe(100);
    expect(result.height).toBe(50);
    expect(result.bitmap).toBe(bitmap);
  });

  it('rotate=90 swaps width and height', async () => {
    const bitmap = await makeTestBitmap(100, 50);
    const result = await applyRotation(bitmap, 90);
    expect(result.width).toBe(50);
    expect(result.height).toBe(100);
  });

  it('rotate=180 keeps width and height', async () => {
    const bitmap = await makeTestBitmap(100, 50);
    const result = await applyRotation(bitmap, 180);
    expect(result.width).toBe(100);
    expect(result.height).toBe(50);
  });

  it('rotate=270 swaps width and height', async () => {
    const bitmap = await makeTestBitmap(100, 50);
    const result = await applyRotation(bitmap, 270);
    expect(result.width).toBe(50);
    expect(result.height).toBe(100);
  });

  it('mirror=horizontal produces a valid bitmap (no throw)', async () => {
    const bitmap = await makeTestBitmap();
    const result = await applyRotation(bitmap, 0, 'horizontal');
    expect(result.width).toBe(100);
    expect(result.height).toBe(50);
  });

  it('mirror=vertical produces a valid bitmap (no throw)', async () => {
    const bitmap = await makeTestBitmap();
    const result = await applyRotation(bitmap, 0, 'vertical');
    expect(result.width).toBe(100);
    expect(result.height).toBe(50);
  });

  it('rotate=180 + mirror=horizontal combines transforms', async () => {
    const bitmap = await makeTestBitmap(100, 50);
    const result = await applyRotation(bitmap, 180, 'horizontal');
    expect(result.width).toBe(100);
    expect(result.height).toBe(50);
  });
});

describe('resizeExact()', () => {
  async function makeTestBitmap(width = 100, height = 50): Promise<ImageBitmap> {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No 2d context');
    ctx.fillStyle = '#0000FF';
    ctx.fillRect(0, 0, width, height);
    return canvas.transferToImageBitmap();
  }

  it('width only: height computed to preserve aspect ratio', async () => {
    const bitmap = await makeTestBitmap(200, 100); // 2:1
    const result = await resizeExact(bitmap, 100); // width=100
    expect(result.width).toBe(100);
    expect(result.height).toBe(50); // preserved 2:1
  });

  it('height only: width computed to preserve aspect ratio', async () => {
    const bitmap = await makeTestBitmap(200, 100); // 2:1
    const result = await resizeExact(bitmap, undefined, 50); // height=50, width=undefined
    expect(result.width).toBe(100);
    expect(result.height).toBe(50);
  });

  it('width + height: stretches to exact (no aspect ratio)', async () => {
    const bitmap = await makeTestBitmap(200, 100);
    const result = await resizeExact(bitmap, 100, 100, false);
    expect(result.width).toBe(100);
    expect(result.height).toBe(100);
  });

  it('width + height + keepAspectRatio: fit-within (letterbox)', async () => {
    const bitmap = await makeTestBitmap(200, 100); // 2:1 wide
    const result = await resizeExact(bitmap, 100, 100, true); // 1:1 box
    // Box is taller than image (ratio 1 < 2), so fit by width
    expect(result.width).toBe(100);
    expect(result.height).toBe(50); // 2:1 preserved
  });

  it('no-op when target dimensions match source', async () => {
    const bitmap = await makeTestBitmap(100, 50);
    const result = await resizeExact(bitmap, 100, 50);
    expect(result.width).toBe(100);
    expect(result.height).toBe(50);
    expect(result.bitmap).toBe(bitmap);
  });
});
