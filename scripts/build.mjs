#!/usr/bin/env node
/**
 * Production build script.
 *
 * Uses esbuild for fast builds with --define to inject the package version
 * into __BUILD_VERSION__ (replacing the Date.now() runtime fallback).
 *
 * Outputs:
 *   - dist/index.js     (ESM main bundle — pure web APIs + in-repo rpc layer)
 *   - dist/worker.js    (standalone Web Worker for the webcodecs-worker /
 *                        offscreen-worker paths, also exposed as
 *                        '@gkzlabs/image-compression/worker'; consumers either
 *                        let their bundler rewrite `new URL('./worker.js',
 *                        import.meta.url)` or set `window.__IC_WORKER_URL`)
 *   - dist/index.cjs    (CJS build for require()/SSR consumers)
 *   - dist/index.d.ts + per-file .d.ts (types via tsc)
 *   - dist/*.js.map     (source maps)
 *
 * There is exactly ONE worker artifact (dist/worker.js). It is NOT inlined
 * into the main bundle — `resolveWorker()` (src/worker-resolution.ts) locates
 * it at runtime via the bundler-friendly `new URL(..., import.meta.url)`
 * pattern, with `__IC_WORKER_URL` as the documented escape hatch.
 */

import { build } from 'esbuild';
import { readFileSync, writeFileSync, readdirSync, rmSync } from 'fs';
import { join } from 'node:path';
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

// Step 2: Bundle worker.ts into a standalone ESM file (dist/worker.js) —
// the single worker artifact shipped to consumers.
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

// Save standalone worker.js (kept for @gkzlabs/image-compression/worker exports)
const workerSource = workerResult.outputFiles[0].text;
writeFileSync(`${outdir}/worker.js`, workerSource);
console.log(`[build] ✓ Standalone worker: ${outdir}/worker.js (${workerSource.length} bytes)`);

// Step 3: Bundle the main library.
//
// `target: es2022` + `platform: browser` + no externals (the lib is
// zero-dependency; in-repo rpc.ts replaced Comlink in v0.11.0).
console.log(`[build] Bundling main lib + __BUILD_VERSION__ = "${version}"...`);

await build({
  entryPoints: ['./src/index.ts'],
  bundle: true,
  format: 'esm',
  outfile: `${outdir}/index.js`,
  target: ['es2022'],
  platform: 'browser',
  define: {
    __BUILD_VERSION__: JSON.stringify(version),
  },
  // src/heic.ts deliberately uses `eval("import('<url>')")` so no bundler can
  // statically analyze the optional heic2any import (Angular esbuild fails on
  // a bare specifier from node_modules). The eval is intentional and covered
  // in SECURITY.md — silence the per-build warning instead of re-litigating it.
  logOverride: {
    'direct-eval': 'silent',
  },
  sourcemap: true,
  minify: false,
});

// Step 4: ESM — rewrite relative imports to .js extensions (Node ESM requirement)
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

// Step 4b: CJS build — dist/index.cjs for `require()` consumers (Node, SSR
// frameworks like Next.js/Nuxt that compile to CJS, server-fallback usage).
// Same entry + defines as the ESM build, but format: 'cjs'.
console.log('[build] Bundling CJS...');
const cjs = await build({
  entryPoints: ['./src/index.ts'],
  bundle: true,
  format: 'cjs',
  outfile: `${outdir}/index.cjs`,
  target: ['es2022'],
  platform: 'browser',
  define: {
    __BUILD_VERSION__: JSON.stringify(version),
  },
  logOverride: {
    'direct-eval': 'silent',
  },
  sourcemap: true,
  minify: false,
});
const cjsFile = `${outdir}/index.cjs`;
let cjsSrc = readFileSync(cjsFile, 'utf8');
// CJS keeps relative requires as-is (no extension rewrite needed by Node).
writeFileSync(cjsFile, cjsSrc);
console.log(`[build] ✓ CJS bundle: ${cjsFile}`);

// Step 5: remove test-only artifacts from dist (src/__stubs__ is used by
// vitest via alias, never shipped to consumers)
console.log('[build] Removing test-only __stubs__ from dist...');
rmSync(join(outdir, '__stubs__'), { recursive: true, force: true });

console.log(`[build] ✓ Done: ${outdir}/`);
console.log(`[build]   dist/index.js    — main library bundle (ESM)`);
console.log(`[build]   dist/index.cjs   — main library bundle (CJS)`);
console.log(`[build]   dist/worker.js   — standalone Web Worker (use: import '@gkzlabs/image-compression/worker')`);
console.log(`[build]   Consumers can use the standard new URL pattern or set __IC_WORKER_URL escape hatch.`);
console.log(`[build]   See docs/BROWSER_COMPAT.md for per-bundler setup notes.`);