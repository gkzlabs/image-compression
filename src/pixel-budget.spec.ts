/**
 * v1.5.0 — `maxPixels` decompression-bomb guard.
 *
 * A 4 KB PNG can declare 100 000 × 100 000 pixels; decoding it allocates tens of
 * GB. With `maxPixels` set, `compress()` must reject such a file from its header
 * alone — no decode, no worker, no canvas — and it must NOT silently fall back
 * (forwarding a bomb to the server would defeat the budget).
 */
import { describe, expect, it } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import { ImageCompression } from './service';
import { CompressionError } from './types';

/** Real PNG of `width`×`height` (encoder-backed, decodable). */
function png(width: number, height: number): Uint8Array<ArrayBuffer> {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#204080';
  ctx.fillRect(0, 0, width, height);
  const buf = canvas.toBuffer('image/png');
  // Copy into a plain ArrayBuffer so the view type is BlobPart-compatible.
  return new Uint8Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
}

/** Real PNG whose IHDR is edited to declare `declared`×`declared` pixels. */
function bombPng(declared: number): File {
  const bytes = png(16, 16);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  view.setUint32(16, declared);
  view.setUint32(20, declared);
  return new File([bytes], 'bomb.png', { type: 'image/png' });
}

describe('v1.5.0 maxPixels guard', () => {
  it('throws FILE_TOO_LARGE for a tiny file that declares 100000×100000 pixels', async () => {
    const svc = new ImageCompression();
    try {
      const file = bombPng(100_000);
      expect(file.size).toBeLessThan(2048); // the whole point: tiny file, huge claim

      const start = Date.now();
      await expect(svc.compress(file, { maxPixels: 40_000_000 })).rejects.toThrow(CompressionError);
      expect(Date.now() - start).toBeLessThan(2000); // rejected from the header, no decode

      await svc
        .compress(file, { maxPixels: 40_000_000 })
        .then(() => expect.unreachable('should have rejected'))
        .catch((err: CompressionError) => {
          expect(err.code).toBe('FILE_TOO_LARGE');
          expect(err.message).toContain('100000×100000');
          expect(err.message).toContain('40000000');
        });
    } finally {
      svc.dispose();
    }
  });

  it('allows an image inside the budget and compresses normally', async () => {
    const svc = new ImageCompression();
    try {
      const file = new File([png(200, 100)], 'ok.png', { type: 'image/png' });
      const result = await svc.compress(file, { maxPixels: 40_000_000, forcePath: 'canvas-main' });
      expect(result.width).toBeGreaterThan(0);
      expect(result.compressedSize).toBeGreaterThan(0);
    } finally {
      svc.dispose();
    }
  });

  it('rejects exactly at the boundary (budget is inclusive)', async () => {
    const svc = new ImageCompression();
    try {
      const file = new File([png(100, 50)], 'edge.png', { type: 'image/png' }); // 5000 px
      await expect(
        svc.compress(file, { maxPixels: 4999, forcePath: 'canvas-main' }),
      ).rejects.toThrow(/over the maxPixels budget of 4999/);
      const ok = await svc.compress(file, { maxPixels: 5000, forcePath: 'canvas-main' });
      expect(ok.compressedSize).toBeGreaterThan(0);
    } finally {
      svc.dispose();
    }
  });

  it('does not apply the guard when maxPixels is not set (defaults unchanged)', async () => {
    const svc = new ImageCompression();
    try {
      const file = bombPng(100_000); // the guard would reject this exact file
      // Matching type + passThroughUnderBytes returns the file untouched, without
      // any decode — reaching `passthrough` proves nothing rejected it earlier.
      const result = await svc.compress(file, {
        format: 'image/png',
        passThroughUnderBytes: 1_000_000,
      });
      expect(result.path).toBe('passthrough');
    } finally {
      svc.dispose();
    }
  });
});
