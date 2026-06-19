import { ImageCompression } from './service';
import { CompressionError } from './types';
import type { CompressionProgress, DeviceCapabilities } from './types';

/**
 * Tests for ImageCompression — focus on control flow + error handling
 * (no actual image compression; that requires fixtures + Worker mocking).
 *
 * Coverage:
 * - forcePath validation (invalid path, server-fallback short-circuit)
 * - forceServer short-circuit
 * - AbortSignal handling (pre-aborted, mid-flight)
 * - onProgress callback fires
 * - CompressionError shape (code, path, tried, cause)
 */
describe('ImageCompression', () => {
  let svc: ImageCompression;

  beforeEach(() => {
    svc = new ImageCompression();
  });

  afterEach(() => {
    svc.dispose();
  });

  describe('forceServer', () => {
    it('returns the original file when forceServer is true (no compression)', async () => {
      const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'test.jpg', { type: 'image/jpeg' });
      const result = await svc.compress(file, { forceServer: true });
      expect(result.path).toBe('server-fallback');
      expect(result.blob).toBeInstanceOf(Blob);
      expect(result.blob.size).toBe(file.size);
      expect(result.originalSize).toBe(file.size);
    });
  });

  describe('forcePath', () => {
    it('throws CompressionError(ALL_PATHS_FAILED) for unknown forcePath', async () => {
      const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'test.jpg', { type: 'image/jpeg' });
      await expect(svc.compress(file, { forcePath: 'bogus' as never })).rejects.toThrow(CompressionError);
      try {
        await svc.compress(file, { forcePath: 'bogus' as never });
      } catch (err) {
        expect(err).toBeInstanceOf(CompressionError);
        expect((err as CompressionError).code).toBe('INVALID_OPTIONS');
      }
    });
  });

  describe('AbortSignal', () => {
    it('throws CompressionError(ABORTED) when signal is pre-aborted', async () => {
      const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'test.jpg', { type: 'image/jpeg' });
      const controller = new AbortController();
      controller.abort();
      try {
        await svc.compress(file, { signal: controller.signal });
        expect.fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(CompressionError);
        expect((err as CompressionError).code).toBe('ABORTED');
      }
    });
  });

  describe('onProgress', () => {
    it('fires progress events during compression', async () => {
      const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'test.jpg', { type: 'image/jpeg' });
      const events: CompressionProgress[] = [];
      await svc.compress(file, {
        forceServer: true, // skip the cascade so we only get fallback events
        onProgress: (e: CompressionProgress) => events.push(e),
      });
      expect(events.length).toBeGreaterThan(0);
      expect(events[0].stage).toBe('detecting');
      expect(events[events.length - 1].stage).toMatch(/done|fallback/);
      // Percent should be 0-100
      for (const e of events) {
        expect(e.percent).toBeGreaterThanOrEqual(0);
        expect(e.percent).toBeLessThanOrEqual(100);
      }
    });
  });

  describe('CompressionError', () => {
    it('has code, path, tried, cause fields', () => {
      const err = new CompressionError('UNKNOWN', 'test', { path: 'webcodecs-worker', tried: ['webcodecs-worker', 'canvas-main'] });
      expect(err.code).toBe('UNKNOWN');
      expect(err.path).toBe('webcodecs-worker');
      expect(err.tried).toEqual(['webcodecs-worker', 'canvas-main']);
      expect(err.name).toBe('CompressionError');
      expect(err).toBeInstanceOf(Error);
    });

    it('supports Error cause (ES2022)', () => {
      const cause = new Error('original');
      const err = new CompressionError('ABORTED', 'aborted', { cause });
      expect(err.cause).toBe(cause);
    });
  });
});

/**
 * Tests for selectPaths() — the cascade planner.
 *
 * v0.10.0 contract:
 * 1. Worker paths come FIRST in the array (when available + file is large enough)
 * 2. Main-thread caps are trusted optimistically (probe not finished = assume reliable)
 * 3. Files smaller than WORKER_SIZE_THRESHOLD_BYTES (100KB) skip Worker paths
 * 4. If workerPathsReliable === false (probe failed), Worker paths are skipped
 * 5. canvas-main is always present if hasCanvas2D (fallback for everything)
 */
