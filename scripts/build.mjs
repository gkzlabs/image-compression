#!/usr/bin/env node
/**
 * Production build script.
 *
 * Uses esbuild for fast builds with --define to inject the package version
 * into __BUILD_VERSION__ (replacing the Date.now() runtime fallback).
 *
 * Outputs:
 *   - dist/index.js (ESM, bundled with version injected)
 *   - dist/index.d.ts + per-file .d.ts (types via tsc)
 *   - dist/*.js.map (source maps)
 *
 * The previous tsc-only build didn't have --define support, so the runtime
 * fallback (Date.now()) was always used, defeating browser worker caching.
 */

import { build } from 'esbuild';
import { readFileSync, writeFileSync, readdirSync, rmSync } from 'fs';
import { execSync } from 'child_process';

const pkg = JSON.parse(readFileSync('./package.json', 'utf8'));
const version = pkg.version;
const outdir = './dist';

console.log(`[build] Building ${pkg.name}@${version}`);

// Clean dist
if (rmSync) rmSync(outdir, { recursive: true, force: true });

// Step 1: tsc generates .d.ts files (esbuild doesn't generate them)
console.log('[build] Generating TypeScript declarations...');
execSync('npx tsc -p tsconfig.build.json', { stdio: 'inherit' });

// Step 2: esbuild bundles with __BUILD_VERSION__ injected
console.log(`[build] Bundling ESM with __BUILD_VERSION__ = "${version}"...`);
await build({
  entryPoints: ['./src/index.ts'],
  bundle: true,
  format: 'esm',
  outfile: `${outdir}/index.js`,
  target: 'es2022',
  platform: 'browser',
  define: {
    __BUILD_VERSION__: JSON.stringify(version),
  },
  external: ['comlink'],
  sourcemap: true,
  minify: false, // keep readable for debugging; users can minify in their build
});

// Step 3: rewrite relative imports to .js extensions (Node ESM requirement)
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

console.log(`[build] ✓ Done: ${outdir}/`);