import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { resolveWorker } from './service';

/**
 * Tests for `resolveWorker()` — the 3-strategy worker URL resolver.
 *
 * The function has 3 strategies (in order of preference):
 * 1. `window.__IC_WORKER_URL` (user override) — escape hatch for bundlers
 *    that don't rewrite `new URL('./worker', import.meta.url)`
 * 2. `new URL('./worker.js', import.meta.url)` — standard bundler pattern
 * 3. Hard-coded `/image-compression.worker.js?v=4` — final fallback
 *
 * We mock the `Worker` constructor in each test to verify which URL was
 * used (and which strategy was selected). The mock factory is replaced
 * before each test and restored after.
 */
describe('resolveWorker()', () => {
  // Save originals to restore in afterEach
  let originalWorker: typeof globalThis.Worker | undefined;
  let originalICWorkerURL: string | undefined;
  let workerSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    originalWorker = (globalThis as { Worker?: typeof globalThis.Worker }).Worker;
    originalICWorkerURL = (window as { __IC_WORKER_URL?: string }).__IC_WORKER_URL;
    workerSpy = vi.fn().mockImplementation(() => ({
      // Mock minimal Worker interface
      postMessage: vi.fn(),
      terminate: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    (globalThis as { Worker?: unknown }).Worker = workerSpy as unknown as typeof Worker;
  });

  afterEach(() => {
    if (originalWorker) {
      (globalThis as { Worker?: typeof globalThis.Worker }).Worker = originalWorker;
    } else {
      delete (globalThis as { Worker?: typeof globalThis.Worker }).Worker;
    }
    if (originalICWorkerURL !== undefined) {
      (window as { __IC_WORKER_URL?: string }).__IC_WORKER_URL = originalICWorkerURL;
    } else {
      delete (window as { __IC_WORKER_URL?: string }).__IC_WORKER_URL;
    }
  });

  describe('Strategy 1: window.__IC_WORKER_URL override', () => {
    it('uses the user-provided URL when __IC_WORKER_URL is set', () => {
      (window as { __IC_WORKER_URL?: string }).__IC_WORKER_URL = '/my-custom-worker.js';
      resolveWorker();
      expect(workerSpy).toHaveBeenCalledWith('/my-custom-worker.js', { type: 'module' });
    });

    it('takes precedence over the import.meta.url pattern', () => {
      (window as { __IC_WORKER_URL?: string }).__IC_WORKER_URL = '/override.js';
      resolveWorker();
      // Should call Worker with the override URL, not the standard pattern.
      // If strategy 2 had run first, we'd see a different URL.
      expect(workerSpy).toHaveBeenCalledTimes(1);
      expect(workerSpy.mock.calls[0]?.[0]).toBe('/override.js');
    });

    it('does not fall through when override URL is set', () => {
      (window as { __IC_WORKER_URL?: string }).__IC_WORKER_URL = '/explicit.js';
      resolveWorker();
      // Only one Worker constructor call — the override is terminal.
      expect(workerSpy).toHaveBeenCalledTimes(1);
    });

    it('handles absolute URLs in __IC_WORKER_URL (CDN worker)', () => {
      (window as { __IC_WORKER_URL?: string }).__IC_WORKER_URL = 'https://cdn.example.com/worker.js';
      resolveWorker();
      expect(workerSpy).toHaveBeenCalledWith('https://cdn.example.com/worker.js', {
        type: 'module',
      });
    });
  });

  describe('Strategy 3: hard-coded fallback', () => {
    it('falls back to /image-compression.worker.js?v=4 when import.meta.url throws', () => {
      // Force strategy 2 to fail by mocking the URL constructor to throw.
      // This simulates bundlers that don't support the `new URL('./worker',
      // import.meta.url)` pattern (e.g. Angular CLI 17 esbuild on
      // node_modules imports).
      const originalURL = globalThis.URL;
      const urlSpy = vi.fn().mockImplementation(() => {
        throw new TypeError('Invalid URL');
      });
      (globalThis as { URL?: unknown }).URL = urlSpy;

      try {
        resolveWorker();
        // After strategy 2 throws, the catch block runs strategy 3.
        const lastCall = workerSpy.mock.calls[workerSpy.mock.calls.length - 1];
        // The first arg of `new Worker(...)` may be a string (hard-coded) or
        // a URL (standard pattern). We expect a string for the fallback.
        expect(typeof lastCall?.[0]).toBe('string');
        expect(lastCall?.[0]).toBe('/image-compression.worker.js?v=4');
      } finally {
        (globalThis as { URL?: unknown }).URL = originalURL;
      }
    });

    it('logs a warning when falling back', () => {
      // Force strategy 2 to fail
      const originalURL = globalThis.URL;
      const urlSpy = vi.fn().mockImplementation(() => {
        throw new TypeError('Invalid URL');
      });
      (globalThis as { URL?: unknown }).URL = urlSpy;
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      try {
        resolveWorker();
        // The function logs a warning to console.warn before falling back.
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining('[ImageCompression]'),
          expect.anything(),
        );
      } finally {
        (globalThis as { URL?: unknown }).URL = originalURL;
        warnSpy.mockRestore();
      }
    });

    it('uses type: "module" for the worker', () => {
      resolveWorker();
      const lastCall = workerSpy.mock.calls[workerSpy.mock.calls.length - 1];
      expect(lastCall?.[1]).toEqual({ type: 'module' });
    });
  });

  describe('integration: returns a Worker instance', () => {
    it('returns the result of `new Worker(...)`', () => {
      const mockWorkerInstance = {
        postMessage: vi.fn(),
        terminate: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      };
      workerSpy.mockReturnValue(mockWorkerInstance);
      const result = resolveWorker();
      expect(result).toBe(mockWorkerInstance);
    });
  });
});
