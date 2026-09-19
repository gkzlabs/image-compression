import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

const heic2anyStub = resolve(__dirname, 'src/__stubs__/heic2any.ts');

export default defineConfig({
  resolve: {
    alias: [
      // Optional peer dep — never actually needed in unit tests.
      // We lazy-load heic2any only when HEIC files are encountered in production.
      // In vitest, we replace it with a stub that throws if accidentally called.
      // Match BOTH bare specifier and deep import path — see service.ts tryDecodeHEICLazy.
      { find: /^heic2any(\/.*)?$/, replacement: heic2anyStub },
    ],
  },
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.spec.ts'],
    testTimeout: 10_000,
    // --pool=forks uses separate processes per test file, preventing native
    // module segfaults that can occur with @napi-rs/canvas + @happy-dom
    // when running multiple test files in the same worker.
    pool: 'forks',
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'lcov', 'json-summary'],
      reportsDirectory: './coverage',
      // Only the shipped library counts — specs, the heic2any test stub and
      // ambient type declarations would otherwise dilute the numbers.
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.spec.ts',
        'src/**/*.d.ts',
        'src/__stubs__/**',
      ],
      // Ratchets, not aspirations — set under the measured baseline so a real
      // regression fails CI while ordinary refactors pass.
      // Measured 2026-09-19 (after the worker-entry spec + the ImageBitmap
      // polyfill fix): lines 76.7 / branches 75.7 / functions 92.1 / statements 76.7.
      // Weak spots to watch: heic.ts 59.6, service.ts 63.8, exif.ts 74.6.
      // `src/worker.ts` is now covered too (75.1) by driving the exposed RPC
      // surface in-process — see src/worker.spec.ts; the real-browser suites
      // (`npm run test:browser` / `test:worker`) still prove the parts happy-dom
      // cannot reach (real Worker targets, WebCodecs, main-thread offloading).
      thresholds: {
        lines: 70,
        statements: 70,
        branches: 70,
        functions: 85,
      },
    },
  },
});
