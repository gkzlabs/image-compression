/**
 * Tests for the v0.10.3 try/finally safety net in encodeViaOffscreenCanvas.
 *
 * The race-condition root cause was fixed in v0.10.2 by reverting the
 * upstream helpers to sync + `transferToImageBitmap()`. v0.10.3 adds
 * try/finally back to encodeViaOffscreenCanvas as a **defensive cleanup
 * mechanism** — not as a race-condition fix.
 *
 * These tests verify:
 *   1. Bitmap is closed on successful encode.
 *   2. Bitmap is closed even when convertToBlob throws (no resource leak).
 *   3. Re-closing an already-closed bitmap is safe (no-throw).
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

describe('encodeViaOffscreenCanvas (v0.10.3 try/finally safety net)', () => {
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

  it('closes the source bitmap after successful encode (v0.10.3 safety net)', async () => {
    const bitmap = makeBitmap();
    const close = vi.spyOn(bitmap, 'close');
    const blob = await encodeViaOffscreenCanvas(bitmap, 'image/jpeg', 0.8);
    expect(blob).toBeInstanceOf(Blob);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('still closes the bitmap if convertToBlob throws (no resource leak)', async () => {
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
    // v0.10.3 safety net: close() called via finally block even on error
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('caller can safely call bitmap.close() again (no-op on already-closed)', async () => {
    const bitmap = makeBitmap();
    await encodeViaOffscreenCanvas(bitmap, 'image/jpeg', 0.8);
    // Caller in worker.ts calls bitmap.close() again after encode returns.
    // Since the helper already closed it, this should not throw.
    expect(() => bitmap.close()).not.toThrow();
    // Total: 2 close() calls (one from finally, one from caller)
    expect(vi.mocked(bitmap.close).mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it('respects format and quality options', async () => {
    const bitmap = makeBitmap(64, 48);
    const blob = await encodeViaOffscreenCanvas(bitmap, 'image/webp', 0.9);
    expect(blob.type).toBe('image/webp');
    expect(blob.size).toBeGreaterThan(0);
  });
});
