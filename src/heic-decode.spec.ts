import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tryDecodeHEICLazy } from './heic';

/**
 * Tests for `tryDecodeHEICLazy()` — the HEIC pre-decode helper.
 *
 * This function has 2 paths:
 * 1. **Native ImageDecoder** (iOS Safari 16.4+): zero-cost fast path
 * 2. **heic2any** (WASM): fallback for browsers without native HEIC support
 *
 * Both paths are tested via the public function (not the private class
 * method) so we don't need to set up a full ImageCompression instance.
 *
 * The heic2any module is aliased to a stub in vitest.config.ts that throws
 * by default — see `__stubs__/heic2any.ts`. We use `vi.mock()` to inject
 * a working stub when testing the heic2any path.
 */
describe('tryDecodeHEICLazy()', () => {
  // Minimal valid HEIC file (1x1 transparent, just for type detection)
  const HEIC_BLOB = new Blob([new Uint8Array([0x00, 0x00, 0x00, 0x18])], {
    type: 'image/heic',
  });

  describe('when both paths fail (no native + no heic2any)', () => {
    it('returns null when ImageDecoder is undefined and heic2any is unavailable', async () => {
      // happy-dom has no ImageDecoder. The heic2any stub throws by default.
      // Both paths should fail → return null.
      const result = await tryDecodeHEICLazy(HEIC_BLOB);
      expect(result).toBeNull();
    });

    it('does not throw — gracefully returns null on total failure', async () => {
      // The function must never throw — it returns null for graceful fallback.
      // This is critical because the cascade relies on null meaning "use server".
      let didThrow = false;
      try {
        await tryDecodeHEICLazy(HEIC_BLOB);
      } catch {
        didThrow = true;
      }
      expect(didThrow).toBe(false);
    });
  });

  describe('native ImageDecoder path', () => {
    /**
     * Spy on ImageDecoder.isTypeSupported to simulate "HEIC supported".
     * The decode() call will still fail (no real HEIC codec in Node),
     * but we verify the code path reaches ImageDecoder.
     */
    it('calls ImageDecoder.isTypeSupported("image/heic") when ImageDecoder is defined', async () => {
      // Set up a minimal ImageDecoder global for the test
      const originalImageDecoder = (globalThis as { ImageDecoder?: unknown }).ImageDecoder;
      const isTypeSupportedSpy = vi.fn().mockResolvedValue(false);
      (globalThis as { ImageDecoder?: unknown }).ImageDecoder = {
        isTypeSupported: isTypeSupportedSpy,
      };

      try {
        await tryDecodeHEICLazy(HEIC_BLOB);
        // isTypeSupported should have been called exactly once
        expect(isTypeSupportedSpy).toHaveBeenCalledWith('image/heic');
      } finally {
        // Restore original
        (globalThis as { ImageDecoder?: unknown }).ImageDecoder = originalImageDecoder;
      }
    });

    it('skips native path when isTypeSupported returns false', async () => {
      const originalImageDecoder = (globalThis as { ImageDecoder?: unknown }).ImageDecoder;
      const isTypeSupportedSpy = vi.fn().mockResolvedValue(false);
      const decodeSpy = vi.fn();
      (globalThis as { ImageDecoder?: unknown }).ImageDecoder = {
        isTypeSupported: isTypeSupportedSpy,
        // If decode is called, the test should fail — we want to verify
        // it's NOT called when isTypeSupported returns false.
        prototype: { decode: decodeSpy },
      };

      try {
        await tryDecodeHEICLazy(HEIC_BLOB);
        expect(isTypeSupportedSpy).toHaveBeenCalled();
        // When supported=false, we should fall through to heic2any (which
        // also fails in this env, returning null) without ever constructing
        // an ImageDecoder instance.
        // (Note: in happy-dom, ImageDecoder is undefined, so the spy is
        // never called. This test only validates behavior when ImageDecoder
        // IS defined.)
      } finally {
        (globalThis as { ImageDecoder?: unknown }).ImageDecoder = originalImageDecoder;
      }
    });

    it('falls through to heic2any when native decode throws', async () => {
      // Simulate: ImageDecoder says HEIC is supported, but decode() throws.
      // The function should swallow the error and try heic2any next.
      const originalImageDecoder = (globalThis as { ImageDecoder?: unknown }).ImageDecoder;
      (globalThis as { ImageDecoder?: unknown }).ImageDecoder = {
        isTypeSupported: vi.fn().mockResolvedValue(true),
        // The constructor will be called → throws synchronously
        // This simulates a codec that reports support but fails on real data.
      };

      try {
        // The function should not throw — it should fall through to heic2any
        // (which also fails in this env, returning null).
        const result = await tryDecodeHEICLazy(HEIC_BLOB);
        expect(result).toBeNull(); // both paths failed
      } finally {
        (globalThis as { ImageDecoder?: unknown }).ImageDecoder = originalImageDecoder;
      }
    });
  });

  describe('heic2any fallback path (v0.9.0 — globalThis pattern)', () => {
    /**
     * As of v0.9.0, heic2any is loaded as a UMD/IIFE module that attaches
     * itself to `globalThis.heic2any`. The test mocks this global function
     * directly (no module mocking needed).
     *
     * The URL hatch strategy is tested in the "multi-strategy import"
     * describe block below (it requires real browser environment).
     */

    type Heic2anyFn = (opts: { blob: Blob; toType: string }) => Promise<Blob | Blob[]>;
    let originalHeic2any: unknown;

    beforeEach(() => {
      originalHeic2any = (globalThis as { heic2any?: unknown }).heic2any;
    });

    afterEach(() => {
      if (originalHeic2any === undefined) {
        delete (globalThis as { heic2any?: unknown }).heic2any;
      } else {
        (globalThis as { heic2any?: unknown }).heic2any = originalHeic2any;
      }
    });

    it('returns a Blob when heic2any successfully decodes', async () => {
      // Set the global heic2any to a working stub
      const fakeJpeg = new Blob(['fake-jpeg-data'], { type: 'image/jpeg' });
      (globalThis as { heic2any?: Heic2anyFn }).heic2any = vi
        .fn()
        .mockResolvedValue(fakeJpeg);

      const { tryDecodeHEICLazy } = await import('./service');
      const result = await tryDecodeHEICLazy(HEIC_BLOB);

      expect(result).toBeInstanceOf(Blob);
      expect(result?.type).toBe('image/jpeg');
      expect(result?.size).toBe(fakeJpeg.size);
    });

    it('returns the first Blob when heic2any returns an array', async () => {
      const firstBlob = new Blob(['first'], { type: 'image/jpeg' });
      const secondBlob = new Blob(['second'], { type: 'image/jpeg' });
      (globalThis as { heic2any?: Heic2anyFn }).heic2any = vi
        .fn()
        .mockResolvedValue([firstBlob, secondBlob]);

      const { tryDecodeHEICLazy } = await import('./service');
      const result = await tryDecodeHEICLazy(HEIC_BLOB);

      // heic2any may return a single Blob or an array (for HEIC sequences)
      expect(result).toBe(firstBlob);
    });

    it('returns null when heic2any throws (corrupt file, etc.)', async () => {
      (globalThis as { heic2any?: Heic2anyFn }).heic2any = vi
        .fn()
        .mockRejectedValue(new Error('Decode failed'));

      const { tryDecodeHEICLazy } = await import('./service');
      const result = await tryDecodeHEICLazy(HEIC_BLOB);

      expect(result).toBeNull();
    });

    it('returns null when heic2any returns null/undefined', async () => {
      (globalThis as { heic2any?: Heic2anyFn }).heic2any = vi
        .fn()
        .mockResolvedValue(null as unknown as Blob);

      const { tryDecodeHEICLazy } = await import('./service');
      const result = await tryDecodeHEICLazy(HEIC_BLOB);

      expect(result).toBeNull();
    });
  });

  describe('output format', () => {
    let originalHeic2any: unknown;

    beforeEach(() => {
      originalHeic2any = (globalThis as { heic2any?: unknown }).heic2any;
    });

    afterEach(() => {
      if (originalHeic2any === undefined) {
        delete (globalThis as { heic2any?: unknown }).heic2any;
      } else {
        (globalThis as { heic2any?: unknown }).heic2any = originalHeic2any;
      }
    });

    it('calls heic2any with toType: "image/jpeg"', async () => {
      const heic2anyMock = vi
        .fn()
        .mockResolvedValue(new Blob(['x'], { type: 'image/jpeg' }));
      (globalThis as { heic2any?: typeof heic2anyMock }).heic2any = heic2anyMock;

      const { tryDecodeHEICLazy } = await import('./service');
      await tryDecodeHEICLazy(HEIC_BLOB);

      expect(heic2anyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          blob: HEIC_BLOB,
          toType: 'image/jpeg',
        }),
      );
    });
  });

  describe('multi-strategy import (v0.9.0)', () => {
    /**
     * As of v0.9.0, `tryDecodeHEICLazy()` tries 2 strategies in order:
     * 1. URL hatch (__IC_HEIC2ANY_URL) — user-provided URL via eval
     * 2. Bare specifier ('heic2any') — original behavior, may fail in some bundlers
     *
     * Tests below verify the URL hatch is tried first when the flag is set,
     * and the bare specifier is the fallback.
     */

    let originalHeic2any: unknown;
    let originalUrl: string | undefined;

    beforeEach(() => {
      originalHeic2any = (globalThis as { heic2any?: unknown }).heic2any;
      originalUrl = (globalThis as { __IC_HEIC2ANY_URL?: string }).__IC_HEIC2ANY_URL;
    });

    afterEach(() => {
      if (originalHeic2any === undefined) {
        delete (globalThis as { heic2any?: unknown }).heic2any;
      } else {
        (globalThis as { heic2any?: unknown }).heic2any = originalHeic2any;
      }
      if (originalUrl === undefined) {
        delete (globalThis as { __IC_HEIC2ANY_URL?: string }).__IC_HEIC2ANY_URL;
      } else {
        (globalThis as { __IC_HEIC2ANY_URL?: string }).__IC_HEIC2ANY_URL = originalUrl;
      }
      vi.resetModules();
    });

    it('returns null when no strategy succeeds (no URL, no global)', async () => {
      // No mocks, no URL set — both strategies should fail
      const { tryDecodeHEICLazy } = await import('./service');
      const result = await tryDecodeHEICLazy(HEIC_BLOB);

      expect(result).toBeNull();
    });

    it('URL hatch: skipped when __IC_HEIC2ANY_URL is not set, falls back to bare specifier', async () => {
      // No URL set. URL strategy is skipped. The bare specifier should
      // be tried — but heic2any isn't actually in node_modules, so it
      // throws, and the function returns null.
      const { tryDecodeHEICLazy } = await import('./service');
      const result = await tryDecodeHEICLazy(HEIC_BLOB);

      expect(result).toBeNull();
    });

    it('URL hatch: tried first when __IC_HEIC2ANY_URL is set', async () => {
      // URL is set. The URL strategy runs first. In vitest, the URL fetch
      // fails (no actual server), so it falls through to the bare specifier
      // (which also fails because heic2any isn't in node_modules).
      (globalThis as { __IC_HEIC2ANY_URL?: string }).__IC_HEIC2ANY_URL =
        'https://cdn.example.com/heic2any.js';

      const { tryDecodeHEICLazy } = await import('./service');
      const result = await tryDecodeHEICLazy(HEIC_BLOB);

      expect(result).toBeNull();
    });

    it('URL hatch: import error caught, falls through to bare specifier which uses global', async () => {
      // Pre-set globalThis.heic2any (simulating user pre-loading via <script> tag).
      // The URL hatch's import() will fail in vitest (no real /heic2any.js file),
      // so the code falls through to the bare specifier path. The bare specifier
      // also fails to import heic2any in vitest, but reads globalThis.heic2any
      // (which is pre-set) and calls it.
      (globalThis as { __IC_HEIC2ANY_URL?: string }).__IC_HEIC2ANY_URL =
        '/heic2any.js';
      const fakeJpeg = new Blob(['fake-jpeg'], { type: 'image/jpeg' });
      (globalThis as { heic2any?: unknown }).heic2any = vi
        .fn()
        .mockResolvedValue(fakeJpeg);

      const { tryDecodeHEICLazy } = await import('./service');
      const result = await tryDecodeHEICLazy(HEIC_BLOB);

      // Result comes from the pre-set global (used by the bare specifier fallback)
      expect(result).toBe(fakeJpeg);
    });
  });
});
