/**
 * Tests for v1.3.0: `reachTargetSize` moved into the Worker.
 *
 * Design guarantee: the binary-search + dimension ladder logic is extracted
 * into a canvas-agnostic `shrinkToTargetSize` helper (src/target-size.ts) that
 * delegates the actual draw+encode to an `encodeAt` callback. This lets the
 * SAME ladder run in a Web Worker (OffscreenCanvas.convertToBlob) AND on the
 * main thread (HTMLCanvasElement.toBlob) — so devices WITHOUT a Worker keep
 * the main-thread fallback, exactly as before. This is the "works on every
 * device" contract.
 *
 * Coverage:
 *   1. shrinkToTargetSize — pure ladder (mock encodeAt returns size by w/h/q)
 *   2. encodeWithTargetSize — worker adapter builds a real blob (napi canvas)
 *   3. targetSizeHandledByWorker — true only for worker path + maxSizeMB
 *   4. reachTargetSize no-ops when __targetSizeApplied (no double re-encode)
 *   5. reachTargetSize still runs the ladder when NOT worker-applied (fallback)
 */
import { describe, it, expect } from 'vitest';
import { createCanvas, type Canvas } from '@napi-rs/canvas';
import { shrinkToTargetSize } from './target-size';
import { encodeWithTargetSize } from './worker-helpers';
import { ImageCompression } from './service';
import type { CompressionOptions, CompressionResult, CompressionPath } from './types';

function makeBitmap(w: number, h: number): ImageBitmap {
  const canvas: Canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#5865f2';
    ctx.fillRect(0, 0, w, h);
  }
  return canvas as unknown as ImageBitmap;
}

function makeJpegBlob(width: number, height: number, quality = 0.9): Blob {
  const canvas: Canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#5865f2';
    ctx.fillRect(0, 0, width, height);
  }
  return new Blob([new Uint8Array(canvas.toBuffer('image/jpeg', quality))], { type: 'image/jpeg' });
}

const baseResult = (blob: Blob, width = 100, height = 100): CompressionResult => ({
  file: new File([blob], 'x.jpg', { type: 'image/jpeg' }),
  blob,
  name: 'x.jpg',
  originalSize: blob.size,
  compressedSize: blob.size,
  width,
  height,
  path: 'offscreen-worker' as CompressionPath,
  durationMs: 1,
  tier: 'high',
  mimeType: 'image/jpeg',
});

describe('shrinkToTargetSize (canvas-agnostic ladder)', () => {
  it('returns null when the adaptor never produces a blob', async () => {
    const bitmap = makeBitmap(100, 100);
    const result = await shrinkToTargetSize(
      bitmap, 100, 100, 'image/jpeg', 0.85, 100,
      () => Promise.resolve(null),
    );
    expect(result).toBeNull();
  });

  it('returns the caller-quality fit in one encode when it already fits', async () => {
    const bitmap = makeBitmap(100, 100);
    let calls = 0;
    // encodeAt returns a 50-byte blob whenever q >= 0.4 → all fit under 100KB
    const result = await shrinkToTargetSize(
      bitmap, 100, 100, 'image/jpeg', 0.85, 100 * 1024,
      (w, h, q) => {
        calls++;
        return Promise.resolve(new Blob([new Uint8Array(50)], { type: 'image/jpeg' }));
      },
    );
    expect(result).not.toBeNull();
    // First probe at caller's q0.85 fits → single encode, no extra work.
    expect(calls).toBe(1);
    expect(result!.width).toBe(100);
  });

  it('steps quality DOWN (same dims) until target fits', async () => {
    const bitmap = makeBitmap(100, 100);
    // encodeAt simulates: smaller q → smaller blob. dims stay 100x100.
    const encode = (w: number, h: number, q: number) => {
      const size = Math.round(q * 200 * 1024); // q0.85→170KB, q0.2→40KB
      return Promise.resolve(new Blob([new Uint8Array(size)], { type: 'image/jpeg' }));
    };
    const result = await shrinkToTargetSize(bitmap, 100, 100, 'image/jpeg', 0.85, 50 * 1024, encode);
    expect(result).not.toBeNull();
    expect(result!.blob.size).toBeLessThanOrEqual(50 * 1024);
    expect(result!.width).toBe(100); // dims unchanged — quality did the work
  });

  it('steps dimensions DOWN when quality alone cannot reach target', async () => {
    const bitmap = makeBitmap(100, 100);
    // Very strict target: even q0.2 at 100px is too big, so dims must shrink.
    const encode = (w: number, h: number, q: number) => {
      // size grows with w*h and q. At 100px+q0.2 → huge; at 50px → fits.
      const size = Math.round((w * h) / 10 + q * 1000);
      return Promise.resolve(new Blob([new Uint8Array(size)], { type: 'image/jpeg' }));
    };
    const result = await shrinkToTargetSize(bitmap, 100, 100, 'image/jpeg', 0.85, 1000, encode);
    expect(result).not.toBeNull();
    expect(result!.width).toBeLessThan(100); // dims shrank
  });

  it('PNG uses dimension ladder only (quality ignored)', async () => {
    const bitmap = makeBitmap(80, 80);
    const encode = (w: number, h: number, _q: number) => {
      const size = Math.round(w * h * 3); // 80px→19KB, 40px→4.8KB
      return Promise.resolve(new Blob([new Uint8Array(size)], { type: 'image/png' }));
    };
    const result = await shrinkToTargetSize(bitmap, 80, 80, 'image/png', 0.85, 5000, encode);
    expect(result).not.toBeNull();
    expect(result!.blob.size).toBeLessThanOrEqual(5000);
  });

  it('returns the smallest achievable when target is physically unreachable', async () => {
    const bitmap = makeBitmap(100, 100);
    // Impossible target: even the smallest possible output exceeds it.
    const encode = (w: number, h: number, _q: number) =>
      Promise.resolve(new Blob([new Uint8Array(10_000)], { type: 'image/jpeg' }));
    const result = await shrinkToTargetSize(bitmap, 100, 100, 'image/jpeg', 0.85, 1, encode);
    expect(result).not.toBeNull(); // still returns SOMETHING (best achievable)
    expect(result!.blob.size).toBeGreaterThan(1);
  });
});

