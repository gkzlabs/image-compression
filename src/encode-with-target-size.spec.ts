/**
 * Regression tests for the target-size ladder + transform interaction.
 *
 * The v1.3.0 bug: `encodeWithTargetSize()` drew the source bitmap with a plain
 * `drawImage(source, 0, 0, w, h)`, so when the caller had already applied
 * rotate/mirror (and passed the post-transform dimensions), every ladder step
 * re-encoded the UNTRANSFORMED bitmap at those dimensions. The output kept the
 * "portrait" dimensions (they come from the caller) but the pixels were the
 * unrotated image stretched into the box — silently wrong, and only a pixel
 * check can see it. Fix: both the plain transform encode and the ladder draw
 * through the shared `drawTransformed()` primitive.
 *
 * The environment supports real pixels here: vitest.setup.ts backs
 * OffscreenCanvas with @napi-rs/canvas, and this spec decodes the returned
 * blobs with @napi-rs/canvas so the assertions are on actual RGB values.
 */
import { describe, it, expect } from 'vitest';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { drawTransformed, encodeWithTargetSize } from './worker-helpers';

/** 2-tone source: red left half, blue right half (120x80). */
function toneBitmap(width = 120, height = 80): ImageBitmap {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  ctx.fillStyle = '#ff0000';
  ctx.fillRect(0, 0, width / 2, height);
  ctx.fillStyle = '#0000ff';
  ctx.fillRect(width / 2, 0, width / 2, height);
  return canvas.transferToImageBitmap();
}

type Region = 'top' | 'bottom' | 'left' | 'right';

/** Average RGB of a region read from a real 2D context (pixels, not metadata). */
function regionColorFromCtx(
  ctx: { getImageData: (x: number, y: number, w: number, h: number) => { data: Uint8ClampedArray } },
  width: number,
  height: number,
  region: Region,
): { r: number; g: number; b: number } {
  const box: [number, number, number, number] =
    region === 'top'
      ? [0, 0, width, Math.max(1, Math.floor(height / 2))]
      : region === 'bottom'
        ? [0, Math.floor(height / 2), width, height - Math.floor(height / 2)]
        : region === 'left'
          ? [0, 0, Math.max(1, Math.floor(width / 2)), height]
          : [Math.floor(width / 2), 0, width - Math.floor(width / 2), height];
  const data = ctx.getImageData(...box).data;
  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = 0; i < data.length; i += 4) {
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
  }
  const n = data.length / 4;
  return { r: r / n, g: g / n, b: b / n };
}

/** Decode an encoded blob with @napi-rs/canvas and average a region. */
async function regionColorOfBlob(blob: Blob, region: Region) {
  const buffer = Buffer.from(await blob.arrayBuffer());
  const img = await loadImage(buffer);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img as unknown as never, 0, 0);
  return { ...regionColorFromCtx(ctx, img.width, img.height, region), width: img.width, height: img.height };
}

const dominant = (c: { r: number; g: number; b: number }) =>
  c.r >= c.g && c.r >= c.b ? 'red' : c.b >= c.g ? 'blue' : 'green';

describe('drawTransformed() — the shared single-draw primitive', () => {
  it('rotate 90 maps the left half (red) to the top', () => {
    const source = toneBitmap(120, 80);
    const out = new OffscreenCanvas(80, 120);
    const ctx = out.getContext('2d')!;
    drawTransformed(ctx, source, 80, 120, { rotate: 90 });

    expect(dominant(regionColorFromCtx(ctx, 80, 120, 'top'))).toBe('red');
    expect(dominant(regionColorFromCtx(ctx, 80, 120, 'bottom'))).toBe('blue');
  });

  it('mirror horizontal swaps the halves', () => {
    const source = toneBitmap(120, 80);
    const out = new OffscreenCanvas(120, 80);
    const ctx = out.getContext('2d')!;
    drawTransformed(ctx, source, 120, 80, { mirror: 'horizontal' });

    expect(dominant(regionColorFromCtx(ctx, 120, 80, 'left'))).toBe('blue');
    expect(dominant(regionColorFromCtx(ctx, 120, 80, 'right'))).toBe('red');
  });

  it('rotate 0 + explicit target size behaves like a plain scale (no rotation)', () => {
    const source = toneBitmap(120, 80);
    const out = new OffscreenCanvas(60, 40);
    const ctx = out.getContext('2d')!;
    drawTransformed(ctx, source, 60, 40, { rotate: 0 });

    expect(dominant(regionColorFromCtx(ctx, 60, 40, 'left'))).toBe('red');
    expect(dominant(regionColorFromCtx(ctx, 60, 40, 'right'))).toBe('blue');
  });
});

describe('encodeWithTargetSize() — ladder keeps the transform (v1.3.0 regression)', () => {
  it('rotate 90 survives the ladder, with portrait dims and rotated pixels', async () => {
    const source = toneBitmap(120, 80);
    // Tiny budget forces the binary-search + dimension ladder to run.
    const sized = await encodeWithTargetSize(source, 'image/jpeg', 0.9, 0.0005, 80, 120, {
      rotate: 90,
    });
    expect(sized).not.toBeNull();
    const result = sized!;
    // Dimensions come from the caller, so they alone cannot catch the bug:
    expect(result.height).toBeGreaterThan(result.width);
    // The pixels can, and do (this assertion fails on the v1.3.0 code):
    const top = await regionColorOfBlob(result.blob, 'top');
    const bottom = await regionColorOfBlob(result.blob, 'bottom');
    expect(dominant(top)).toBe('red');
    expect(dominant(bottom)).toBe('blue');
  });

  it('mirror survives the ladder', async () => {
    const source = toneBitmap(120, 80);
    const sized = await encodeWithTargetSize(source, 'image/jpeg', 0.9, 0.0005, 120, 80, {
      mirror: 'horizontal',
    });
    expect(sized).not.toBeNull();
    const left = await regionColorOfBlob(sized!.blob, 'left');
    const right = await regionColorOfBlob(sized!.blob, 'right');
    expect(dominant(left)).toBe('blue');
    expect(dominant(right)).toBe('red');
  });

  it('without a transform it is a plain downscale (unchanged behaviour)', async () => {
    const source = toneBitmap(120, 80);
    const sized = await encodeWithTargetSize(source, 'image/jpeg', 0.9, 0.0005, 120, 80);
    expect(sized).not.toBeNull();
    const left = await regionColorOfBlob(sized!.blob, 'left');
    const right = await regionColorOfBlob(sized!.blob, 'right');
    expect(dominant(left)).toBe('red');
    expect(dominant(right)).toBe('blue');
    expect(sized!.width).toBeGreaterThanOrEqual(sized!.height);
  });
});
