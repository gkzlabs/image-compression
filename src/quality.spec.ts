/**
 * Tests for v1.1.0 quality improvements:
 *  - downscaleInSteps() multi-step downscale
 *  - applySharpen() unsharp-mask helper
 *  - qualityBoost option (WebP/AVIF quality mapping)
 *  - sharpen wiring through compress()
 */
import { describe, it, expect } from 'vitest';
import { createCanvas, type Canvas } from '@napi-rs/canvas';
import { downscaleInSteps, applySharpen } from './worker-helpers';
import { ImageCompression } from './service';

/** Create a real JPEG blob decodable by createImageBitmap (napi-rs loadImage). */
function makeJpegBlob(width: number, height: number): Blob {
  const canvas: Canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#3366ff';
  ctx.fillRect(0, 0, width, height);
  // Sharp edges + fine detail so downscale quality differences are visible
  ctx.fillStyle = '#ff8800';
  ctx.fillRect(0, 0, width / 4, height / 4);
  for (let y = 0; y < height; y += 4) {
    for (let x = 0; x < width; x += 4) {
      ctx.fillStyle = (x + y) % 8 === 0 ? '#000' : '#fff';
      ctx.fillRect(x, y, 2, 2);
    }
  }
  const buffer = canvas.toBuffer('image/jpeg', 0.9);
  return new Blob([new Uint8Array(buffer)], { type: 'image/jpeg' });
}

describe('v1.1.0 downscaleInSteps (multi-step downscale)', () => {
  it('downscales to exact target dimensions', async () => {
    const canvas: Canvas = createCanvas(4000, 3000);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 4000, 3000);
    const blob = new Blob([new Uint8Array(canvas.toBuffer('image/jpeg', 0.9))], {
      type: 'image/jpeg',
    });
    const bitmap = await createImageBitmap(blob);
    const out = downscaleInSteps(bitmap, 2048, 1536);
    expect(out.width).toBe(2048);
    expect(out.height).toBe(1536);
    const c = out.canvas as unknown as Canvas;
    expect(c.width).toBe(2048);
    expect(c.height).toBe(1536);
    bitmap.close();
  });

  it('returns same-size canvas when target == source (no steps)', async () => {
    const canvas: Canvas = createCanvas(100, 100);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#f00';
    ctx.fillRect(0, 0, 100, 100);
    const blob = new Blob([new Uint8Array(canvas.toBuffer('image/jpeg', 0.9))], {
      type: 'image/jpeg',
    });
    const bitmap = await createImageBitmap(blob);
    const out = downscaleInSteps(bitmap, 100, 100);
    expect(out.width).toBe(100);
    expect(out.height).toBe(100);
    bitmap.close();
  });

  // REGRESSION (v1.1.0): a 0 target made the halving loop spin forever —
  // Math.round(1/2) === 1 in JS, so curW stalled at 1 while `curW > 0`
  // stayed true. Reachable via `width: 0` options or extreme aspect
  // ratios (e.g. 8192×1 → Math.round(2048 / 8192) === 0). These tests
  // would hang (vitest timeout) if the guard regressed.
  it('does NOT infinite-loop on target (0, 0) — clamps to 1×1', async () => {
    const canvas: Canvas = createCanvas(100, 100);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#0f0';
    ctx.fillRect(0, 0, 100, 100);
    const blob = new Blob([new Uint8Array(canvas.toBuffer('image/jpeg', 0.9))], {
      type: 'image/jpeg',
    });
    const bitmap = await createImageBitmap(blob);
    const out = downscaleInSteps(bitmap, 0, 0);
    expect(out.width).toBe(1);
    expect(out.height).toBe(1);
    bitmap.close();
  });

  it('does NOT infinite-loop on target (2048, 0) — clamps height to 1', async () => {
    const canvas: Canvas = createCanvas(4000, 3000);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#00f';
    ctx.fillRect(0, 0, 4000, 3000);
    const blob = new Blob([new Uint8Array(canvas.toBuffer('image/jpeg', 0.9))], {
      type: 'image/jpeg',
    });
    const bitmap = await createImageBitmap(blob);
    const out = downscaleInSteps(bitmap, 2048, 0);
    expect(out.width).toBe(2048);
    expect(out.height).toBe(1);
    bitmap.close();
  });

  it('does NOT infinite-loop on extreme aspect ratio (8192×1 → target 2048×0)', async () => {
    // Simulates a pathological panorama strip: ratio math rounds the short
    // edge to 0, which used to hang the halving loop forever.
    const canvas: Canvas = createCanvas(8192, 1);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#808';
    ctx.fillRect(0, 0, 8192, 1);
    const blob = new Blob([new Uint8Array(canvas.toBuffer('image/jpeg', 0.9))], {
      type: 'image/jpeg',
    });
    const bitmap = await createImageBitmap(blob);
    const out = downscaleInSteps(bitmap, 2048, 0);
    expect(out.width).toBe(2048);
    expect(out.height).toBe(1);
    bitmap.close();
  });

  it('handles fractional/NaN targets defensively (no hang, no throw)', async () => {
    const canvas: Canvas = createCanvas(50, 50);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fc0';
    ctx.fillRect(0, 0, 50, 50);
    const blob = new Blob([new Uint8Array(canvas.toBuffer('image/jpeg', 0.9))], {
      type: 'image/jpeg',
    });
    const bitmap = await createImageBitmap(blob);
    const out = downscaleInSteps(bitmap, NaN, -5);
    expect(out.width).toBe(1);
    expect(out.height).toBe(1);
    bitmap.close();
  });
});

