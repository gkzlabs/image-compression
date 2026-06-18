import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      // Optional peer dep — never actually needed in unit tests.
      // We lazy-load heic2any only when HEIC files are encountered in production.
      // In vitest, we replace it with a stub that throws if accidentally called.
      heic2any: resolve(__dirname, 'src/__stubs__/heic2any.ts'),
    },
  },
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.spec.ts', 'src/**/*.test.ts'],
    testTimeout: 10_000,
    // --pool=forks uses separate processes per test file, preventing native
    // module segfaults that can occur with @napi-rs/canvas + @happy-dom
    // when running multiple test files in the same worker.
    pool: 'forks',
  },
});
