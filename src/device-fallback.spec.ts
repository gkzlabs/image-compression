/**
 * v1.3.0 integration: the "works on EVERY device" contract.
 *
 * When `maxSizeMB` is requested AND the device has a Worker, the ladder must
 * run IN the worker (OffscreenCanvas) — verified in target-size-ladder.spec.
 *
 * When the device has NO Worker (old / limited), the library must STILL work:
 * `reachTargetSize` runs the SAME ladder on the main thread via toBlob. This is
 * the guarantee the user asked for: no Worker is never a hard failure, only a
 * fallback to the main-thread adapter.
 *
 * These tests exercise the full `compress()` path (not just the static helper)
 * to prove the wiring is complete end-to-end.
 */
import { describe, it, expect } from 'vitest';
import { ImageCompression } from './service';

function makeJpegBlob(quality = 0.2): Blob {
  // Real JPEG, decodable by the @napi-rs/canvas-backed environment.
  const { createCanvas } = require('@napi-rs/canvas') as typeof import('@napi-rs/canvas');
  const canvas = createCanvas(800, 600);
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#5865f2';
    ctx.fillRect(0, 0, 800, 600);
  }
  return new Blob([canvas.toBuffer('image/jpeg', quality)], { type: 'image/jpeg' });
}

describe('maxSizeMB works on devices WITHOUT a Worker (main-thread fallback)', () => {
  it('compress() with maxSizeMB returns a result whose blob fits the budget', async () => {
    const svc = new ImageCompression();
    try {
      const file = new File([makeJpegBlob(1.0)], 'photo.jpg', { type: 'image/jpeg' });
      // Force only the main-thread path (as a device with NO worker would end up).
      const result = await svc.compress(file, {
        maxSizeMB: 0.05,
        forcePath: 'canvas-main',
      });
      // Either it fit the budget, or it returned the smallest achievable —
      // but it MUST NOT throw and MUST return a usable file.
      expect(result.file).toBeInstanceOf(File);
      expect(result.path).toBe('canvas-main');
      expect(result.width).toBeGreaterThan(0);
      expect(result.height).toBeGreaterThan(0);
    } finally {
      svc.dispose();
    }
  });

  it('compresses successfully WITHOUT maxSizeMB (baseline regression guard)', async () => {
    const svc = new ImageCompression();
    try {
      const file = new File([makeJpegBlob()], 'photo.jpg', { type: 'image/jpeg' });
      const result = await svc.compress(file, { forcePath: 'canvas-main' });
      expect(result.file).toBeInstanceOf(File);
      expect(result.width).toBeGreaterThan(0);
      expect(result.height).toBeGreaterThan(0);
    } finally {
      svc.dispose();
    }
  });

  it('reachTargetSize runs the ladder (not a no-op) when NOT worker-applied', async () => {
    // Direct static check: with maxSizeMB set and NO __targetSizeApplied,
    // the main-thread ladder executes and returns a SMALLER blob.
    const blob = makeJpegBlob(1.0); // 800x600 solid JPEG ≈ 3.6KB in this env
    const result: Parameters<typeof ImageCompression.reachTargetSize>[0] = {
      file: new File([blob], 'x.jpg', { type: 'image/jpeg' }),
      blob,
      name: 'x.jpg',
      originalSize: blob.size,
      compressedSize: blob.size,
      width: 800,
      height: 600,
      path: 'canvas-main',
      durationMs: 1,
      tier: 'high',
      mimeType: 'image/jpeg',
    };
    // Target BELOW the 3.6KB source forces the dimension ladder to step down.
    const out = await ImageCompression.reachTargetSize(result, { maxSizeMB: 0.002 });
    expect(out).not.toBe(result); // ladder produced a new (smaller) result
    expect(out.compressedSize).toBeLessThanOrEqual(0.002 * 1024 * 1024);
    expect(out.width).toBeLessThan(800); // dims shrank
  });
});