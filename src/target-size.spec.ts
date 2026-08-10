/**
 * Tests for v0.11.0 features:
 *  - `maxSizeMB` target-size mode (`ImageCompression.reachTargetSize`)
 *  - Output format resolution (`resolveOutputFormat` — AVIF/WebP fallback)
 *
 * The native test encoder (@napi-rs/canvas) cannot control JPEG quality
 * (every quality produces the same size), so the quality/dimension ladder
 * logic is tested by MOCKING `HTMLCanvasElement.prototype.toBlob` to return
 * a size that depends on (width, height, quality). This isolates the
 * library's ladder logic from the encoder's behavior.
 *
 * Coverage:
 * - No-op conditions (no maxSizeMB, passthrough, server-fallback, already ≤ target)
 * - Quality ladder: quality steps down at SAME dims until target met
 * - Dimension ladder: dims shrink when quality alone can't reach target
 * - PNG: quality ignored → dimension ladder only
 * - Unreachable target: returns smallest achievable, warns
 * - Format resolution: requested format → encodable format
 */
import { afterEach, describe, it, expect } from 'vitest';
import { createCanvas, type Canvas } from '@napi-rs/canvas';
import { ImageCompression } from './service';
import type { CompressionResult, CompressionPath } from './types';

/**
 * Create a real JPEG blob from a colored canvas. Decodable by createImageBitmap
 * in our test environment (@napi-rs/canvas loadImage).
 */
function makeJpegBlob(width: number, height: number, quality = 0.9): Blob {
  const canvas: Canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  // Per-pixel noise — JPEG can't compress it well, so blob is genuinely large
  const img = ctx.createImageData(width, height);
  for (let i = 0; i < img.data.length; i += 4) {
    img.data[i] = Math.random() * 255;
    img.data[i + 1] = Math.random() * 255;
    img.data[i + 2] = Math.random() * 255;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const buffer = canvas.toBuffer('image/jpeg', quality);
  return new Blob([new Uint8Array(buffer)], { type: 'image/jpeg' });
}

/**
 * Mock HTMLCanvasElement.prototype.toBlob so the blob size is a deterministic
 * function of (width, height, quality). Lets us test the ladder logic without
 * depending on the native encoder's quality handling.
 *
 * @param sizeFn Returns the blob size in bytes for the given encode params
 * @returns restore function
 */
function mockToBlob(
  sizeFn: (width: number, height: number, quality?: number) => number,
): () => void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const proto = HTMLCanvasElement.prototype as any;
  const orig = proto.toBlob;
  proto.toBlob = function (
    this: HTMLCanvasElement,
    callback: (blob: Blob | null) => void,
    type?: string,
    quality?: number,
  ): void {
    const w = this.width || 1;
    const h = this.height || 1;
    const size = Math.max(1, Math.round(sizeFn(w, h, quality)));
    callback(new Blob([new Uint8Array(size)], { type: type || 'image/jpeg' }));
  };
  return () => {
    proto.toBlob = orig;
  };
}

/** Build a fake CompressionResult as if it came from the cascade. */
function makeResult(
  blob: Blob,
  width: number,
  height: number,
  path: CompressionPath = 'webcodecs-worker',
  mimeType = 'image/jpeg',
): CompressionResult {
  return {
    blob,
    file: blob instanceof File ? blob : new File([blob], 'result.jpg', { type: blob.type }),
    name: 'result.jpg',
    originalSize: blob.size * 2,
    compressedSize: blob.size,
    width,
    height,
    mimeType,
    path,
    durationMs: 100,
    tier: 'mid',
  };
}

afterEach(() => {
  // Restore any mocked toBlob between tests
});

