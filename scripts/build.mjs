#!/usr/bin/env node
/**
 * Production build script.
 *
 * Uses esbuild for fast builds with --define to inject the package version
 * into __BUILD_VERSION__ (replacing the Date.now() runtime fallback).
 *
 * Outputs:
 *   - dist/index.js     (ESM main bundle, worker INLINED as Blob source — no
 *                        separate worker file needed by consumers)
 *   - dist/worker.js    (standalone worker — kept for @GKz/image-compression/worker
 *                        exports field, advanced users who want explicit URLs)
 *   - dist/index.d.ts + per-file .d.ts (types via tsc)
 *   - dist/*.js.map     (source maps)
 *
 * v0.10.20+: Worker is bundled INTO dist/index.js as a string. At runtime,
 * `resolveWorker()` creates the Worker via Blob URL — consumers don't need
 * to copy worker.js anywhere or set up any escape hatch. This makes the lib
 * work identically across Vite, Angular CLI, Webpack, and any other bundler
 * without consumer-side configuration.
 */

import { build } from 'esbuild';
import { readFileSync, writeFileSync, readdirSync, rmSync } from 'fs';
import { execSync } from 'child_process';

const pkg = JSON.parse(readFileSync('./package.json', 'utf8'));
const version = pkg.version;
const outdir = './dist';

console.log(`[build] Building ${pkg.name}@${version}`);

// Clean dist
rmSync(outdir, { recursive: true, force: true });

// Step 1: tsc generates .d.ts files (esbuild doesn't generate them)
console.log('[build] Generating TypeScript declarations...');
execSync('npx tsc -p tsconfig.build.json', { stdio: 'inherit' });

// Step 2: Bundle worker.ts into a standalone ESM file
// This is used BOTH as the standalone dist/worker.js AND inlined into the main bundle.
console.log('[build] Bundling worker...');
const workerResult = await build({
  entryPoints: ['./src/worker.ts'],
  bundle: true,
  format: 'esm',
  write: false,
  target: ['es2022'],
  platform: 'browser',
  sourcemap: false,
});

// Save standalone worker.js (kept for @GKz/image-compression/worker exports)
const workerSource = workerResult.outputFiles[0].text;
writeFileSync(`${outdir}/worker.js`, workerSource);
console.log(`[build] ✓ Standalone worker: ${outdir}/worker.js (${workerSource.length} bytes)`);

// Step 3: Bundle main lib with worker source INLINED by temporarily modifying
// src/worker-source.ts to contain the actual worker source string.
//
// Why we modify the source file instead of using a virtual module plugin:
// esbuild's tree-shaker is too aggressive with placeholder strings — when it
// sees `const WORKER_SOURCE = '__WORKER_SOURCE__'`, it evaluates `length > 100`
// at compile time and eliminates the entire Blob URL strategy as dead code.
// We work around this by writing the real source into the source file
// before bundling, then restoring the placeholder after.
//
// The window where src/worker-source.ts contains the real source is only
// during the esbuild invocation (a few hundred ms). Git never sees changes
// because we restore the file in the `finally` block.
console.log('[build] Bundling main lib with inlined worker + __BUILD_VERSION__ = "${version}"...');

// Use esbuild --define to inject the worker source as a string constant.
// The source file declares `const __WORKER_SOURCE__` (no value), and we
// define its value here. esbuild substitutes the literal at compile time,
// which lets the Blob URL strategy branch survive tree-shaking.
await build({
  entryPoints: ['./src/index.ts'],
  bundle: true,
  format: 'esm',
  outfile: `${outdir}/index.js`,
  target: ['es2022'],
  platform: 'browser',
  define: {
    __BUILD_VERSION__: JSON.stringify(version),
    // Inject the worker source as a string literal. Wrapping in JSON.stringify
    // produces a properly-escaped JS string literal.
    __WORKER_SOURCE__: JSON.stringify(workerSource),
  },
  external: ['comlink'],
  sourcemap: true,
  minify: false,
});

// Step 4: rewrite relative imports to .js extensions (Node ESM requirement)
console.log('[build] Rewriting relative imports to .js extensions...');
for (const file of readdirSync(outdir)) {
  if (!file.endsWith('.js') || file.endsWith('.js.map')) continue;
  const path = `${outdir}/${file}`;
  let src = readFileSync(path, 'utf8');
  src = src.replace(/from\s+(['"])(\.\/[^'"]+)\1/g, (_m, q, p) => {
    return `from ${q}${p}.js${q}`;
  });
  writeFileSync(path, src);
}

// Step 5: removed (worker source is now inlined at Step 3 via source-file modification)

console.log(`[build] ✓ Done: ${outdir}/`);
console.log(`[build]   dist/index.js    — main library bundle`);
console.log(`[build]   dist/worker.js   — standalone Web Worker (use: import '@GKz/image-compression/worker')`);
console.log(`[build]   Consumers can use the standard new URL pattern or set __IC_WORKER_URL escape hatch.`);
console.log(`[build]   See docs/BROWSER_COMPAT.md for per-bundler setup notes.`);