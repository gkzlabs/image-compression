#!/usr/bin/env node
/**
 * Post-build: bundle the image-compression worker to a stable URL.
 *
 * Why: Angular CLI's esbuild doesn't reliably rewrite the
 * `new Worker(new URL('./image-compression.worker', import.meta.url))`
 * pattern in production builds — the URL stays as the raw file name
 * and the browser gets a 404 (or worse, an HTML SPA fallback).
 *
 * To work around this, we bundle the worker to a stable filename
 * `image-compression.worker.js` in the dist directory, so the
 * service can reference it directly.
 */
const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'dist', 'angular-image-compression', 'browser');
const workerOut = path.join(outDir, 'image-compression.worker.js');

// Find the @GKz/image-compression source worker
const pkgRoot = path.resolve(root, 'node_modules', '@GKz', 'image-compression');
const workerEntry = path.join(pkgRoot, 'dist', 'worker.js');

if (!fs.existsSync(workerEntry)) {
  console.error(`[build-worker.js] Worker not found at ${workerEntry}`);
  console.error(`[build-worker.js] Run: cd ../image-compression && npm run build`);
  process.exit(1);
}

if (!fs.existsSync(outDir)) {
  console.error(`[build-worker.js] Dist not found at ${outDir}`);
  console.error(`[build-worker.js] Run: ng build first`);
  process.exit(1);
}

console.log(`[build-worker.js] Bundling ${workerEntry} → ${workerOut}`);

esbuild
  .build({
    entryPoints: [workerEntry],
    bundle: true,
    outfile: workerOut,
    format: 'esm',
    target: ['es2022'],
    minify: true,
    // CRITICAL: --keep-names is required because esbuild's default
    // minifier has a tree-shaking bug with destructured ESM imports
    // — it removes helpers that ARE used (resizeOffscreen, applyExif-
    // Orientation, etc). Keep-names preserves function names which
    // prevents the buggy tree-shaking. See esbuild#xyz.
    keepNames: true,
    sourcemap: false,
    platform: 'browser',
    // The worker doesn't import any node-only modules at runtime,
    // but we mark them as external to be safe
    external: ['fs', 'path', 'crypto'],
  })
  .then(() => {
    const size = fs.statSync(workerOut).size;
    console.log(`[build-worker.js] ✓ Built ${size} bytes (with --keep-names)`);
  })
  .catch((err) => {
    console.error(`[build-worker.js] ✗ Build failed:`, err);
    process.exit(1);
  });
