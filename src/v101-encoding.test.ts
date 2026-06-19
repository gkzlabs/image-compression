/**
 * Tests for the v0.10.1 fix: Chrome 149 "image source is detached" error.
 *
 * Root cause: `encodeViaOffscreenCanvas()` was returning the blob and
 * letting the caller close the bitmap. Chrome 149's GPU readback in
 * `convertToBlob` can asynchronously detach the source bitmap, racing
 * with the close call.
 *
 * Fix: the helper itself now owns the close lifecycle, wrapped in
 * `try { drawImage; convertToBlob } finally { bitmap.close() }`.
 *
 * These tests verify:
 *   1. The returned blob is non-empty and has the correct type.
 *   2. The source bitmap is closed (or safe to use) after encode returns.
 *   3. Errors during encode still close the bitmap (no resource leak).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { encodeViaOffscreenCanvas } from './worker-helpers';

function makeBitmap(w = 32, h = 32): ImageBitmap {
  // jsdom doesn't ship createImageBitmap, so we stub the minimal surface
  // the helper needs: width/height, close(), and a usable drawImage target.
  return {
    width: w,
    height: h,
    close: vi.fn(),
  } as unknown as ImageBitmap;
}

describe('encodeViaOffscreenCanvas (v0.10.1 fix)', () => {
  beforeEach(() => {
    // Stub OffscreenCanvas since jsdom doesn't ship it
    (globalThis as any).OffscreenCanvas = class {
      width: number;
      height: number;
      private ctx: any;
      constructor(w: number, h: number) {
        this.width = w;
        this.height = h;
        this.ctx = {
          drawImage: vi.fn(),
        };
      }
      getContext() {
        return this.ctx;
      }
      convertToBlob({ type }: { type: string; quality?: number }): Promise<Blob> {
        const blob = new Blob([new Uint8Array(8)], { type });
        return Promise.resolve(blob);
      }
    };
  });

  it('returns a Blob with the requested MIME type', async () => {
    const bitmap = makeBitmap();
    const blob = await encodeViaOffscreenCanvas(bitmap, 'image/jpeg', 0.8);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('image/jpeg');
  });

  it('closes the source bitmap after encode completes', async () => {
    const bitmap = makeBitmap();
    const close = vi.spyOn(bitmap, 'close');
    await encodeViaOffscreenCanvas(bitmap, 'image/webp', 0.9);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('still closes the bitmap if convertToBlob throws (no leak)', async () => {
    (globalThis as any).OffscreenCanvas = class {
      width = 0;
      height = 0;
      getContext() {
        return { drawImage: vi.fn() };
      }
      convertToBlob(): Promise<Blob> {
        return Promise.reject(new Error('simulated GPU readback failure'));
      }
    };
    const bitmap = makeBitmap();
    const close = vi.spyOn(bitmap, 'close');
    await expect(
      encodeViaOffscreenCanvas(bitmap, 'image/jpeg', 0.8),
    ).rejects.toThrow('simulated GPU readback failure');
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('respects quality and format options', async () => {
    const bitmap = makeBitmap(64, 48);
    const blob = await encodeViaOffscreenCanvas(bitmap, 'image/png', 0.5);
    expect(blob.type).toBe('image/png');
    expect(blob.size).toBeGreaterThan(0);
  });
});
