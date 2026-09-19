import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
// Import from './service' — the module consumers actually get. (A copy of this
// function used to live in worker-resolution.ts while service.ts had its own
// duplicate; the duplicate is gone so this spec now covers the shipped code.)
import { workerFallbackUrl, resolveWorker } from './service';

/**
 * Tests for `resolveWorker()` — the 3-strategy worker URL resolver.
 *
 * The function has 3 strategies (in order of preference):
 * 1. `window.__IC_WORKER_URL` (user override) — escape hatch for bundlers
 *    that don't rewrite `new URL('./worker.js', import.meta.url)`
 * 2. `new URL('./worker.js', import.meta.url)` — standard bundler pattern
 * 3. `image-compression.worker.js?v=<version>` resolved against
 *    `document.baseURI` — final fallback (sub-path safe)
 *
 * A 404 on strategy 2's URL is NOT handled here (it does not throw
 * synchronously) — `rpc.ts` rejects pending calls on the worker's `error`
 * event, so the cascade falls through to `canvas-main`.
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

  describe('Strategy 3: page-relative fallback', () => {
    it('falls back to <baseURI>image-compression.worker.js?v=<version> when import.meta.url throws', () => {
      // Force strategy 2 to fail by mocking the URL constructor to throw.
      // This simulates bundlers that don't support the `new URL('./worker.js',
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
        // The fallback is built with string concatenation (it must not depend
        // on `URL`, which is exactly what failed here).
        expect(typeof lastCall?.[0]).toBe('string');
        expect(lastCall?.[0]).toMatch(/image-compression\.worker\.js\?v=[a-z0-9.]+$/);
      } finally {
        (globalThis as { URL?: unknown }).URL = originalURL;
      }
    });

    it('resolves the fallback against document.baseURI (works under a sub-path deployment)', () => {
      const baseSpy = vi
        .spyOn(document, 'baseURI', 'get')
        .mockReturnValue('https://example.com/my-app/deep/index.html');
      try {
        const url = workerFallbackUrl();
        // Root-absolute '/image-compression.worker.js' used to break apps
        // deployed under a sub-path; the URL now follows the document base.
        expect(
          url.startsWith('https://example.com/my-app/deep/image-compression.worker.js?v='),
        ).toBe(true);
      } finally {
        baseSpy.mockRestore();
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
