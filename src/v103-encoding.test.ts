/**
 * Tests for encodeViaOffscreenCanvas — the encode step used by the
 * webcodecs-worker and offscreen-worker paths.
 *
 * v0.10.5 REGRESSION: the helper must NOT call bitmap.close() internally.
 * The v0.10.3 try/finally "safety net" was THE BUG — `finally` runs during
 * `await` suspension, so closing the bitmap before convertToBlob's GPU
 * readback completes triggered Chrome 149's "image source is detached"
 * error.
 *
 * The caller (worker.ts compress()) owns the bitmap lifetime and closes
 * it AFTER encode returns. This file pins that contract:
 *   1. encode returns a Blob and does NOT call bitmap.close()
 *   2. Errors from convertToBlob propagate (caller decides cleanup)
 *   3. Format/quality pass-through works
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { encodeViaOffscreenCanvas } from './worker-helpers';

function makeBitmap(w = 32, h = 32): ImageBitmap {
  return {
    width: w,
    height: h,
    close: vi.fn(),
  } as unknown as ImageBitmap;
}

describe('encodeViaOffscreenCanvas (v0.10.5 — caller owns bitmap lifetime)', () => {
  beforeEach(() => {
    (globalThis as any).OffscreenCanvas = class {
      width: number;
      height: number;
      private ctx: any;
      constructor(w: number, h: number) {
        this.width = w;
        this.height = h;
        this.ctx = { drawImage: vi.fn() };
      }
      getContext() {
        return this.ctx;
      }
      convertToBlob({ type }: { type: string; quality?: number }): Promise<Blob> {
        return Promise.resolve(new Blob([new Uint8Array(8)], { type }));
      }
    };
  });

  it('returns a Blob and does NOT close the source bitmap (caller-owned lifetime)', async () => {
    const bitmap = makeBitmap();
    const close = vi.spyOn(bitmap, 'close');
    const blob = await encodeViaOffscreenCanvas(bitmap, 'image/jpeg', 0.8);
    expect(blob).toBeInstanceOf(Blob);
    // v0.10.5: encode must NOT close the bitmap. Closing during the
    // await convertToBlob suspension is what triggered the
    // "image source is detached" error in Chrome 149.
    expect(close).toHaveBeenCalledTimes(0);
  });

  it('propagates convertToBlob errors without closing the bitmap', async () => {
    (globalThis as any).OffscreenCanvas = class {
      width = 0;
      height = 0;
      getContext() {
        return { drawImage: vi.fn() };
      }
      convertToBlob(): Promise<Blob> {
        return Promise.reject(new Error('simulated GPU OOM'));
      }
    };
    const bitmap = makeBitmap();
    const close = vi.spyOn(bitmap, 'close');
    await expect(
      encodeViaOffscreenCanvas(bitmap, 'image/jpeg', 0.8),
    ).rejects.toThrow('simulated GPU OOM');
    // v0.10.5: encode does NOT touch bitmap.close() at all.
    // Caller is responsible for cleanup on error paths.
    expect(close).toHaveBeenCalledTimes(0);
  });

  it('respects format and quality options', async () => {
    const bitmap = makeBitmap(64, 48);
    const blob = await encodeViaOffscreenCanvas(bitmap, 'image/webp', 0.9);
    expect(blob.type).toBe('image/webp');
    expect(blob.size).toBeGreaterThan(0);
  });

  it('passes quality through to convertToBlob', async () => {
    const convertToBlob = vi.fn(({ type }: { type: string; quality?: number }) =>
      Promise.resolve(new Blob([new Uint8Array(8)], { type })),
    );
    (globalThis as any).OffscreenCanvas = class {
      width = 32;
      height = 32;
      getContext() {
        return { drawImage: vi.fn() };
      }
      convertToBlob(opts: { type: string; quality?: number }): Promise<Blob> {
        return convertToBlob(opts);
      }
    };
    const bitmap = makeBitmap();
    await encodeViaOffscreenCanvas(bitmap, 'image/jpeg', 0.42);
    expect(convertToBlob).toHaveBeenCalledWith({ type: 'image/jpeg', quality: 0.42 });
  });
});