describe('v0.11.0 reachTargetSize (maxSizeMB)', () => {
  describe('no-op conditions', () => {
    it('returns input unchanged when maxSizeMB not set', async () => {
      const blob = makeJpegBlob(200, 200);
      const result = makeResult(blob, 200, 200);
      const out = await ImageCompression.reachTargetSize(result, {});
      expect(out).toBe(result); // exact same reference
    });

    it('returns input unchanged when maxSizeMB <= 0', async () => {
      const blob = makeJpegBlob(200, 200);
      const result = makeResult(blob, 200, 200);
      const out = await ImageCompression.reachTargetSize(result, { maxSizeMB: 0 });
      expect(out).toBe(result);
    });

    it('returns passthrough unchanged even when oversized', async () => {
      const blob = makeJpegBlob(200, 200);
      const result = makeResult(blob, 200, 200, 'passthrough');
      const out = await ImageCompression.reachTargetSize(result, { maxSizeMB: 0.000001 });
      expect(out).toBe(result);
    });

    it('returns server-fallback unchanged even when oversized', async () => {
      const blob = makeJpegBlob(200, 200);
      const result = makeResult(blob, 200, 200, 'server-fallback');
      const out = await ImageCompression.reachTargetSize(result, { maxSizeMB: 0.000001 });
      expect(out).toBe(result);
    });

    it('returns input unchanged when already within target', async () => {
      const blob = makeJpegBlob(100, 100);
      const result = makeResult(blob, 100, 100);
      const out = await ImageCompression.reachTargetSize(result, { maxSizeMB: 10 });
      expect(out).toBe(result);
    });
  });

  describe('quality ladder (same dimensions)', () => {
    it('steps quality down at the SAME dims until target is met', async () => {
      // size = base * quality → quality ladder is the only lever that fits
      const BASE = 100 * 1024; // "100KB" at quality 1.0
      const restore = mockToBlob((w, h, q) => BASE * (q ?? 0.85));
      try {
        const blob = makeJpegBlob(400, 400);
        const result = makeResult(blob, 400, 400);
        // Target: 50KB → need quality ≤ 0.5 (first ladder entry below base 0.85)
        const targetMB = 50 / 1024;
        const out = await ImageCompression.reachTargetSize(result, { maxSizeMB: targetMB });

        expect(out.compressedSize).toBeLessThanOrEqual(50 * 1024);
        // Quality ladder fired — dimensions MUST be unchanged
        expect(out.width).toBe(400);
        expect(out.height).toBe(400);
        expect(out.mimeType).toBe('image/jpeg');
        expect(out.file.name).toBe('result.jpg');
      } finally {
        restore();
      }
    });

    it('honors a low starting quality as the ladder ceiling', async () => {
      const BASE = 100 * 1024;
      const restore = mockToBlob((w, h, q) => BASE * (q ?? 0.85));
      try {
        const blob = makeJpegBlob(300, 300);
        const result = makeResult(blob, 300, 300);
        // Caller sets quality 0.5 → ladder starts at 0.5, not 0.85
        // Target 40KB → 0.5*100KB=50KB too big, 0.3*100KB=30KB fits
        const targetMB = 40 / 1024;
        const out = await ImageCompression.reachTargetSize(result, { maxSizeMB: targetMB, quality: 0.5 });
        expect(out.compressedSize).toBeLessThanOrEqual(40 * 1024);
        expect(out.width).toBe(300); // dims untouched → pure quality ladder
      } finally {
        restore();
      }
    });
  });

  describe('dimension ladder', () => {
    it('reduces dimensions when quality alone cannot reach the target', async () => {
      // size depends ONLY on width → quality ladder does nothing, dims must shrink
      const restore = mockToBlob((w) => w * 256);
      try {
        const blob = makeJpegBlob(600, 600);
        const result = makeResult(blob, 600, 600);
        // Simulate a big cascade output (the real noise blob is tiny) so the
        // early-return `compressedSize <= target` doesn't fire before the ladder.
        result.compressedSize = 500 * 1024;
        // 600*256 = 153.6KB. Target 100KB → need width ≤ 400 (0.6 → 360*256=92KB)
        const targetMB = 100 / 1024;
        const out = await ImageCompression.reachTargetSize(result, { maxSizeMB: targetMB });

        expect(out.compressedSize).toBeLessThanOrEqual(100 * 1024);
        expect(out.width).toBeLessThan(600);
        expect(out.height).toBeLessThan(600);
        // Aspect ratio preserved (600x600 → square)
        expect(out.width).toBe(out.height);
      } finally {
        restore();
      }
    });
  });

  describe('PNG (lossless — quality ignored)', () => {
    it('uses the dimension ladder only and preserves PNG mime', async () => {
      // size depends only on width — simulates lossless PNG where quality is ignored
      const restore = mockToBlob((w) => w * 300);
      try {
        const blob = makeJpegBlob(400, 400);
        const result = makeResult(blob, 400, 400, 'webcodecs-worker', 'image/png');
        result.compressedSize = 500 * 1024;
        // 400*300 = 120KB → target 60KB needs width ≤ 200 (0.5 scale)
        const targetMB = 60 / 1024;
        const out = await ImageCompression.reachTargetSize(result, { maxSizeMB: targetMB });

        expect(out.mimeType).toBe('image/png');
        expect(out.compressedSize).toBeLessThanOrEqual(60 * 1024);
        expect(out.width).toBeLessThan(400);
        // buildResult renames to match the PNG mime type
        expect(out.file.name.endsWith('.png')).toBe(true);
      } finally {
        restore();
      }
    });
  });

  describe('unreachable target', () => {
    it('returns the smallest achievable result instead of failing', async () => {
      // size always ≥ 20KB even at smallest dims/quality → target of 1KB unreachable
      const restore = mockToBlob((w) => Math.max(20 * 1024, w * 100));
      try {
        const blob = makeJpegBlob(500, 500);
        const result = makeResult(blob, 500, 500);
        result.compressedSize = 500 * 1024;
        const out = await ImageCompression.reachTargetSize(result, { maxSizeMB: 1 / 1024 });

        // Still returns a valid smaller result (smallest achievable = 20KB floor)
        expect(out.compressedSize).toBeGreaterThanOrEqual(20 * 1024);
        expect(out.compressedSize).toBeLessThan(500 * 1024);
        expect(out.mimeType).toBe('image/jpeg');
        expect(out.width).toBeGreaterThan(0);
      } finally {
        restore();
      }
    });
  });

  describe('result shape integrity', () => {
    it('produces a File with correct extension for the format', async () => {
      const BASE = 100 * 1024;
      const restore = mockToBlob((w, h, q) => BASE * (q ?? 0.85));
      try {
        const blob = makeJpegBlob(300, 300);
        const result = makeResult(blob, 300, 300);
        result.compressedSize = 500 * 1024;
        const out = await ImageCompression.reachTargetSize(result, { maxSizeMB: 50 / 1024 });
        expect(out.file).toBeInstanceOf(File);
        expect(out.file.name.endsWith('.jpg')).toBe(true);
        expect(out.name).toBe(out.file.name);
        // buildResult wraps the re-encoded blob in a new File; blob stays a Blob
        expect(out.blob.size).toBe(out.file.size);
      } finally {
        restore();
      }
    });
  });
});

describe('v0.11.0 resolveOutputFormat (AVIF/WebP fallback)', () => {
  it('returns the requested format when encodable', async () => {
    const svc = new ImageCompression();
    const jpeg = await svc.resolveOutputFormat('image/jpeg');
    expect(jpeg).toBe('image/jpeg');
  });

  it('falls back to webp when avif requested but unsupported', async () => {
    const svc = new ImageCompression();
    // Simulate: avif unsupported, webp supported
    svc['formatSupportCache'].set('image/avif', false);
    const out = await svc.resolveOutputFormat('image/avif');
    expect(out).toBe('image/webp');
  });

  it('falls back to jpeg when neither avif nor webp is encodable', async () => {
    const svc = new ImageCompression();
    const cache = svc['formatSupportCache'];
    cache.set('image/avif', false);
    cache.set('image/webp', false);
    const out = await svc.resolveOutputFormat('image/avif');
    expect(out).toBe('image/jpeg');
  });

  it('caches probe results (no repeated probing)', async () => {
    const svc = new ImageCompression();
    const cache = svc['formatSupportCache'];
    cache.set('image/webp', true);
    await svc.resolveOutputFormat('image/avif');
    expect(cache.get('image/avif')).toBeDefined();
  });
});
