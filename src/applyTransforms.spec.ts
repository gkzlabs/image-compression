/**
 * Tests for the restored `applyTransforms` family (v0.10.8).
 *
 * Uses the same `@napi-rs/canvas` polyfill infrastructure as the other
 * unit tests — the polyfill is installed in `vitest.setup.ts`. We just
 * create a real `OffscreenCanvas` (which uses the polyfill under the hood)
 * and pass that as our "bitmap" since it satisfies the drawImage contract.
 *
 * Real browser E2E is still required to verify the worker.ts path
 * (the v0.10.7 detach root cause), but these tests cover the main-thread
 * helper logic, dimension math, and the fast-path optimizations.
 */
import { describe, it, expect } from 'vitest';
import { applyRotation, resizeExact, applyTransforms } from './worker-helpers';

/**
 * Helper: create a fresh "bitmap" — actually a small OffscreenCanvas
 * (polyfilled) with solid red pixels. The OffscreenCanvas type satisfies
 * the CanvasElement interface, so ctx.drawImage accepts it.
 */
function makeBitmap(w: number, h: number): ImageBitmap {
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(0, 0, w, h);
  }
  return c.transferToImageBitmap();
}

describe('applyTransforms helpers (v0.10.8 restoration)', () => {
  describe('applyRotation', () => {
    it('returns input unchanged when no rotation/mirror (fast path)', () => {
      const input = makeBitmap(100, 50);
      const out = applyRotation(input, 0, undefined);
      expect(out.bitmap).toBe(input);
      expect(out.width).toBe(100);
      expect(out.height).toBe(50);
    });

    it('90° swap produces new bitmap with swapped dimensions', () => {
      const input = makeBitmap(100, 50);
      const out = applyRotation(input, 90, undefined);
      expect(out.bitmap).not.toBe(input);
      expect(out.width).toBe(50);
      expect(out.height).toBe(100);
    });

    it('270° swap also swaps dimensions', () => {
      const input = makeBitmap(100, 50);
      const out = applyRotation(input, 270, undefined);
      expect(out.width).toBe(50);
      expect(out.height).toBe(100);
    });

    it('180° keeps dimensions', () => {
      const input = makeBitmap(100, 50);
      const out = applyRotation(input, 180, undefined);
      expect(out.width).toBe(100);
      expect(out.height).toBe(50);
    });
  });

  describe('resizeExact', () => {
    it('returns input unchanged when dimensions already match (fast path)', () => {
      const input = makeBitmap(200, 100);
      const out = resizeExact(input, 200, 100);
      expect(out.bitmap).toBe(input);
    });

    it('resizes to exact dimensions when differ', () => {
      const input = makeBitmap(400, 200);
      const out = resizeExact(input, 100, 50);
      expect(out.width).toBe(100);
      expect(out.height).toBe(50);
    });
  });

  describe('applyTransforms', () => {
    it('returns input unchanged when no opts provided (fast path)', () => {
      const input = makeBitmap(800, 600);
      const out = applyTransforms(input);
      expect(out.bitmap).toBe(input);
      expect(out.width).toBe(800);
      expect(out.height).toBe(600);
    });

    it('returns input unchanged when empty opts object (fast path)', () => {
      const input = makeBitmap(800, 600);
      const out = applyTransforms(input, {});
      expect(out.bitmap).toBe(input);
    });

    it('applies rotation only', () => {
      const input = makeBitmap(100, 50);
      const out = applyTransforms(input, { rotate: 90 });
      expect(out.width).toBe(50);
      expect(out.height).toBe(100);
    });

    it('applies rotation then exact resize (rotation + override)', () => {
      const input = makeBitmap(100, 50);
      const out = applyTransforms(input, { rotate: 90, width: 200, height: 200 });
      expect(out.width).toBe(200);
      expect(out.height).toBe(200);
    });

    it('applies mirror only', () => {
      const input = makeBitmap(100, 50);
      const out = applyTransforms(input, { mirror: 'horizontal' });
      expect(out.width).toBe(100);
      expect(out.height).toBe(50);
    });
  });
});
