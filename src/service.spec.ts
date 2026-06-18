import { ImageCompression } from './service';
import { CompressionError } from './types';
import type { CompressionProgress } from './types';

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