describe('v1.1.0 applySharpen (unsharp mask)', () => {
  it('produces an output canvas at target dims', () => {
    const canvas: Canvas = createCanvas(200, 200);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#888';
    ctx.fillRect(0, 0, 200, 200);
    // Edges to sharpen
    ctx.fillStyle = '#000';
    ctx.fillRect(95, 0, 10, 200);
    // NOTE: @napi-rs/canvas (real Canvas) is the test-env stand-in for the
    // browser's HTMLCanvasElement — drawImage accepts it directly.
    const out = applySharpen(canvas as unknown as CanvasImageSource, 0.5, 200, 200);
    expect(out.width).toBe(200);
    expect(out.height).toBe(200);
  });

  it('strength 0.5 does not crash on tiny images', () => {
    const canvas: Canvas = createCanvas(8, 8);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#333';
    ctx.fillRect(0, 0, 8, 8);
    // 1/4 of 8 = 2px — still >= 1, no division issues
    const out = applySharpen(canvas as unknown as CanvasImageSource, 0.5, 8, 8);
    expect(out.width).toBe(8);
    expect(out.height).toBe(8);
  });
});

describe('v1.1.0 qualityBoost wiring', () => {
  it('boosts quality when format is WebP and qualityBoost enabled', async () => {
    const svc = new ImageCompression();
    try {
      const blob = makeJpegBlob(800, 600);
      const file = new File([blob], 'test.jpg', { type: 'image/jpeg' });
      const result = await svc.compress(file, {
        format: 'image/webp',
        qualityBoost: true,
        quality: 0.8,
        forcePath: 'canvas-main',
      });
      // Must still produce valid webp output (boosted quality ~0.9)
      expect(result.mimeType).toBe('image/webp');
      expect(result.compressedSize).toBeGreaterThan(0);
      expect(result.width).toBe(800);
    } finally {
      svc.dispose();
    }
  });

  it('does not crash when qualityBoost with JPEG (no boost applied)', async () => {
    const svc = new ImageCompression();
    try {
      const blob = makeJpegBlob(400, 300);
      const file = new File([blob], 'test.jpg', { type: 'image/jpeg' });
      const result = await svc.compress(file, {
        format: 'image/jpeg',
        qualityBoost: true,
        forcePath: 'canvas-main',
      });
      expect(result.mimeType).toBe('image/jpeg');
      expect(result.compressedSize).toBeGreaterThan(0);
    } finally {
      svc.dispose();
    }
  });
});

describe('v1.1.0 sharpen wiring through compress()', () => {
  it('sharpen: 0.3 produces a valid result (canvas-main)', async () => {
    const svc = new ImageCompression();
    try {
      const blob = makeJpegBlob(800, 600);
      const file = new File([blob], 'test.jpg', { type: 'image/jpeg' });
      const result = await svc.compress(file, {
        sharpen: 0.3,
        forcePath: 'canvas-main',
      });
      expect(result.compressedSize).toBeGreaterThan(0);
      expect(result.width).toBe(800);
      expect(result.height).toBe(600);
    } finally {
      svc.dispose();
    }
  });

  it('sharpen: 0 (default) is a no-op that still compresses', async () => {
    const svc = new ImageCompression();
    try {
      const blob = makeJpegBlob(400, 300);
      const file = new File([blob], 'test.jpg', { type: 'image/jpeg' });
      const result = await svc.compress(file, {
        forcePath: 'canvas-main',
      });
      expect(result.compressedSize).toBeGreaterThan(0);
    } finally {
      svc.dispose();
    }
  });

  // REGRESSION (v1.1.0): explicit width: 0 used to reach downscaleInSteps
  // with a 0 target and hang forever in the halving loop. Must return a
  // valid 1px output instead.
  it('width: 0 does NOT hang canvas-main (clamps to 1px, valid output)', async () => {
    const svc = new ImageCompression();
    try {
      const blob = makeJpegBlob(800, 600);
      const file = new File([blob], 'test.jpg', { type: 'image/jpeg' });
      const result = await svc.compress(file, {
        width: 0,
        forcePath: 'canvas-main',
      });
      expect(result.compressedSize).toBeGreaterThan(0);
      expect(result.width).toBe(1);
      expect(result.height).toBe(1);
    } finally {
      svc.dispose();
    }
  });
});