describe('encodeWithTargetSize (worker OffscreenCanvas adapter)', () => {
  it('produces a real blob via OffscreenCanvas.convertToBlob', async () => {
    const bitmap = makeBitmap(200, 200);
    const result = await encodeWithTargetSize(bitmap, 'image/jpeg', 0.85, 2, 200, 200);
    expect(result).not.toBeNull();
    expect(result!.blob).toBeInstanceOf(Blob);
    expect(result!.width).toBeGreaterThan(0);
    expect(result!.height).toBeGreaterThan(0);
  });

  it('does NOT close the source bitmap (caller owns lifecycle)', async () => {
    // makeBitmap() returns a napi canvas (no close()), so install a counting
    // close() to prove the helper leaves the caller's source alone — this used
    // to be a vacuous `expect(true).toBe(true)`.
    const source = makeBitmap(100, 100) as unknown as {
      close?: () => void;
      width: number;
      height: number;
    };
    let closeCalls = 0;
    source.close = () => {
      closeCalls++;
    };

    await encodeWithTargetSize(source as unknown as ImageBitmap, 'image/jpeg', 0.85, 2, 100, 100);

    expect(closeCalls).toBe(0);
    expect(source.width).toBe(100);
    expect(source.height).toBe(100);
  });
});

describe('targetSizeHandledByWorker + __targetSizeApplied guard', () => {
  it('true for worker paths with maxSizeMB > 0', () => {
    expect(
      ImageCompression['targetSizeHandledByWorker']('webcodecs-worker', { maxSizeMB: 0.5 } as CompressionOptions),
    ).toBe(true);
    expect(
      ImageCompression['targetSizeHandledByWorker']('offscreen-worker', { maxSizeMB: 0.5 } as CompressionOptions),
    ).toBe(true);
  });

  it('false for canvas-main / server-fallback (must keep main-thread fallback)', () => {
    expect(
      ImageCompression['targetSizeHandledByWorker']('canvas-main', { maxSizeMB: 0.5 } as CompressionOptions),
    ).toBe(false);
    expect(
      ImageCompression['targetSizeHandledByWorker']('server-fallback', { maxSizeMB: 0.5 } as CompressionOptions),
    ).toBe(false);
  });

  it('false when maxSizeMB is not set', () => {
    expect(
      ImageCompression['targetSizeHandledByWorker']('webcodecs-worker', {} as CompressionOptions),
    ).toBe(false);
  });

  it('reachTargetSize is a no-op when __targetSizeApplied is already true', async () => {
    const svc = new ImageCompression();
    svc.dispose();
    const resultPath = 'offscreen-worker' as CompressionPath;
    const result = {
      ...baseResult(makeJpegBlob(400, 400)),
      path: resultPath,
      compressedSize: 500 * 1024, // > target, would normally trigger the ladder
    };
    // __targetSizeApplied=true → must return result unchanged (worker did it).
    const out = await ImageCompression.reachTargetSize(result, {
      maxSizeMB: 0.1,
      __targetSizeApplied: true,
    } as CompressionOptions);
    expect(out).toBe(result);
  });

  it('reachTargetSize still runs the ladder when NOT worker-applied', async () => {
    const svc = new ImageCompression();
    svc.dispose();
    const big = makeJpegBlob(64, 64);
    const result = { ...baseResult(big, 64, 64), compressedSize: 300 * 1024 };
    // No __targetSizeApplied → main-thread ladder runs as the fallback.
    const out = await ImageCompression.reachTargetSize(result, { maxSizeMB: 0.05 } as CompressionOptions);
    expect(out).not.toBe(result); // produced a new re-encoded result
    expect(out.compressedSize).toBeLessThanOrEqual(0.05 * 1024 * 1024);
  });
});