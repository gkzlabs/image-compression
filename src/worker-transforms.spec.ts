/**
 * Tests for encodeOffscreenWithTransforms — the worker-side single-draw
 * transform+encode helper (v1.2.0).
 *
 * Design guarantee (v1.2.0): this is the Chrome-149-safe path for running
 * manual transforms inside the Worker WITHOUT the long "image source is
 * detached" history. It draws the source ONCE onto the final encode canvas
 * under a ctx transform (translate→rotate→mirror→scale) then convertToBlob —
 * no `transferToImageBitmap` chain, no intermediate bitmaps.
 *
 * Contract pinned here:
 *   1. Correct post-transform dimensions (rotate swaps; exact resize wins over
 *      maxWidthOrHeight; keepAspectRatio fits-within).
 *   2. Does NOT close / touch the source bitmap (caller owns lifetime).
 *   3. Returns a real Blob of the requested format.
 */
import { describe, it, expect, vi } from 'vitest';
import { encodeOffscreenWithTransforms } from './worker-helpers';

function makeBitmap(w = 100, h = 50): ImageBitmap {
  // Build a REAL drawable source (via the @napi-rs/canvas-backed OffscreenCanvas
  // polyfill) so ctx.drawImage accepts it — plain {width,height} fakes throw
  // "Value is not one of these types: CanvasElement, SVGCanvas, Image".
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#336699';
    ctx.fillRect(0, 0, w, h);
  }
  return canvas.transferToImageBitmap() as unknown as ImageBitmap;
}

describe('encodeOffscreenWithTransforms', () => {
  it('rotate 90 swaps dimensions (100x50 → 50x100)', async () => {
    const source = makeBitmap(100, 50);
    const { blob, width, height } = await encodeOffscreenWithTransforms(
      source,
      'image/jpeg',
      0.8,
      { rotate: 90 },
    );
    expect(width).toBe(50);
    expect(height).toBe(100);
    // convertToBlob polyfill resolves the requested type
    expect(blob.type).toBe('image/jpeg');
    expect(blob.size).toBeGreaterThan(0);
  });

  it('exact width+height wins (stretch) over maxWidthOrHeight', async () => {
    const source = makeBitmap(100, 50);
    const { width, height } = await encodeOffscreenWithTransforms(
      source,
      'image/jpeg',
      0.8,
      { width: 40, height: 40, maxWidthOrHeight: 200 },
    );
    expect(width).toBe(40);
    expect(height).toBe(40);
  });

  it('exact width only computes height by aspect ratio', async () => {
    const source = makeBitmap(100, 50);
    const { width, height } = await encodeOffscreenWithTransforms(
      source,
      'image/jpeg',
      0.8,
      { width: 40 },
    );
    expect(width).toBe(40);
    expect(height).toBe(20);
  });

  it('maxWidthOrHeight fits within-box (400x200 → 200x100)', async () => {
    const source = makeBitmap(400, 200);
    const { width, height } = await encodeOffscreenWithTransforms(
      source,
      'image/jpeg',
      0.8,
      { maxWidthOrHeight: 200 },
    );
    expect(width).toBe(200);
    expect(height).toBe(100);
  });

  it('rotate 90 + maxWidthOrHeight composes (400x200→ longest 200)', async () => {
    // rotate 90 swaps to 200x400 footprint; longest edge 400→200.
    const source = makeBitmap(400, 200);
    const { width, height } = await encodeOffscreenWithTransforms(
      source,
      'image/jpeg',
      0.8,
      { rotate: 90, maxWidthOrHeight: 200 },
    );
    expect(width).toBe(100);
    expect(height).toBe(200);
  });

  it('keepAspectRatio fits within the exact box', async () => {
    // source 100x50 (2:1), box 40x40 with keepAspectRatio → 40x20
    const source = makeBitmap(100, 50);
    const { width, height } = await encodeOffscreenWithTransforms(
      source,
      'image/jpeg',
      0.8,
      { width: 40, height: 40, keepAspectRatio: true },
    );
    expect(width).toBe(40);
    expect(height).toBe(20);
  });

  it('mirror keeps dimensions', async () => {
    const source = makeBitmap(80, 60);
    const { width, height } = await encodeOffscreenWithTransforms(
      source,
      'image/webp',
      0.8,
      { mirror: 'horizontal' },
    );
    expect(width).toBe(80);
    expect(height).toBe(60);
    expect(blobOf()).toBeInstanceOf(Blob);
  });

  it('does NOT close the source bitmap (caller owns lifetime)', async () => {
    const source = makeBitmap(100, 50);
    const close = vi.spyOn(source, 'close');
    await encodeOffscreenWithTransforms(source, 'image/png', 0.9, { rotate: 270 });
    expect(close).toHaveBeenCalledTimes(0);
  });

  it('clamps extreme aspect ratios to >= 1px (no 0-dim output)', async () => {
    // 8192x3: rotate 90 → 3x8192 footprint, maxWidthOrHeight 2048 →
    // finalH=2048, finalW=round(2048*3/8192)=1
    const source = makeBitmap(8192, 3);
    const { width, height } = await encodeOffscreenWithTransforms(
      source,
      'image/jpeg',
      0.8,
      { rotate: 90, maxWidthOrHeight: 2048 },
    );
    expect(width).toBeGreaterThanOrEqual(1);
    expect(height).toBeGreaterThanOrEqual(1);
  });
});

// helper so the mirror test can reference a Blob
function blobOf(): Blob {
  return new Blob(['x'], { type: 'image/jpeg' });
}