describe('ImageCompression.selectPaths()', () => {
  // Build a "high tier" caps object with all Worker features available.
  const highTierCaps: DeviceCapabilities = {
    hasWebCodecs: true,
    hasImageDecoder: true,
    hasVideoEncoder: true,
    hasOffscreenCanvas: true,
    hasWorker: true,
    hasCreateImageBitmap: true,
    hasCanvas2D: true,
    supportsHEIC: true,
    hardwareConcurrency: 10,
    deviceMemory: 16,
    saveData: false,
    effectiveType: '4g',
    isSafari: false,
    isIOS: false,
    tier: 'high',
  };

  describe('Worker-first ordering (v0.10.0)', () => {
    it('puts webcodecs-worker FIRST when all capabilities are present', () => {
      const svc = new ImageCompression();
      try {
        const paths = svc['selectPaths'](highTierCaps, {
          originalSize: 500_000, // > 100KB threshold
        } as never);
        expect(paths[0]).toBe('webcodecs-worker');
        expect(paths).toContain('offscreen-worker');
        expect(paths).toContain('canvas-main');
        // Order: webcodecs → offscreen → canvas
        expect(paths.indexOf('webcodecs-worker')).toBeLessThan(paths.indexOf('offscreen-worker'));
        expect(paths.indexOf('offscreen-worker')).toBeLessThan(paths.indexOf('canvas-main'));
      } finally {
        svc.dispose();
      }
    });

    it('omits webcodecs-worker when WebCodecs is missing', () => {
      const svc = new ImageCompression();
      try {
        const paths = svc['selectPaths'](
          { ...highTierCaps, hasWebCodecs: false },
          { originalSize: 500_000 } as never,
        );
        expect(paths).not.toContain('webcodecs-worker');
        expect(paths[0]).toBe('offscreen-worker');
        expect(paths).toContain('canvas-main');
      } finally {
        svc.dispose();
      }
    });
  });

  describe('Size threshold (v0.10.0)', () => {
    it('skips Worker paths for files smaller than 100KB', () => {
      const svc = new ImageCompression();
      try {
        const paths = svc['selectPaths'](highTierCaps, {
          originalSize: 50_000, // 50KB < 100KB threshold
        } as never);
        expect(paths).not.toContain('webcodecs-worker');
        expect(paths).not.toContain('offscreen-worker');
        expect(paths).toEqual(['canvas-main']);
      } finally {
        svc.dispose();
      }
    });

    it('uses Worker paths for files at exactly 100KB', () => {
      const svc = new ImageCompression();
      try {
        const paths = svc['selectPaths'](highTierCaps, {
          originalSize: 100_000, // boundary: should be INCLUDED (>= threshold)
        } as never);
        expect(paths[0]).toBe('webcodecs-worker');
      } finally {
        svc.dispose();
      }
    });

    it('uses Worker paths for files larger than 100KB', () => {
      const svc = new ImageCompression();
      try {
        const paths = svc['selectPaths'](highTierCaps, {
          originalSize: 200_000,
        } as never);
        expect(paths[0]).toBe('webcodecs-worker');
      } finally {
        svc.dispose();
      }
    });

    it('falls back to canvas-main when originalSize is unknown (Infinity)', () => {
      // Without the inject, originalSize is undefined → defaults to Infinity
      // → smallFile is false → Worker paths are tried
      const svc = new ImageCompression();
      try {
        const paths = svc['selectPaths'](highTierCaps, {} as never);
        expect(paths[0]).toBe('webcodecs-worker');
      } finally {
        svc.dispose();
      }
    });
  });

  describe('Probe-based reliability gate (v0.10.0)', () => {
    it('skips Worker paths when workerPathsReliable === false', () => {
      const svc = new ImageCompression();
      try {
        const paths = svc['selectPaths'](
          { ...highTierCaps, workerPathsReliable: false },
          { originalSize: 500_000 } as never,
        );
        expect(paths).not.toContain('webcodecs-worker');
        expect(paths).not.toContain('offscreen-worker');
        expect(paths).toEqual(['canvas-main']);
      } finally {
        svc.dispose();
      }
    });

    it('trusts main-thread caps when probe is undefined (optimistic default)', () => {
      // Probe hasn't run yet (workerPathsReliable is undefined)
      // → trust main-thread caps
      const svc = new ImageCompression();
      try {
        const paths = svc['selectPaths'](highTierCaps, {
          originalSize: 500_000,
        } as never);
        expect(paths[0]).toBe('webcodecs-worker');
      } finally {
        svc.dispose();
      }
    });

    it('uses Worker paths when probe succeeded (workerPathsReliable === true)', () => {
      const svc = new ImageCompression();
      try {
        const paths = svc['selectPaths'](
          { ...highTierCaps, workerPathsReliable: true },
          { originalSize: 500_000 } as never,
        );
        expect(paths[0]).toBe('webcodecs-worker');
      } finally {
        svc.dispose();
      }
    });
  });

  describe('canvas-main always present as fallback', () => {
    it('includes canvas-main even when all Worker features are missing', () => {
      const svc = new ImageCompression();
      try {
        const paths = svc['selectPaths'](
          {
            ...highTierCaps,
            hasWorker: false,
            hasOffscreenCanvas: false,
            hasWebCodecs: false,
            hasCreateImageBitmap: false,
          },
          { originalSize: 500_000 } as never,
        );
        expect(paths).toEqual(['canvas-main']);
      } finally {
        svc.dispose();
      }
    });

    it('omits canvas-main only when hasCanvas2D is false', () => {
      const svc = new ImageCompression();
      try {
        const paths = svc['selectPaths'](
          { ...highTierCaps, hasCanvas2D: false, hasWorker: false },
          { originalSize: 500_000 } as never,
        );
        expect(paths).not.toContain('canvas-main');
      } finally {
        svc.dispose();
      }
    });
  });
});
